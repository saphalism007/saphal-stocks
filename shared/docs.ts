// Company documents from official websites: find the investor / reports / notices / news /
// downloads pages, collect document links, and classify each one strictly:
//   quarterly  = interim (usually unaudited) statements for a stated quarter
//   annual     = the company's annual report (may contain audited statements, management review…)
//   audited    = audited financial statements / independent auditor's report for a fiscal year
//   unclassified = clearly financial but the type can't be verified from its title, file name or folder
// A quarterly report is never labelled audited just because it contains financial statements.
// Pure; tested in tests/docs.test.ts.

export type DocType = "quarterly" | "annual" | "audited" | "unclassified" | "disclosure" | "notice" | "other";
export type PageKind = "investor" | "quarterly" | "annual" | "notices" | "news" | "downloads";
export interface DocLink { url: string; title: string; context: string }
export interface Classified { type: DocType; fiscalYear: string | null; quarter: number | null; reason: string }

export const DOC_LABEL: Record<DocType, string> = {
  quarterly: "Quarterly financial report", annual: "Annual report", audited: "Audited financial statements",
  unclassified: "Unclassified financial document", disclosure: "Regulatory disclosure", notice: "Notice / announcement", other: "Other document",
};

const decode = (u: string) => { try { return decodeURIComponent(u); } catch { return u; } };
const GENERIC = /^(download|click here|view|read more|pdf|here|open|details?|more|file|attachment|\d+|view pdf|download pdf|डाउनलोड|हेर्नुहोस्)$/i;

/** Text that describes a link: its own words unless generic, then the surrounding text, then the file name and folder. */
export function describe(l: DocLink) {
  const path = decode(l.url.split(/[?#]/)[0]);
  const parts = path.split("/").filter(Boolean);
  const file = (parts[parts.length - 1] ?? "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_+]+/g, " ").replace(/-(?=\D)/g, " ");
  const folder = parts.slice(-4, -1).join(" / ");
  const own = l.title.trim();
  const useOwn = own && !GENERIC.test(own) && own.length > 3;
  const title = (useOwn ? own : l.context.trim() ? l.context.trim().slice(0, 160) : file).replace(/\s+/g, " ").trim();
  return { title, file, folder, all: `${title} ${file} ${folder}`.replace(/\s+/g, " ") };
}

const BS2 = (n: number) => (n >= 60 && n <= 99 ? 2000 + n : null); // 79 -> 2079 (Bikram Sambat)
/** Fiscal year as "2081/82" (Bikram Sambat) or "2024/25" (AD) when stated; null otherwise. */
export function fiscalYear(text: string): string | null {
  const t = text.replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d)));
  let m = t.match(/\b(20[5-9]\d|19\d\d|20[0-4]\d)\s*[/\\\-–_. ]\s*(20[5-9]\d|20[0-4]\d|0?\d{2})\b/);
  if (m) { const a = Number(m[1]), b = Number(m[2].slice(-2)); if ((a + 1) % 100 === b) return `${a}/${String(b).padStart(2, "0")}`; }
  m = t.match(/(?:^|[^\d])(0?[6-9]\d)\s*[/\\\-–_ ]\s*([6-9]\d)(?:[^\d]|$)/);
  if (m) { const a = BS2(Number(m[1].slice(-2))), b = Number(m[2]); if (a && (a + 1) % 100 === b) return `${a}/${String(b).padStart(2, "0")}`; }
  // A Bikram Sambat date (e.g. quarter ending 2083-06-31): the fiscal year starts in Shrawan (month 4).
  m = t.match(/\b(20[6-9]\d)-(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[0-2])\b/);
  if (m) { const y = Number(m[1]), mo = Number(m[2]); const a = mo >= 4 ? y : y - 1; return `${a}/${String((a + 1) % 100).padStart(2, "0")}`; }
  m = t.match(/\b(?:FY|fiscal year|f\.y\.|आ\.?\s?व\.?)\s*(20\d{2})\b/i);
  return m ? m[1] : null; // a bare year (often an upload folder) is not treated as a fiscal year
}

/** Year mentioned anywhere (title, file or folder), only for ordering documents that state no fiscal year. */
export function yearHint(text: string): number {
  const ys = [...text.matchAll(/\b(20[5-9]\d|20[1-4]\d)\b/g)].map((x) => Number(x[1])).map((y) => (y > 2050 ? y - 57 : y));
  return ys.length ? Math.max(...ys) : 0;
}

const QWORDS: [RegExp, number][] = [
  [/\b(first|1st|q1|qtr ?1|quarter ?1|प्रथम)\b/i, 1], [/\b(second|2nd|q2|qtr ?2|quarter ?2|दोस्रो)\b/i, 2], [/\b(third|3rd|q3|qtr ?3|quarter ?3|तेस्रो)\b/i, 3], [/\b(fourth|4th|q4|qtr ?4|quarter ?4|चौथो)\b/i, 4],
];
// Nepali fiscal-quarter end months: Ashwin (Q1), Poush (Q2), Chaitra (Q3), Ashad (Q4).
const MONTHQ: [RegExp, number][] = [[/\b(ashwin|asoj|aswin|असोज|आश्विन)\b/i, 1], [/\b(poush|push|paush|पुस|पौष)\b/i, 2], [/\b(chaitra|chait|चैत्र|चैत)\b/i, 3], [/\b(ashad|asar|asadh|ashadh|असार|आषाढ)\b/i, 4]];

export function quarterOf(text: string, allowMonth: boolean): number | null {
  const qt = text.match(/\bq([1-4])\b/i); if (qt) return Number(qt[1]);
  for (const [re, q] of QWORDS) if (re.test(text) && /quarter|quater|qtr|q[1-4]\b|त्रैमासिक|interim/i.test(text)) return q;
  if (allowMonth) for (const [re, q] of MONTHQ) if (re.test(text)) return q;
  return null;
}

const FIN = /financial|statement|result|highlight|\bfs\b|balance sheet|profit|income statement|त्रैमासिक|वित्तीय|नाफा/i;
export function classifyDoc(l: DocLink): Classified {
  const d = describe(l), t = d.all.toLowerCase();
  const fy = fiscalYear(d.all);
  if (/unaudited|un-audited|अलेखापरीक्षित/.test(t) && !/annual report/.test(t)) {
    const q = quarterOf(d.all, true) ?? (/(fourth|4th|q4)/i.test(t) ? 4 : null);
    return { type: "quarterly", fiscalYear: fy, quarter: q, reason: "Says unaudited: interim results, not audited statements." };
  }
  if (/annual report|annual-report|वार्षिक प्रतिवेदन|barshik pratibedan|varshik/.test(t)) return { type: "annual", fiscalYear: fy, quarter: null, reason: "Titled as an annual report." };
  if (/governance|internal audit|compliance audit|social audit|energy audit|system audit|it audit|is audit|\baml\b|\bkyc\b/.test(t)) return { type: "disclosure", fiscalYear: fy, quarter: null, reason: "A governance / compliance audit, not the audited financial statements." };
  if (/audited (financial|statement|account|result)|auditor'?s? report|independent auditor|audit report|लेखापरीक्षण भएको|लेखापरीक्षित/.test(t)) return { type: "audited", fiscalYear: fy, quarter: null, reason: "Titled as audited statements or the auditor's report." };
  if (/csr|expense detail|province|sector.?wise|subsid|refinanc/.test(t)) return { type: "disclosure", fiscalYear: fy, quarter: null, reason: "Regulatory or operational disclosure, not a financial report." };
  if (/quarter|quater|qtr\b|\bq[1-4]\b|interim|त्रैमासिक/.test(t) && (FIN.test(t) || /report/.test(t))) return { type: "quarterly", fiscalYear: fy, quarter: quarterOf(d.all, true), reason: "Titled as a quarterly / interim report." };
  if (FIN.test(t) && quarterOf(d.all, true) && !/subsid|loan|refinanc|interest rate|base rate|tariff/.test(t)) return { type: "quarterly", fiscalYear: fy, quarter: quarterOf(d.all, true), reason: "Financial report named after a quarter-end month." };
  if (/csr|expense detail|province|sector.?wise|subsid|refinanc|basel|pillar|disclosure|capital adequacy framework|liquidity|base rate|interest rate|spread rate|tariff/.test(t)) return { type: "disclosure", fiscalYear: fy, quarter: null, reason: "Regulatory disclosure (rates, Basel, liquidity)." };
  if (/notice|सूचना|agm|sgm|general meeting|book clos|dividend|right share|auction|bid|tender|vacanc|circular|announcement|press release|साधारण सभा/.test(t)) return { type: "notice", fiscalYear: fy, quarter: null, reason: "Notice or announcement." };
  if (FIN.test(t)) return { type: "unclassified", fiscalYear: fy, quarter: null, reason: "Financial document whose type isn't stated; open it to check before relying on it." };
  return { type: "other", fiscalYear: fy, quarter: null, reason: "" };
}

/** Which kind of page a navigation link points to (from its text and URL). */
export function pageKind(text: string, url: string): PageKind | null {
  return pageScore(text, url)?.kind ?? null;
}
/** Page kind with a score so the best-labelled link wins (e.g. "Investor Relations" over "Shareholder grievance"). */
export function pageScore(text: string, url: string): { kind: PageKind; score: number } | null {
  const t = `${text} ${decode(url)}`.toLowerCase();
  if (/\.(jpe?g|png|gif|webp|pdf)(\?|$)/.test(url.toLowerCase()) || /grievance|complain|feedback|career|vacanc|login|apply|calculator|branch|atm|locat/.test(t)) return null;
  if (/investor relation|investor-relation/.test(t)) return { kind: "investor", score: 3 };
  if (/investor|shareholder|शेयरधनी/.test(t)) return { kind: "investor", score: 1 };
  if (/quarter|interim|financial (report|highlight|statement|result)s?|financial-report|financial-highlight/.test(t)) return { kind: "quarterly", score: 2 };
  if (/annual report|annual-report|वार्षिक/.test(t)) return { kind: "annual", score: 2 };
  if (/notice|announcement|सूचना|circular|disclosure/.test(t)) return { kind: "notices", score: 1 };
  if (/\bnews\b|press|media|समाचार/.test(t)) return { kind: "news", score: 1 };
  if (/download|document|publication|report/.test(t)) return { kind: "downloads", score: /download/.test(t) ? 2 : 1 };
  return null;
}

export const isDocUrl = (u: string) => /\.(pdf|docx?|xlsx?)(\?|#|$)/i.test(u) || /\/(uploads?|storage|files?|documents?|media|wp-content)\/.+\.(pdf|docx?|xlsx?)/i.test(u);
const NAV_SKIP = /facebook|twitter|linkedin|instagram|youtube|mailto:|tel:|javascript:|whatsapp|viber|play\.google|apps\.apple/i;

/** Registrable domain (last two labels, or three for *.com.np / *.org.np / *.gov.np etc.). */
export function baseDomain(host: string) {
  const h = host.toLowerCase().replace(/^www\./, "").split(":")[0];
  const p = h.split(".");
  return p.length >= 3 && /^(com|org|gov|edu|net|co)$/.test(p[p.length - 2]) && p[p.length - 1].length === 2 ? p.slice(-3).join(".") : p.slice(-2).join(".");
}

/** All <a> links in a page with their text and nearby text (table row or preceding words) for context. */
export function extractLinks(html: string, pageUrl: string): DocLink[] {
  const out: DocLink[] = [];
  const clean = (s: string) => s.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1].match(/href\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
    if (!href || href.startsWith("#") || NAV_SKIP.test(href)) continue;
    let url: string;
    try { url = new URL(href.replace(/&amp;/g, "&"), pageUrl).toString(); } catch { continue; }
    if (!/^https?:/i.test(url)) continue;
    const text = clean(m[2]) || (m[1].match(/title\s*=\s*["']([^"']+)["']/i)?.[1] ?? "");
    // Context: the table row the link sits in, else the nearest text before it (e.g. the heading above a "Download" button).
    const before = html.slice(Math.max(0, m.index - 3000), m.index);
    const trStart = before.lastIndexOf("<tr"), trEndBefore = before.lastIndexOf("</tr");
    let context = "";
    if (trStart > trEndBefore) { const rowEnd = html.indexOf("</tr", m.index); context = clean(html.slice(m.index - (before.length - trStart), rowEnd > 0 ? rowEnd : m.index + 400)).replace(text, "").replace(/\b(download|view)\b/gi, " ").replace(/\s+/g, " ").trim(); }
    else {
      const nodes = before.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/gi, " ").split(/<[^>]*>/).map((x) => clean(x)).filter((x) => x && !GENERIC.test(x) && !/[{};=]|^\W+$/.test(x));
      context = nodes.slice(-1)[0] ?? "";
      if (context.length < 6 && nodes.length > 1) context = `${nodes[nodes.length - 2]} ${context}`.trim();
    }
    out.push({ url, title: text.slice(0, 200), context: context.slice(0, 240) });
  }
  return out;
}

/** Publication date stated near the link or in the URL (YYYY-MM-DD or /YYYY/MM/), AD only. */
export function publishedDate(l: DocLink): string | null {
  const t = `${l.context} ${l.title}`;
  const m = t.match(/\b(20[12]\d)[-/.](0[1-9]|1[0-2])[-/.](0[1-9]|[12]\d|3[01])\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const u = l.url.match(/\/(20[12]\d)\/(0[1-9]|1[0-2])\//);
  return u ? `${u[1]}-${u[2]}-01` : null;
}

/** Sort key: fiscal year then quarter then date, newest first. Annual/audited (no quarter) sort after Q4 of their year. */
export function docSortKey(d: { fiscalYear: string | null; quarter: number | null; published: string | null; url?: string; title?: string }) {
  const fy = d.fiscalYear ? Number(d.fiscalYear.slice(0, 4)) : 0;
  const ad = fy > 2050 ? fy - 57 : fy || yearHint(`${d.title ?? ""} ${decode(d.url ?? "")}`); // BS -> approx AD start year
  return `${String(ad || 0).padStart(4, "0")}-${d.quarter ?? 5}-${d.published ?? ""}`;
}
