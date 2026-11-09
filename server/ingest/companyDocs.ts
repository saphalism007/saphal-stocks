// Official company websites: finds each listed company's investor-relations, reports, notices,
// news and downloads pages and the documents linked from them, classifies every document
// (shared/docs.ts) and checks that the newest reports actually open. Polite: one request at a time
// per website with a pause, a browser-like user agent naming the app, and each site is revisited
// at most every two weeks. Nothing is guessed: a page or PDF is only stored if the site links to it.
import { all, run, tx, nowIso } from "../db.ts";
import { extractLinks, classifyDoc, describe, pageScore, isDocUrl, baseDomain, publishedDate, docSortKey, type PageKind } from "../../shared/docs.ts";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 SaphalStocks/1.0";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getHtml(url: string) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(25_000), headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" } });
  const type = res.headers.get("content-type") ?? "";
  const html = /html|text/.test(type) ? await res.text() : (await res.body?.cancel().catch(() => {}), "");
  return { status: res.status, url: res.url, html };
}

/** Opens the first KB of a document to confirm it exists and is a real file (PDF magic number or a document content type). */
async function verifyDoc(url: string): Promise<{ ok: boolean; type: string }> {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000), headers: { "User-Agent": UA, Range: "bytes=0-1023" } });
    const type = res.headers.get("content-type") ?? "";
    const buf = new Uint8Array(await res.arrayBuffer().catch(() => new ArrayBuffer(0)));
    const pdf = buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
    return { ok: res.status < 400 && (pdf || /pdf|msword|officedocument|octet-stream/.test(type)), type: pdf ? "application/pdf" : type.split(";")[0] };
  } catch { return { ok: false, type: "" }; }
}

interface Found { url: string; title: string; type: string; fiscalYear: string | null; quarter: number | null; published: string | null; page: string; offsite: boolean; reason: string }

export async function crawlCompany(symbol: string, website: string) {
  const out = { status: "ok", http: 0, final: website, pages: new Map<PageKind, { url: string; label: string; score: number }>(), docs: new Map<string, Found>(), note: "" };
  let home: Awaited<ReturnType<typeof getHtml>>;
  try { home = await getHtml(website); } catch (e) { out.status = "unreachable"; out.note = (e instanceof Error ? e.message : String(e)).slice(0, 120); return out; }
  out.http = home.status; out.final = home.url;
  if (home.status >= 400 || !home.html) { out.status = "unreachable"; out.note = `HTTP ${home.status}`; return out; }
  const base = baseDomain(new URL(home.url).host);
  const sameOrg = (u: string) => { try { return baseDomain(new URL(u).host) === base; } catch { return false; } };
  const take = (html: string, pageUrl: string) => {
    const links = extractLinks(html, pageUrl);
    for (const l of links) {
      if (isDocUrl(l.url)) {
        if (out.docs.has(l.url)) continue;
        const c = classifyDoc(l);
        if (c.type === "other") continue;
        out.docs.set(l.url, { url: l.url, title: describe(l).title.slice(0, 200), type: c.type, fiscalYear: c.fiscalYear, quarter: c.quarter, published: publishedDate(l), page: pageUrl, offsite: !sameOrg(l.url), reason: c.reason });
      } else if (sameOrg(l.url) && l.title && l.title.length <= 60) {
        const k = pageScore(l.title, l.url);
        const prev = k ? out.pages.get(k.kind) : undefined;
        if (k && (!prev || k.score > prev.score) && l.url.replace(/\/$/, "") !== home.url.replace(/\/$/, "")) out.pages.set(k.kind, { url: l.url, label: l.title, score: k.score });
      }
    }
    return links.length;
  };
  const n = take(home.html, home.url);
  if (n < 8) { out.status = "script-only"; out.note = "The site builds its pages with scripts, so its documents can't be listed automatically."; }
  // Visit the report pages (and one level below the investor page), one at a time.
  const visited = new Set<string>([home.url]);
  const visit = async (u: string) => { if (visited.has(u) || visited.size > 7) return; visited.add(u); await sleep(900); try { const p = await getHtml(u); if (p.status < 400 && p.html) take(p.html, p.url); } catch { /* skip */ } };
  for (const k of ["investor", "quarterly", "annual", "downloads", "notices"] as PageKind[]) { const pg = out.pages.get(k); if (pg) await visit(pg.url); }
  for (const k of ["quarterly", "annual", "downloads"] as PageKind[]) { const pg = out.pages.get(k); if (pg) await visit(pg.url); }
  return out;
}

export async function syncCompanyDocs(opts: { symbols?: string[]; maxAgeDays?: number; limit?: number } = {}): Promise<number> {
  const maxAge = opts.maxAgeDays ?? 14;
  const cos = all<{ symbol: string; website: string | null }>("SELECT symbol, website FROM companies WHERE status = 'active' AND (sector IS NULL OR sector NOT IN ('Promoter Share','Corporate Debentures'))");
  const recent = new Set(all<{ symbol: string }>(`SELECT symbol FROM company_crawl WHERE crawled_at >= datetime('now', '-${maxAge} days') AND status <> 'no-website'`).map((r) => r.symbol));
  const now = nowIso();
  for (const c of cos.filter((x) => !x.website)) run("INSERT OR REPLACE INTO company_crawl (symbol, website, status, pages, docs, note, crawled_at) VALUES (?, NULL, 'no-website', 0, 0, 'No official website is listed for this company in its exchange profile.', ?)", c.symbol, now);
  let queue = cos.filter((c) => c.website && (opts.symbols ? opts.symbols.includes(c.symbol) : !recent.has(c.symbol)));
  queue = queue.slice(0, opts.limit ?? 400);
  let done = 0;
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      try {
        const r = await crawlCompany(c.symbol, c.website!);
        const docs = [...r.docs.values()];
        // Confirm the newest reports open (first KB only).
        const key = (d: Found) => docSortKey({ fiscalYear: d.fiscalYear, quarter: d.quarter, published: d.published, url: d.url, title: d.title });
        const important = (["quarterly", "audited", "annual"] as const).flatMap((t) => docs.filter((d) => d.type === t).sort((a, b) => key(b).localeCompare(key(a))).slice(0, 4));
        const checks = new Map<string, { ok: boolean; type: string }>();
        for (const d of important) { checks.set(d.url, await verifyDoc(d.url)); await sleep(500); }
        tx(() => {
          run("DELETE FROM company_pages WHERE symbol = ?", c!.symbol);
          for (const [k, p] of r.pages) run("INSERT OR REPLACE INTO company_pages (symbol, kind, url, label) VALUES (?, ?, ?, ?)", c!.symbol, k, p.url, p.label);
          if (r.status !== "unreachable") run("DELETE FROM company_docs WHERE symbol = ?", c!.symbol);
          for (const d of docs.slice(0, 200)) { const ck = checks.get(d.url); run("INSERT OR REPLACE INTO company_docs (symbol, url, title, type, fiscal_year, quarter, published, page_url, offsite, verified, content_type, reason, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", c!.symbol, d.url, d.title, d.type, d.fiscalYear, d.quarter, d.published, d.page, d.offsite ? 1 : 0, ck ? (ck.ok ? 1 : 0) : null, ck?.type ?? null, d.reason, nowIso()); }
          run("INSERT OR REPLACE INTO company_crawl (symbol, website, final_url, status, http_status, pages, docs, note, crawled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", c!.symbol, c!.website, r.final, r.status, r.http, r.pages.size, docs.length, r.note, nowIso());
        });
      } catch (e) { console.warn(`[company docs] ${c.symbol}: ${e instanceof Error ? e.message : e}`); }
      done++;
      if (done % 20 === 0) console.log(`[company docs] ${done} websites checked`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return done;
}
