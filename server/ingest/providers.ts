// Data provider adapters. Each returns plain parsed records; persistence lives
// in jobs.ts. Adding a provider later (e.g. an official NEPSE API if one is
// opened to the public) means writing another adapter with the same shapes.
//
// Sources (see DATA_SOURCES.md):
//  - nepse-data (github.com/Aabishkar2/nepse-data, MIT): daily OHLCV history per company.
//  - ShareSansar (sharesansar.com, robots.txt allows crawling): latest prices, sectors, indices,
//    company profile, dividends, announcements, quarterly statements, news headlines.
//  - Nepal Rastra Bank forex API (nrb.org.np/api/forex/v1): official exchange rates.
import { fetchText, fetchJson, politeFetch, CookieJar, stripTags, num, decodeHtml } from "../lib/fetcher.ts";

export const SOURCES = {
  nepseData: { name: "nepse-data (GitHub, MIT licence)", url: "https://github.com/Aabishkar2/nepse-data" },
  sharesansar: { name: "ShareSansar", url: "https://www.sharesansar.com" },
  nrb: { name: "Nepal Rastra Bank forex API", url: "https://www.nrb.org.np/forex/" },
  nrbRates: { name: "Nepal Rastra Bank (official rates)", url: "https://www.nrb.org.np/cmfm_rates/policy_rates" },
  nrbMacro: { name: "Nepal Rastra Bank (Current Macroeconomic and Financial Situation)", url: "https://www.nrb.org.np/category/current-macroeconomic-situation/" },
};

const SS = "https://www.sharesansar.com";

// ---------------- nepse-data ----------------
export interface OhlcvRow { date: string; open: number; high: number; low: number; close: number; volume: number; amount: number | null }

export async function nepseDataHistory(symbol: string): Promise<OhlcvRow[] | null> {
  const url = `https://raw.githubusercontent.com/Aabishkar2/nepse-data/main/data/company-wise/${encodeURIComponent(symbol)}.csv`;
  const res = await politeFetch(url, { retries: 2 });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift()!.split(",").map((h) => h.trim());
  const ix = (k: string) => header.indexOf(k);
  const iD = ix("published_date"), iO = ix("open"), iH = ix("high"), iL = ix("low"), iC = ix("close"), iQ = ix("traded_quantity"), iA = ix("traded_amount");
  if (iD < 0 || iC < 0) throw new Error(`Unexpected CSV header for ${symbol}: ${header.join(",")}`);
  const rows: OhlcvRow[] = [];
  for (const line of lines) {
    const c = line.split(",");
    const date = c[iD]?.trim();
    const close = Number(c[iC]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(close > 0)) continue; // validation: skip malformed rows
    const open = Number(c[iO]) || close;
    const high = Math.max(Number(c[iH]) || close, open, close);
    const low = Math.min(Number(c[iL]) || close, open, close);
    rows.push({ date, open, high, low, close, volume: Number(c[iQ]) || 0, amount: iA >= 0 && c[iA] ? Number(c[iA]) || null : null });
  }
  return rows;
}

// ---------------- ShareSansar ----------------
export interface CompanyListing { symbol: string; name: string; sector: string }

export async function ssSectorListing(): Promise<{ asOf: string | null; companies: CompanyListing[]; quotes: Record<string, { open: number | null; high: number | null; low: number | null; ltp: number | null; prevClose: number | null; volume: number | null }> }> {
  const html = await fetchText(`${SS}/sectorwise-share-price`, { browserLike: true });
  const asOf = html.match(/As of\s*:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  const parts = html.split(/<h3 class="heading-title">/).slice(1);
  const companies: CompanyListing[] = [];
  const quotes: Record<string, { open: number | null; high: number | null; low: number | null; ltp: number | null; prevClose: number | null; volume: number | null }> = {};
  for (const p of parts) {
    const sector = decodeHtml(p.split("<")[0]).trim();
    for (const row of p.split(/<tr[^>]*>/).slice(1)) {
      const a = row.match(/<a[^>]*href="[^"]*\/company\/([a-z0-9-]+)"[^>]*title="([^"]*)"[^>]*>\s*([^<]*)</i);
      if (!a) continue;
      const symbol = stripTags(a[3]).toUpperCase() || a[1].toUpperCase();
      const name = decodeHtml(a[2]).trim();
      companies.push({ symbol, name, sector });
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]));
      // S.No | Symbol | Open | High | Low | LTP | Prev close | Volume | Pts change | % change
      if (cells.length >= 8) quotes[symbol] = { open: num(cells[2]), high: num(cells[3]), low: num(cells[4]), ltp: num(cells[5]), prevClose: num(cells[6]), volume: num(cells[7]) };
    }
  }
  return { asOf, companies, quotes };
}

export interface TodayRow {
  symbol: string; open: number | null; high: number | null; low: number | null; close: number | null; ltp: number | null;
  vwap: number | null; volume: number | null; prevClose: number | null; turnover: number | null; trades: number | null;
  diff: number | null; diffPct: number | null; high52: number | null; low52: number | null;
}

export async function ssTodayPrices(): Promise<{ asOf: string | null; rows: TodayRow[] }> {
  const html = await fetchText(`${SS}/today-share-price`, { browserLike: true });
  const asOf = html.match(/As of\s*:\s*(?:<[^>]+>\s*)*(\d{4}-\d{2}-\d{2})/)?.[1] ?? html.match(/id="fromdate"[^>]*value="(\d{4}-\d{2}-\d{2})"/)?.[1] ?? null;
  const table = html.match(/<table[^>]*id="headFixed"[\s\S]*?<\/table>/)?.[0] ?? html;
  const head = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => stripTags(m[1]));
  const col = (name: string) => head.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const idx = {
    sym: col("Symbol"), open: col("Open"), high: col("High"), low: col("Low"), close: col("Close"), ltp: col("LTP"), vwap: col("VWAP"),
    vol: col("Vol"), prev: col("Prev. Close"), turnover: col("Turnover"), trans: col("Trans."), diff: col("Diff"), diffPct: col("Diff %"),
    h52: col("52 Weeks High"), l52: col("52 Weeks Low"),
  };
  if (idx.sym < 0 || idx.close < 0) throw new Error("today-share-price: table layout changed (Symbol/Close columns not found)");
  const rows: TodayRow[] = [];
  const body = table.split(/<tbody[^>]*>/)[1] ?? "";
  for (const tr of body.split(/<tr[^>]*>/).slice(1)) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]));
    if (cells.length < head.length - 2) continue;
    const symbol = cells[idx.sym]?.toUpperCase();
    if (!symbol || !/^[A-Z0-9]+$/.test(symbol)) continue;
    const g = (i: number) => (i >= 0 ? num(cells[i]) : null);
    rows.push({ symbol, open: g(idx.open), high: g(idx.high), low: g(idx.low), close: g(idx.close), ltp: g(idx.ltp), vwap: g(idx.vwap), volume: g(idx.vol), prevClose: g(idx.prev), turnover: g(idx.turnover), trades: g(idx.trans), diff: g(idx.diff), diffPct: g(idx.diffPct), high52: g(idx.h52), low52: g(idx.l52) });
  }
  return { asOf, rows };
}

export const SS_INDICES: { id: number; name: string }[] = [
  { id: 12, name: "NEPSE Index" }, { id: 16, name: "Sensitive Index" }, { id: 4, name: "Float Index" }, { id: 15, name: "Sensitive Float Index" },
  { id: 1, name: "Banking SubIndex" }, { id: 2, name: "Development Bank Index" }, { id: 3, name: "Finance Index" }, { id: 5, name: "Hotels And Tourism" },
  { id: 6, name: "HydroPower Index" }, { id: 7, name: "Insurance" }, { id: 8, name: "Life Insurance" }, { id: 13, name: "Non Life Insurance" },
  { id: 9, name: "Manufacturing And Processing" }, { id: 10, name: "Microfinance Index" }, { id: 11, name: "Mutual Fund" }, { id: 14, name: "Others Index" },
  { id: 17, name: "Trading Index" }, { id: 18, name: "Investment" },
];

export interface IndexRow { date: string; open: number | null; high: number | null; low: number | null; close: number; change: number | null; changePct: number | null; turnover: number | null }

export async function ssIndexHistory(indexId: number, from: string, to: string): Promise<IndexRow[]> {
  const out: IndexRow[] = [];
  const pageSize = 50; // the endpoint returns nothing for larger pages
  for (let start = 0; start < 20_000; start += pageSize) {
    const url = `${SS}/index-history-data?index_id=${indexId}&from=${from}&to=${to}&start=${start}&length=${pageSize}&draw=1`;
    const j = await fetchJson<{ recordsTotal: number; data: Record<string, string>[] }>(url, { headers: { "X-Requested-With": "XMLHttpRequest" }, browserLike: true });
    for (const r of j.data || []) {
      const close = num(r.current);
      if (!r.published_date || close == null) continue;
      out.push({ date: r.published_date.slice(0, 10), open: num(r.open), high: num(r.high), low: num(r.low), close, change: num(r.change_), changePct: num(r.per_change), turnover: num(r.turnover) });
    }
    if (!j.data || j.data.length < pageSize || start + pageSize >= j.recordsTotal) break;
  }
  return out;
}

/** A company-page session gives us the CSRF token and internal id needed by the company JSON endpoints. */
export interface CompanySession { jar: CookieJar; token: string; companyId: string; symbol: string; html: string }

export async function ssCompanySession(symbol: string): Promise<CompanySession> {
  const jar = new CookieJar();
  const res = await politeFetch(`${SS}/company/${symbol.toLowerCase()}`, { jar, browserLike: true });
  if (!res.ok) throw new Error(`Company page HTTP ${res.status} for ${symbol}`);
  const html = await res.text();
  const token = html.match(/name="_token" content="([^"]+)"/)?.[1] ?? html.match(/_token" content="([^"]+)"/)?.[1];
  const companyId = html.match(/id="companyid"[^>]*>(\d+)/)?.[1];
  if (!token || !companyId) throw new Error(`Company page for ${symbol} is missing token/id (symbol may be delisted or renamed)`);
  return { jar, token, companyId, symbol: symbol.toUpperCase(), html };
}

async function ssPost(s: CompanySession, path: string, form: Record<string, string>) {
  const body = new URLSearchParams(form).toString();
  return politeFetch(`${SS}/${path}`, {
    method: "POST", jar: s.jar, body, browserLike: true,
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest", "X-CSRF-Token": s.token, Referer: `${SS}/company/${s.symbol.toLowerCase()}` },
  });
}

export interface CompanyInfo { symbol: string; name: string | null; sector: string | null; listedShares: number | null; paidUpValue: number | null; totalPaidUp: number | null; operationDate: string | null; phone: string | null; email: string | null; address: string | null; website: string | null; registrar: string | null; companyId: number }

export function parseCompanyInfo(s: CompanySession): CompanyInfo {
  const t = stripTags(s.html.replace(/<script[\s\S]*?<\/script>/g, " "));
  const after = (label: string, stop: RegExp) => {
    const i = t.indexOf(label);
    if (i < 0) return null;
    const rest = t.slice(i + label.length).trim();
    const m = rest.match(stop);
    return (m ? rest.slice(0, m.index) : rest.slice(0, 80)).trim() || null;
  };
  const block = t.slice(t.indexOf("Company Info"));
  const field = (label: string) => {
    const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+(.*?)\\s+(?=Symbol|Name|Sector|Listed Shares|Paid Up|Total Paid Up Value|Operation Date|Phone Number|Email|Address|Website Link|Share Registrar|As of|$)");
    return block.match(re)?.[1]?.trim() || null;
  };
  // Links are often protocol-relative ("//www.nabilbank.com").
  const rawSite = s.html.match(/Website Link[\s\S]{0,400}?href="((?:https?:)?\/\/[^"]+)"/i)?.[1] ?? null;
  const host = rawSite ? rawSite.replace(/^((https?:)?\/\/)+/i, "").replace(/^((https?:)?\/\/)+/i, "").trim() : "";
  const website = host && /^[\w.-]+\.[a-z]{2,}/i.test(host) ? `https://${host}` : null;
  return {
    symbol: s.symbol, companyId: Number(s.companyId),
    name: field("Name"), sector: field("Sector"),
    listedShares: num(field("Listed Shares")), paidUpValue: num(field("Paid Up")), totalPaidUp: num(field("Total Paid Up Value")),
    operationDate: field("Operation Date"), phone: field("Phone Number"), email: field("Email"), address: field("Address"),
    website: website && !/sharesansar/i.test(website) ? website : null,
    registrar: after("Share Registrar:", /Latest Dividend|Bonus Share/),
  };
}

export interface DividendRow { fiscalYear: string; cashPct: number | null; bonusPct: number | null; totalPct: number | null; announcementDate: string | null; bookCloseDate: string | null; distributionDate: string | null }

export async function ssDividends(s: CompanySession): Promise<DividendRow[]> {
  const res = await ssPost(s, "company-dividend", { company: s.companyId, draw: "1", start: "0", length: "50" });
  if (!res.ok) throw new Error(`company-dividend HTTP ${res.status}`);
  const j = (await res.json()) as { data?: Record<string, string | null>[] };
  return (j.data || []).map((r) => ({
    fiscalYear: stripTags(r.year || "").replace(/\\\//g, "/"),
    cashPct: num(r.cash_dividend), bonusPct: num(r.bonus_share), totalPct: num(r.total_dividend),
    announcementDate: r.announcement_date?.slice(0, 10) || null,
    bookCloseDate: (r.bookclose_date || "").match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null,
    distributionDate: (r.distribution_date || "").match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null,
  })).filter((d) => d.fiscalYear);
}

export interface AnnouncementRow { title: string; url: string; publishedDate: string | null; symbol?: string | null }

export async function ssCompanyAnnouncements(s: CompanySession, length = 50): Promise<AnnouncementRow[]> {
  const res = await ssPost(s, "company-announcements", { company: s.companyId, draw: "1", start: "0", length: String(length) });
  if (!res.ok) throw new Error(`company-announcements HTTP ${res.status}`);
  const j = (await res.json()) as { data?: { title: string; published_date: string }[] };
  return (j.data || []).map((r) => ({ title: stripTags(r.title), url: r.title.match(/href='([^']+)'/)?.[1] ?? r.title.match(/href="([^"]+)"/)?.[1] ?? "", publishedDate: r.published_date?.slice(0, 10) ?? null, symbol: s.symbol })).filter((a) => a.url);
}

/** Official corporate events (NEPSE filings mirrored by ShareSansar): AGM notices and minutes, auditor appointments, reports, book closures. */
export async function ssCompanyEvents(s: CompanySession, length = 50): Promise<AnnouncementRow[]> {
  const res = await ssPost(s, "company-events", { company: s.companyId, draw: "1", start: "0", length: String(Math.min(length, 50)) });
  if (!res.ok) throw new Error(`company-events HTTP ${res.status}`);
  const j = (await res.json()) as { data?: { title: string; published_date: string }[] };
  return (j.data || []).map((r) => ({ title: stripTags(r.title), url: r.title.match(/href='([^']+)'/)?.[1] ?? r.title.match(/href="([^"]+)"/)?.[1] ?? "", publishedDate: r.published_date?.slice(0, 10) ?? null, symbol: s.symbol })).filter((a) => a.url);
}

/** What a filing is about, for the Reports & audit view. */
export function classifyFiling(title: string): string {
  const t = title.toLowerCase();
  if (/audit(ed)? (report|financial)|annual (report|financial)|audited/.test(t)) return "Audited / annual report";
  if (/unaudited|quarter|q[1-4]\b|financial (statement|report|highlight)/.test(t)) return "Quarterly results";
  if (/auditor/.test(t)) return "Auditor appointment";
  if (/minute/.test(t)) return "AGM minutes";
  if (/\bagm\b|\bsgm\b|\begm\b|general meeting/.test(t)) return "AGM / SGM";
  if (/dividend|bonus|right share/.test(t)) return "Dividend / bonus / rights";
  if (/book clos/.test(t)) return "Book closure";
  return "Other";
}

export interface QuarterlyStatement { period: string | null; items: { statement: "balance_sheet" | "income" | "metrics"; label: string; value: number | null }[] }

export async function ssQuarterlyReport(s: CompanySession, sector: string): Promise<QuarterlyStatement> {
  const res = await ssPost(s, "company-quarterly-report", { company: s.companyId, symbol: s.symbol, sector });
  if (!res.ok) throw new Error(`company-quarterly-report HTTP ${res.status}`);
  return parseQuarterlyHtml(await res.text());
}

export function parseQuarterlyHtml(html: string): QuarterlyStatement {
  const tables = html.split(/<table/).slice(1);
  const items: QuarterlyStatement["items"] = [];
  let period: string | null = null;
  tables.forEach((t, ti) => {
    const statement = ti === 0 ? "balance_sheet" : ti === 1 ? "income" : "metrics";
    for (const tr of t.split(/<tr[^>]*>/).slice(1)) {
      const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => stripTags(m[1]));
      if (!cells.length) continue;
      if (/^particulars/i.test(cells[0])) { if (!period && cells[1]) period = cells[1]; continue; }
      if (cells.length < 2) continue; // section headings like "Assets"
      items.push({ statement, label: cells[0], value: num(cells[1]) });
    }
  });
  return { period, items };
}

export async function ssMarketAnnouncements(pages = 1): Promise<AnnouncementRow[]> {
  const out: AnnouncementRow[] = [];
  for (let p = 0; p < pages; p++) {
    const html = await fetchText(`${SS}/announcement?draw=1&start=${p * 50}&length=50`, { headers: { "X-Requested-With": "XMLHttpRequest" }, browserLike: true });
    for (const m of html.matchAll(/<a href="(https:\/\/www\.sharesansar\.com\/announcementdetail\/[^"]+)"\s+title="([^"]{8,400})"/g)) {
      const url = m[1];
      if (out.some((o) => o.url === url)) continue;
      out.push({ title: decodeHtml(m[2]).trim(), url, publishedDate: url.match(/(\d{4}-\d{2}-\d{2})$/)?.[1] ?? null });
    }
  }
  return out;
}

export interface NewsRow { title: string; url: string; publishedDate: string | null; category: string }

export async function ssNews(category = "latest"): Promise<NewsRow[]> {
  const html = await fetchText(`${SS}/category/${category}`, { browserLike: true });
  const out: NewsRow[] = [];
  for (const m of html.matchAll(/<a href="(https:\/\/www\.sharesansar\.com\/newsdetail\/[^"]+)"[^>]*>\s*(?:<[^>]+>\s*)*([^<]{10,300})/g)) {
    const url = m[1];
    const date = url.match(/(\d{4}-\d{2}-\d{2})$/)?.[1] ?? null;
    if (!date || out.some((o) => o.url === url)) continue; // undated links are evergreen promos
    out.push({ title: decodeHtml(m[2]).trim(), url, publishedDate: date, category });
  }
  return out;
}

// ---------------- NRB ----------------
export interface ForexRow { date: string; currency: string; unit: number; buy: number | null; sell: number | null }

export async function nrbForex(from: string, to: string): Promise<ForexRow[]> {
  const j = await fetchJson<{ data?: { payload?: { date: string; rates: { currency: { iso3: string; unit: number }; buy: string; sell: string }[] }[] } }>(
    `https://www.nrb.org.np/api/forex/v1/rates?page=1&per_page=100&from=${from}&to=${to}`,
  );
  const out: ForexRow[] = [];
  for (const day of j.data?.payload || []) for (const r of day.rates) out.push({ date: day.date, currency: r.currency.iso3, unit: r.currency.unit, buy: num(r.buy), sell: num(r.sell) });
  return out;
}

export function classifyAnnouncement(title: string): string {
  const t = title.toLowerCase();
  if (/quarter|q[1-4]\b|unaudited|financial (report|statement)|net profit/.test(t)) return "Quarterly report";
  if (/bonus/.test(t) && /dividend|share/.test(t)) return "Dividend / bonus";
  if (/dividend/.test(t)) return "Dividend / bonus";
  if (/right share|rights? issue/.test(t)) return "Right share";
  if (/\bagm\b|annual general meeting|\bsgm\b/.test(t)) return "AGM / SGM";
  if (/\bipo\b|\bfpo\b|initial public|further public/.test(t)) return "IPO / FPO";
  if (/merger|acquisition|acquire|merge/.test(t)) return "Merger / acquisition";
  if (/book clos/.test(t)) return "Book closure";
  if (/debenture|bond/.test(t)) return "Debenture";
  if (/auction/.test(t)) return "Auction";
  if (/annual report|audited/.test(t)) return "Annual report";
  return "Disclosure";
}

// ---------------- Issues (IPO / FPO / rights) and mutual fund NAVs ----------------
export const ISSUE_TYPES: { type: number; label: string }[] = [
  { type: 1, label: "IPO" }, { type: 2, label: "FPO" }, { type: 3, label: "Right share" }, { type: 4, label: "Mutual fund" },
  { type: 5, label: "IPO (local quota)" }, { type: 7, label: "IPO (foreign-employed quota)" }, { type: 8, label: "IPO (QIIs)" },
];

export interface IssueRow {
  issueType: string; symbol: string | null; company: string; ratio: string | null; units: number | null; price: number | null;
  priceLow: number | null; priceHigh: number | null; cutoff: number | null; openingDate: string | null; closingDate: string | null; finalDate: string | null;
  listingDate: string | null; issueManager: string | null; status: number | null; shareType: string | null; ssCompanyId: number | null;
}

const d10 = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

export async function ssIssues(type: number, max = 200): Promise<IssueRow[]> {
  const label = ISSUE_TYPES.find((t) => t.type === type)?.label ?? String(type);
  const out: IssueRow[] = [];
  for (let start = 0; start < max; start += 50) {
    const j = await fetchJson<{ recordsTotal: number; data: Record<string, unknown>[] }>(`${SS}/existing-issues?type=${type}&draw=1&start=${start}&length=50`, { headers: { "X-Requested-With": "XMLHttpRequest" }, browserLike: true });
    for (const r of j.data || []) {
      const c = (r.company || {}) as Record<string, string>;
      out.push({
        issueType: label, symbol: stripTags(c.symbol || "").toUpperCase() || null, company: stripTags(c.companyname || ""), ratio: (r.ratio_value as string) || null,
        units: num(r.total_units as string), price: num(r.issue_price as string), priceLow: num(r.issue_prrng_low as string), priceHigh: num(r.issue_prrng_high as string),
        cutoff: num(r.cutoff_price as string), openingDate: d10(r.opening_date), closingDate: d10(r.closing_date), finalDate: d10(r.final_date), listingDate: d10(r.listing_date),
        issueManager: (r.issue_manager as string) || null, status: typeof r.status === "number" ? r.status : num(r.status as string), shareType: (r.displayable_share_type as string) || null,
        ssCompanyId: num(r.companyid as string),
      });
    }
    if (!j.data || j.data.length < 50 || start + 50 >= j.recordsTotal) break;
  }
  return out;
}

export interface FundNavRow { symbol: string; name: string; kind: "active" | "matured"; fundSize: number | null; maturityDate: string | null; maturityPeriod: string | null; dailyNav: number | null; dailyDate: string | null; weeklyNav: number | null; weeklyDate: string | null; monthlyNav: number | null; monthlyDate: string | null; ltp: number | null; ltpDate: string | null; premiumPct: number | null }

export async function ssFundNavs(): Promise<FundNavRow[]> {
  const out: FundNavRow[] = [];
  for (const [type, kind] of [[-1, "active"], [1, "matured"]] as const) {
    const rows: Record<string, unknown>[] = [];
    for (let start = 0; start < 400; start += 50) {
      const j = await fetchJson<{ recordsTotal: number; data: Record<string, unknown>[] }>(`${SS}/mutual-fund-navs?type=${type}&draw=1&start=${start}&length=50`, { headers: { "X-Requested-With": "XMLHttpRequest" }, browserLike: true });
      rows.push(...(j.data || []));
      if (!j.data || j.data.length < 50 || start + 50 >= j.recordsTotal) break;
    }
    for (const r of rows) {
      out.push({
        symbol: String(r.symbol || "").toUpperCase(), name: stripTags(String(r.companyname || "")), kind, fundSize: num(r.fund_size as string), maturityDate: d10(r.maturity_date),
        maturityPeriod: (r.maturity_period as string) || null, dailyNav: num(r.daily_nav_price as string), dailyDate: d10(r.daily_date), weeklyNav: num(r.weekly_nav_price as string), weeklyDate: d10(r.weekly_date),
        monthlyNav: num(r.monthly_nav_price as string), monthlyDate: (r.monthly_date as string) || null, ltp: num(r.close as string), ltpDate: d10(r.published_date),
        premiumPct: typeof r.prem_dis === "number" ? Math.round(r.prem_dis * 100) / 100 : num(r.prem_dis as string),
      });
    }
  }
  return out.filter((r) => r.symbol);
}

// ---------------- NRB official rates and macro report ----------------
// nrb.org.np robots.txt allows crawling. Rates pages: policy rates, T-bill yields, interbank,
// and NRB's published weighted-average deposit / fixed-deposit / lending rates, each with its date.
export interface NrbRate { key: string; grp: string; label: string; value: number; asOf: string | null; prevValue: number | null; prevAsOf: string | null; sourceUrl: string }

const NRB = "https://www.nrb.org.np";
const toIso = (s: string | undefined) => { if (!s) return null; const d = new Date(`${s} UTC`); return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1990 ? null : d.toISOString().slice(0, 10); };
const slug = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** Parses an NRB rates page: tables of "Rate Type | Current Rate (Last updated: date) | Previous Rate (date)". */
export function parseNrbRates(html: string, sourceUrl: string, groups: string[]): NrbRate[] {
  const out: NrbRate[] = [];
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]);
  tables.forEach((t, ti) => {
    const grp = groups[ti];
    if (!grp) return;
    for (const r of t.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
      const cells = [...r.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => stripTags(c[1]));
      if (cells.length < 3 || /^Rate Type$/i.test(cells[0])) continue;
      const label = cells[0].replace(/Last updated:.*$/i, "").trim();
      const cur = cells[1].match(/^(-?[\d.]+)\s+(.+)$/), prev = cells[2].match(/^(-?[\d.]+)\s+(.+)$/);
      const value = cur ? Number(cur[1]) : NaN;
      const asOf = toIso(cur?.[2] ?? cells[0].match(/Last updated:\s*(.+)$/i)?.[1]);
      if (!Number.isFinite(value) || !asOf || value === 0) continue; // 0.0000 / 1970 rows are unused instruments
      out.push({ key: `${grp}.${slug(label)}`, grp, label, value, asOf, prevValue: prev ? Number(prev[1]) : null, prevAsOf: toIso(prev?.[2]), sourceUrl });
    }
  });
  return out;
}

export async function nrbRates(): Promise<NrbRate[]> {
  const pages: [string, string[]][] = [
    ["policy_rates", ["policy", "crr", "refinance", "bank_rate", "slf"]],
    ["short_term_rates", ["tbill", "repo", "interbank", "reverse_repo", "deposit_collection"]],
    ["lending_rates", ["deposit", "lending", "base_rate", "interbank_monthly"]],
  ];
  const out: NrbRate[] = [];
  for (const [p, groups] of pages) {
    const url = `${NRB}/cmfm_rates/${p}`;
    // NRB serves these pages with full content but an HTTP 404 status, so accept any page that has the rate tables.
    const res = await politeFetch(url, { browserLike: true });
    const html = await res.text();
    if (!/Rate Type/.test(html)) throw new Error(`HTTP ${res.status}: no rate tables at ${url}`);
    out.push(...parseNrbRates(html, url, groups));
  }
  return out;
}

export interface MacroReport { url: string; pdfUrl: string; title: string; published: string | null; inflation: number | null; highlights: string[] }

/** Parses the text of NRB's "Current Macroeconomic and Financial Situation" (English) report. */
export function parseMacroText(text: string): { published: string | null; inflation: number | null; highlights: string[]; period: string | null } {
  const t = text.replace(/\s+/g, " ");
  const inflation = num(t.match(/CPI-based inflation (?:remained|stood) at ([\d.]+) percent/i)?.[1] ?? t.match(/consumer price inflation stood at ([\d.]+) percent/i)?.[1]);
  const period = t.match(/Based on ([A-Za-z]+ Months? Data \(Ending [^)]+\) of \d{4}\/\d{2})/i)?.[1] ?? null;
  const pub = t.match(/(\d{4}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2})/);
  const published = pub ? toIso(`${pub[2]} ${pub[3]}, ${pub[1]}`) : null;
  // The first page lists the headline points as bullets.
  const first = t.split(/Inflation Consumer Price Inflation/i)[0];
  const highlights = first.split("▪").slice(1).map((s) => s.replace(/\s*\d{4} (January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}.*$/, "").trim()).filter((s) => s.length > 15 && s.length < 400);
  return { published, inflation, highlights, period };
}

export async function nrbMacroReport(): Promise<MacroReport | null> {
  const homeRes = await politeFetch(`${NRB}/`, { browserLike: true, timeoutMs: 60_000 });
  const home = await homeRes.text();
  const link = [...home.matchAll(/href="(https:\/\/www\.nrb\.org\.np\/red\/current-macroeconomic-and-financial-situation-english-[^"]+)"/g)].map((m) => m[1]).find((u) => !/tables|nepali/.test(u));
  if (!link) return null;
  const res = await politeFetch(link, { browserLike: true, timeoutMs: 60_000 });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${link}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (String.fromCharCode(...buf.slice(0, 4)) !== "%PDF") return null;
  const { extractText, getDocumentProxy } = await import("unpdf");
  const { text } = await extractText(await getDocumentProxy(buf), { mergePages: true });
  const p = parseMacroText(text as string);
  const title = `Current Macroeconomic and Financial Situation${p.period ? ` (${p.period})` : ""}`;
  return { url: link, pdfUrl: res.url, title, published: p.published, inflation: p.inflation, highlights: p.highlights };
}

/** The notice image on a ShareSansar announcement page (banks publish their monthly rates as images). */
export async function ssAnnouncementImage(url: string): Promise<string | null> {
  const html = await fetchText(url, { browserLike: true });
  return html.match(/https:\/\/content\.sharesansar\.com\/photos\/shares\/announcement\/[^"'\s)]+\.(?:jpe?g|png|webp)/i)?.[0] ?? null;
}

/** Images and PDFs attached to a ShareSansar announcement or event page (audited statements are published as images). */
export async function ssAttachments(url: string): Promise<{ images: string[]; pdfs: string[] }> {
  const html = await fetchText(url, { browserLike: true });
  const body = html.replace(/<footer[\s\S]*$/i, "");
  const enc = (u: string) => encodeURI(decodeURI(u.trim()));
  const images = [...new Set([...body.matchAll(/https:\/\/content\.sharesansar\.com\/photos\/shares\/(?:announcement|events?)\/[^"'<>]+?\.(?:jpe?g|png|webp)/gi)].map((m) => enc(m[0])))];
  const pdfs = [...new Set([...body.matchAll(/https?:\/\/(?:www\.)?nepalstock\.com\.np\/api\/nots\/security\/fetchFiles\?fileLocation=[^"'<>\s]+|https?:\/\/[^"'<>\s]+\.pdf/gi)].map((m) => m[0].replace(/&amp;/g, "&")))].filter((u) => !/Help\.pdf/i.test(u));
  return { images, pdfs };
}

/** "fiscal year 2081/82" or "208182" in a title -> "2081/82". */
export function fiscalYearOf(title: string): string | null {
  const m = title.match(/(20\d{2})\s*[/-]\s*(\d{2,4})/) ?? title.match(/(20\d{2})(\d{2})(?!\d)/);
  if (!m) return null;
  return `${m[1]}/${m[2].slice(-2)}`;
}
