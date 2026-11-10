// Official SEBON lists: licensed stockbrokers and mutual fund managers (name, address, phone, email).
// A website is stored only when it opens; it is taken from the official email domain or the name.
// For fund managers, the "online SIP / apply" link is the one their own homepage links to (never guessed).
import { run, tx, nowIso, all } from "../db.ts";
import { decodeHtml } from "../lib/fetcher.ts";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 SaphalStocks/1.0";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FREE_MAIL = /gmail|yahoo|hotmail|outlook|live\.com|wlink|ntc\.net|mos\.com\.np/i;

async function get(url: string, ms = 20_000) {
  const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(ms), headers: { "User-Agent": UA, Accept: "text/html" } });
  const type = r.headers.get("content-type") ?? "";
  return { ok: r.status < 400 && /html/.test(type), url: r.url, html: /html/.test(type) ? await r.text() : "" };
}
const txt = (s: string) => decodeHtml(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Parses SEBON's card list (each entry: <h1>name</h1> then Address/Phone/Email/Contact Person). */
export function parseSebonCards(html: string) {
  const out: { name: string; address: string | null; phone: string | null; email: string | null; contact: string | null; contactEmail: string | null }[] = [];
  const re = /<div class="card-body">\s*<h1>\s*([^<]+?)\s*<\/h1>([\s\S]*?)(?=<div class="card-body">|<\/section>|$)/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const body = txt(m[2]);
    const [own, person = ""] = body.split(/Contact Person Details/);
    const f = (k: string, s: string) => { const x = s.match(new RegExp(`${k}:\\s*(.*?)(?=\\s+(?:Address|Phone|Email|Valid Till|Services|Name|Website):|$)`)); return x && x[1].trim() ? x[1].trim() : null; };
    out.push({ name: decodeHtml(m[1]).replace(/\s+/g, " ").trim(), address: f("Address", own), phone: f("Phone", own), email: f("Email", own)?.match(/\S+@\S+/)?.[0] ?? null, contact: [f("Name", person), f("Phone", person)].filter(Boolean).join(", ") || null, contactEmail: f("Email", person)?.match(/\S+@\S+/)?.[0] ?? null });
  }
  return out;
}

async function allPages(path: string) {
  const items: ReturnType<typeof parseSebonCards> = [];
  for (let p = 1; p <= 15; p++) {
    const r = await get(`https://www.sebon.gov.np/intermediaries/${path}${p > 1 ? `?page=${p}` : ""}`);
    const cards = parseSebonCards(r.html);
    if (!cards.length) break;
    items.push(...cards);
    if (!new RegExp(`page=${p + 1}\\b`).test(r.html)) break;
    await sleep(1200);
  }
  return items;
}

const baseOf = (host: string) => { const p = host.toLowerCase().replace(/^www\./, "").split("."); return p.slice(-3).join(".").replace(/^[a-z0-9-]+\.(?=[a-z0-9-]+\.(com|org|net)\.np$)/, ""); };
/** Brand-named domains first, then the official email domain. A site counts only if it opens on the same
 *  domain (a redirect elsewhere, e.g. an expired domain now pointing to an unrelated site, is rejected). */
async function findSite(name: string, email: string | null, contactEmail: string | null = null) {
  const phrase = name.toLowerCase().replace(/\b(limited|ltd|pvt|private)\b\.?/g, " ").replace(/&/g, " ").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  const words = name.toLowerCase().replace(/&/g, " ").replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w && !/^(limited|ltd|pvt|private|capital|investment|investments|banking|banker|merchant|markets?|and|company|co)$/.test(w));
  const brand = words.join(""), first = words[0] ?? "";
  const cands: { dom: string; parentBank: boolean }[] = [];
  const add = (dom: string, parentBank = false) => { if (dom && !cands.some((c) => c.dom === dom)) cands.push({ dom, parentBank }); };
  for (const b of [brand, first]) if (b) { add(`${b}capital.com`); add(`${b}capital.com.np`); }
  const dom = email && !FREE_MAIL.test(email) ? email.split("@")[1].toLowerCase() : null;
  if (dom) add(dom, /bank\./.test(dom));
  const cdom = contactEmail && !FREE_MAIL.test(contactEmail) ? contactEmail.split("@")[1].toLowerCase() : null;
  if (cdom) add(cdom, /bank\./.test(cdom));
  if (brand) { add(`${brand}cl.com.np`); add(`${brand[0]}cl.com.np`); }
  for (const c of cands) {
    for (const u of [`https://${c.dom}`, `https://www.${c.dom}`, `http://${c.dom}`]) {
      try {
        const r = await get(u, 12_000);
        if (!r.ok || r.html.length < 500) continue;
        if (baseOf(new URL(r.url).host) !== baseOf(c.dom)) continue; // redirected to another site
        const page = txt(r.html).toLowerCase().replace(/&amp;|&/g, " ").replace(/[^a-z\u0900-\u097f. ]/g, " ").replace(/\s+/g, " ");
        if (!page.includes(phrase) && !page.replace(/\s+/g, "").includes(phrase.replace(/\s+/g, ""))) continue; // must name this company
        if (!/nepal|kathmandu|lalitpur|\.np\b|नेपाल/.test(page + " " + r.url)) continue; // and be the Nepali company
        return { url: r.url.replace(/\/$/, ""), html: r.html, parentBank: c.parentBank };
      } catch { /* next */ }
    }
  }
  return null;
}

/** The apply/SIP link a fund manager's own homepage points to. */
export function findApplyLink(html: string, base: string) {
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let best: { url: string; label: string; score: number } | null = null;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const label = txt(m[2]);
    if (!label || label.length > 60 || /calculator|calculate|login/i.test(label) && !/sip login/i.test(label)) continue;
    const s = /online sip|sip registration|sip form|apply online|online application|invest online|buy units|unit purchase/i.test(label) ? 3 : /\bsip\b|mutual fund application|open.?end/i.test(label) ? 2 : 0;
    if (!s) continue;
    let url: string; try { url = new URL(m[1], base).toString(); } catch { continue; }
    if (!/^https?:/.test(url)) continue;
    if (!best || s > best.score) best = { url, label, score: s };
  }
  return best;
}

export async function syncBrokers(): Promise<number> {
  const list = await allPages("stock-brokers");
  if (!list.length) throw new Error("SEBON broker list returned nothing");
  tx(() => { run("DELETE FROM brokers"); for (const b of list) run("INSERT OR REPLACE INTO brokers (name, address, phone, email, contact, website, checked_at) VALUES (?, ?, ?, ?, ?, NULL, ?)", b.name, b.address, b.phone, b.email, b.contact, nowIso()); });
  return list.length;
}

export async function syncFundManagers(): Promise<number> {
  const list = await allPages("fund-managers");
  if (!list.length) throw new Error("SEBON fund manager list returned nothing");
  const prev = new Map(all<{ name: string; website: string | null; apply_url: string | null; apply_label: string | null; checked_at: string }>("SELECT name, website, apply_url, apply_label, checked_at FROM fund_managers").map((r) => [r.name, r]));
  const rows: { name: string; address: string | null; phone: string | null; email: string | null; contactEmail?: string | null; website: string | null; apply_url: string | null; apply_label: string | null }[] = [];
  for (const m of list) {
    if (/^Fund Manager and Depository$/i.test(m.name)) continue;
    const old = prev.get(m.name);
    if (old && Date.now() - Date.parse(old.checked_at) < 14 * 86_400_000) { rows.push({ ...m, website: old.website, apply_url: old.apply_url, apply_label: old.apply_label }); continue; }
    const site = await findSite(m.name, m.email, m.contactEmail);
    const apply = site && !site.parentBank ? findApplyLink(site.html, site.url) : null;
    rows.push({ ...m, website: site ? (site.parentBank ? `bank:${site.url}` : site.url) : null, apply_url: apply?.url ?? null, apply_label: apply?.label ?? null });
    await sleep(800);
  }
  tx(() => { for (const r of rows) run("INSERT OR REPLACE INTO fund_managers (name, address, phone, email, website, apply_url, apply_label, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", r.name, r.address, r.phone, r.email, r.website, r.apply_url, r.apply_label, nowIso()); });
  return rows.length;
}
