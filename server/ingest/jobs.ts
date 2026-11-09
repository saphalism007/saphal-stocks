// Ingestion jobs: fetch from providers, validate, upsert, and record freshness.
// Jobs run through a single in-process queue so we never hammer a provider.
import { db, all, get, run, tx, nowIso, getSetting, setSetting } from "../db.ts";
import * as P from "./providers.ts";
import { parsePeriod } from "../../shared/fundamentals.ts";
import { fetchJson } from "../lib/fetcher.ts";
import { GUIDE_URLS } from "../../shared/guide.ts";
import { metalItem } from "../../shared/money.ts";

export type JobName = "listing" | "history" | "indices" | "details" | "news" | "forex" | "alerts";

interface JobState { name: string; status: "queued" | "running" | "done" | "error"; progress: number; total: number; message: string; startedAt?: string; finishedAt?: string }
const state = new Map<string, JobState>();
const queue: { name: string; fn: (s: JobState) => Promise<number> }[] = [];
let running = false;
const afterHooks: ((job: string) => void)[] = [];

export const onJobDone = (fn: (job: string) => void) => afterHooks.push(fn);
export const jobStates = () => [...state.values()];

export function enqueue(name: string, fn: (s: JobState) => Promise<number>) {
  const existing = state.get(name);
  if (existing && (existing.status === "queued" || existing.status === "running")) return existing;
  const s: JobState = { name, status: "queued", progress: 0, total: 0, message: "Waiting" };
  state.set(name, s);
  queue.push({ name, fn });
  void pump();
  return s;
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift()!;
    const s = state.get(job.name)!;
    s.status = "running";
    s.startedAt = nowIso();
    s.message = "Running";
    const runId = Number(run("INSERT INTO ingest_runs (job, started_at, status) VALUES (?, ?, 'running')", job.name, s.startedAt).lastInsertRowid);
    try {
      const rows = await job.fn(s);
      s.status = "done";
      s.message = `Done (${rows} rows)`;
      run("UPDATE ingest_runs SET finished_at = ?, status = 'ok', rows = ?, message = ? WHERE id = ?", nowIso(), rows, s.message, runId);
    } catch (e) {
      s.status = "error";
      s.message = e instanceof Error ? e.message : String(e);
      run("UPDATE ingest_runs SET finished_at = ?, status = 'error', message = ? WHERE id = ?", nowIso(), s.message.slice(0, 1000), runId);
      console.error(`[ingest] ${job.name} failed:`, s.message);
    }
    s.finishedAt = nowIso();
    for (const h of afterHooks) { try { h(job.name); } catch (e) { console.error(e); } }
  }
  running = false;
}

function fresh(dataset: string, source: { name: string; url: string }, asOf: string | null, rows: number) {
  run(
    `INSERT INTO data_freshness (dataset, source, source_url, last_success_at, as_of, rows) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(dataset) DO UPDATE SET source = excluded.source, source_url = excluded.source_url, last_success_at = excluded.last_success_at, as_of = COALESCE(excluded.as_of, data_freshness.as_of), rows = excluded.rows`,
    dataset, source.name, source.url, nowIso(), asOf, rows,
  );
}
function freshError(dataset: string, err: string) {
  run(`INSERT INTO data_freshness (dataset, last_error, last_error_at) VALUES (?, ?, ?) ON CONFLICT(dataset) DO UPDATE SET last_error = excluded.last_error, last_error_at = excluded.last_error_at`, dataset, err.slice(0, 500), nowIso());
}

const upsertPrice = () => db.prepare(
  `INSERT INTO prices (symbol, date, open, high, low, close, volume, amount, trades, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(symbol, date) DO UPDATE SET open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close,
   volume = excluded.volume, amount = COALESCE(excluded.amount, prices.amount), trades = COALESCE(excluded.trades, prices.trades), source = excluded.source`,
);

// ---------- listing + latest prices ----------
export async function syncListing(s?: JobState): Promise<number> {
  try {
    const [sec, today] = [await P.ssSectorListing(), await P.ssTodayPrices()];
    if (!today.rows.length) throw new Error("No rows parsed from today-share-price");
    const now = nowIso();
    const asOf = today.asOf || sec.asOf;
    if (!asOf) throw new Error("Could not read the trading date from the price page");
    const up = upsertPrice();
    tx(() => {
      const upCo = db.prepare(`INSERT INTO companies (symbol, name, sector, updated_at, source) VALUES (?, ?, ?, ?, 'ShareSansar')
        ON CONFLICT(symbol) DO UPDATE SET name = COALESCE(excluded.name, companies.name), sector = COALESCE(excluded.sector, companies.sector), updated_at = excluded.updated_at, status = 'active'`);
      for (const c of sec.companies) upCo.run(c.symbol, c.name, c.sector, now);
      const ins = db.prepare(`INSERT INTO companies (symbol, updated_at, source) VALUES (?, ?, 'ShareSansar') ON CONFLICT(symbol) DO UPDATE SET status = 'active'`);
      const q = db.prepare(`INSERT INTO quotes (symbol, date, open, high, low, close, ltp, prev_close, change, change_pct, vwap, volume, turnover, trades, high52, low52, fetched_at, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ShareSansar') ON CONFLICT(symbol) DO UPDATE SET date = excluded.date, open = excluded.open, high = excluded.high,
        low = excluded.low, close = excluded.close, ltp = excluded.ltp, prev_close = excluded.prev_close, change = excluded.change, change_pct = excluded.change_pct,
        vwap = excluded.vwap, volume = excluded.volume, turnover = excluded.turnover, trades = excluded.trades, high52 = excluded.high52, low52 = excluded.low52, fetched_at = excluded.fetched_at`);
      for (const r of today.rows) {
        if (r.close == null || r.close <= 0) continue;
        ins.run(r.symbol, now);
        q.run(r.symbol, asOf, r.open, r.high, r.low, r.close, r.ltp, r.prevClose, r.diff, r.diffPct, r.vwap, r.volume, r.turnover, r.trades, r.high52, r.low52, now);
        // Validation: OHLC must be consistent before it enters the price history.
        const o = r.open ?? r.close, h = Math.max(r.high ?? r.close, o, r.close), l = Math.min(r.low ?? r.close, o, r.close);
        if ((r.volume ?? 0) > 0) up.run(r.symbol, asOf, o, h, l, r.close, r.volume, r.turnover, r.trades, "ShareSansar");
      }
    });
    fresh("prices_latest", P.SOURCES.sharesansar, asOf, today.rows.length);
    fresh("companies", P.SOURCES.sharesansar, sec.asOf, sec.companies.length);
    if (s) s.message = `${today.rows.length} quotes as of ${asOf}`;
    return today.rows.length;
  } catch (e) {
    freshError("prices_latest", String(e));
    throw e;
  }
}

// ---------- historical OHLCV ----------
export async function syncHistory(s?: JobState, opts: { symbols?: string[]; force?: boolean } = {}): Promise<number> {
  let symbols = opts.symbols ?? all<{ symbol: string }>("SELECT symbol FROM companies WHERE status = 'active' ORDER BY symbol").map((r) => r.symbol);
  if (!opts.force) {
    // Skip symbols that already have deep history (daily rows are appended by the listing job).
    const have = new Map(all<{ symbol: string; n: number }>("SELECT symbol, COUNT(*) n FROM prices GROUP BY symbol").map((r) => [r.symbol, r.n]));
    symbols = symbols.filter((sym) => (have.get(sym) ?? 0) < 30);
  }
  if (s) { s.total = symbols.length; s.progress = 0; }
  let rows = 0;
  let missing = 0;
  const up = upsertPrice();
  for (const sym of symbols) {
    try {
      const hist = await P.nepseDataHistory(sym);
      if (!hist) { missing++; continue; }
      tx(() => { for (const r of hist) up.run(sym, r.date, r.open, r.high, r.low, r.close, r.volume, r.amount, null, "nepse-data"); });
      rows += hist.length;
    } catch (e) {
      console.warn(`[history] ${sym}: ${e instanceof Error ? e.message : e}`);
    }
    if (s) { s.progress++; s.message = `${sym} (${s.progress}/${s.total})`; }
  }
  const maxDate = get<{ d: string }>("SELECT MAX(date) d FROM prices")?.d ?? null;
  fresh("prices_history", P.SOURCES.nepseData, maxDate, rows);
  if (s) s.message = `${rows} rows; ${missing} symbols not in dataset`;
  return rows;
}

// ---------- indices ----------
export async function syncIndices(s?: JobState): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  let rows = 0;
  if (s) { s.total = P.SS_INDICES.length; s.progress = 0; }
  const ins = db.prepare(`INSERT INTO indices (index_id, name, date, open, high, low, close, change, change_pct, turnover, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ShareSansar')
    ON CONFLICT(index_id, date) DO UPDATE SET open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, change = excluded.change, change_pct = excluded.change_pct, turnover = excluded.turnover`);
  for (const ix of P.SS_INDICES) {
    const lastDate = get<{ d: string }>("SELECT MAX(date) d FROM indices WHERE index_id = ?", ix.id)?.d;
    const defaultStart = ix.id === 12 ? "2012-01-01" : new Date(Date.now() - 3 * 365 * 86_400_000).toISOString().slice(0, 10);
    const from = lastDate ? new Date(Date.parse(lastDate) - 7 * 86_400_000).toISOString().slice(0, 10) : defaultStart;
    try {
      const data = await P.ssIndexHistory(ix.id, from, today);
      tx(() => { for (const r of data) ins.run(ix.id, ix.name, r.date, r.open, r.high, r.low, r.close, r.change, r.changePct, r.turnover); });
      rows += data.length;
    } catch (e) {
      console.warn(`[indices] ${ix.name}: ${e instanceof Error ? e.message : e}`);
    }
    if (s) { s.progress++; s.message = `${ix.name} (${s.progress}/${s.total})`; }
  }
  fresh("indices", P.SOURCES.sharesansar, get<{ d: string }>("SELECT MAX(date) d FROM indices WHERE index_id = 12")?.d ?? null, rows);
  return rows;
}

// ---------- company details (profile, dividends, announcements, quarterly report) ----------
export async function syncCompanyDetail(symbol: string): Promise<{ dividends: number; announcements: number; report: string | null }> {
  const sess = await P.ssCompanySession(symbol);
  const info = P.parseCompanyInfo(sess);
  const now = nowIso();
  run(`UPDATE companies SET name = COALESCE(?, name), sector = COALESCE(?, sector), listed_shares = COALESCE(?, listed_shares), paid_up_value = COALESCE(?, paid_up_value),
       total_paid_up = COALESCE(?, total_paid_up), operation_date = ?, email = ?, phone = ?, address = ?, website = ?, registrar = ?, ss_company_id = ?, info_fetched_at = ? WHERE symbol = ?`,
    info.name, info.sector, info.listedShares, info.paidUpValue, info.totalPaidUp, info.operationDate, info.email, info.phone, info.address, info.website, info.registrar, info.companyId, now, symbol);
  const sector = info.sector || get<{ sector: string }>("SELECT sector FROM companies WHERE symbol = ?", symbol)?.sector || "";

  const divs = await P.ssDividends(sess);
  tx(() => {
    const st = db.prepare(`INSERT INTO dividends (symbol, fiscal_year, cash_pct, bonus_pct, total_pct, announcement_date, bookclose_date, distribution_date, source, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ShareSansar', ?) ON CONFLICT(symbol, fiscal_year) DO UPDATE SET cash_pct = excluded.cash_pct, bonus_pct = excluded.bonus_pct,
      total_pct = excluded.total_pct, announcement_date = excluded.announcement_date, bookclose_date = excluded.bookclose_date, distribution_date = excluded.distribution_date, fetched_at = excluded.fetched_at`);
    for (const d of divs) st.run(symbol, d.fiscalYear, d.cashPct, d.bonusPct, d.totalPct, d.announcementDate, d.bookCloseDate, d.distributionDate, now);
  });

  const anns = await P.ssCompanyAnnouncements(sess, 50);
  saveAnnouncements(anns, symbol);
  try {
    const evs = await P.ssCompanyEvents(sess, 50);
    const st = db.prepare("INSERT INTO company_events (url, symbol, title, published_date, kind, fetched_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(url) DO UPDATE SET title = excluded.title, kind = excluded.kind");
    tx(() => { for (const e of evs) st.run(e.url, symbol, e.title, e.publishedDate, P.classifyFiling(e.title), now); });
  } catch (e) { console.warn(`[details] events ${symbol}: ${e instanceof Error ? e.message : e}`); }

  let period: string | null = null;
  try {
    const q = await P.ssQuarterlyReport(sess, sector);
    if (q.period && q.items.length >= 5) {
      const pp = parsePeriod(q.period);
      if (pp) {
        period = q.period;
        tx(() => {
          run(`INSERT INTO reports (symbol, period, fiscal_year, quarter, source, fetched_at) VALUES (?, ?, ?, ?, 'ShareSansar (company quarterly report)', ?)
               ON CONFLICT(symbol, fiscal_year, quarter) DO UPDATE SET period = excluded.period, fetched_at = excluded.fetched_at`, symbol, q.period, pp.fiscalYear, pp.quarter, now);
          const rid = get<{ id: number }>("SELECT id FROM reports WHERE symbol = ? AND fiscal_year = ? AND quarter = ?", symbol, pp.fiscalYear, pp.quarter)!.id;
          run("DELETE FROM report_items WHERE report_id = ?", rid);
          const ins = db.prepare("INSERT INTO report_items (report_id, ord, statement, label, value) VALUES (?, ?, ?, ?, ?)");
          q.items.forEach((it, i) => ins.run(rid, i, it.statement, it.label, it.value));
        });
      }
    }
  } catch (e) {
    console.warn(`[details] quarterly report ${symbol}: ${e instanceof Error ? e.message : e}`);
  }
  return { dividends: divs.length, announcements: anns.length, report: period };
}

export function saveAnnouncements(anns: P.AnnouncementRow[], symbol?: string | null) {
  const now = nowIso();
  const st = db.prepare(`INSERT INTO announcements (symbol, title, url, published_date, category, source, fetched_at) VALUES (?, ?, ?, ?, ?, 'ShareSansar', ?)
    ON CONFLICT(url) DO UPDATE SET symbol = COALESCE(announcements.symbol, excluded.symbol)`);
  tx(() => { for (const a of anns) st.run(a.symbol ?? symbol ?? null, a.title, a.url, a.publishedDate, P.classifyAnnouncement(a.title), now); });
}

export async function syncAllDetails(s?: JobState, opts: { maxAgeDays?: number; symbols?: string[] } = {}): Promise<number> {
  const maxAge = opts.maxAgeDays ?? 7;
  const cutoff = new Date(Date.now() - maxAge * 86_400_000).toISOString();
  // Priority: portfolio + watchlist symbols first, then the rest by turnover.
  const priority = new Set(all<{ symbol: string }>("SELECT DISTINCT symbol FROM transactions UNION SELECT DISTINCT symbol FROM watchlist_items").map((r) => r.symbol));
  let list = opts.symbols ?? all<{ symbol: string }>(
    `SELECT c.symbol FROM companies c LEFT JOIN quotes q ON q.symbol = c.symbol WHERE c.status = 'active' AND (c.info_fetched_at IS NULL OR c.info_fetched_at < ?)
     ORDER BY COALESCE(q.turnover, 0) DESC`, cutoff).map((r) => r.symbol);
  list = [...list.filter((x) => priority.has(x)), ...list.filter((x) => !priority.has(x))];
  if (s) { s.total = list.length; s.progress = 0; }
  let ok = 0;
  for (const sym of list) {
    try { await syncCompanyDetail(sym); ok++; } catch (e) { console.warn(`[details] ${sym}: ${e instanceof Error ? e.message : e}`); }
    if (s) { s.progress++; s.message = `${sym} (${s.progress}/${s.total})`; }
  }
  fresh("company_details", P.SOURCES.sharesansar, new Date().toISOString().slice(0, 10), ok);
  return ok;
}

// ---------- news + market announcements ----------
export async function syncNews(): Promise<number> {
  const anns = await P.ssMarketAnnouncements(1);
  // Map announcement titles to symbols by company name.
  const companies = all<{ symbol: string; name: string }>("SELECT symbol, name FROM companies WHERE name IS NOT NULL");
  for (const a of anns) {
    const hit = companies.find((c) => a.title.toLowerCase().startsWith(c.name.toLowerCase().replace(/\s+limited$/, "")));
    if (hit) a.symbol = hit.symbol;
  }
  saveAnnouncements(anns);
  let n = anns.length;
  for (const cat of ["latest", "ipo-fpo-news", "dividend-right-bonus"]) {
    try {
      const news = await P.ssNews(cat);
      const st = db.prepare(`INSERT INTO announcements (symbol, title, url, published_date, category, source, fetched_at) VALUES (NULL, ?, ?, ?, ?, 'ShareSansar news', ?) ON CONFLICT(url) DO NOTHING`);
      tx(() => { for (const r of news) st.run(r.title, r.url, r.publishedDate, "News", nowIso()); });
      n += news.length;
    } catch (e) {
      console.warn(`[news] ${cat}: ${e instanceof Error ? e.message : e}`);
    }
  }
  fresh("news", P.SOURCES.sharesansar, new Date().toISOString().slice(0, 10), n);
  return n;
}

export async function syncForex(): Promise<number> {
  // Backfill one year on first run (the API pages by up to 100 days), then the last 30 days.
  const haveFrom = get<{ d: string }>("SELECT MIN(date) d FROM forex")?.d;
  const today = Date.now();
  const start = !haveFrom || haveFrom > new Date(today - 330 * 86_400_000).toISOString().slice(0, 10) ? today - 365 * 86_400_000 : today - 30 * 86_400_000;
  const st = db.prepare("INSERT INTO forex (date, currency, unit, buy, sell) VALUES (?, ?, ?, ?, ?) ON CONFLICT(date, currency) DO UPDATE SET buy = excluded.buy, sell = excluded.sell, unit = excluded.unit");
  let n = 0;
  for (let t = start; t < today; t += 90 * 86_400_000) {
    const from = new Date(t).toISOString().slice(0, 10);
    const to = new Date(Math.min(today, t + 89 * 86_400_000)).toISOString().slice(0, 10);
    const rows = await P.nrbForex(from, to);
    tx(() => { for (const r of rows) st.run(r.date, r.currency, r.unit, r.buy, r.sell); });
    n += rows.length;
  }
  fresh("forex", P.SOURCES.nrb, get<{ d: string }>("SELECT MAX(date) d FROM forex")?.d ?? null, n);
  return n;
}

/** Symbols listed in the nepse-data repository (one GitHub API call). */
export async function nepseDataSymbols(): Promise<string[]> {
  const j = await fetchJson<{ tree: { path: string }[] }>("https://api.github.com/repos/Aabishkar2/nepse-data/git/trees/main?recursive=1");
  return j.tree.map((t) => t.path.match(/^data\/company-wise\/([A-Z0-9]+)\.csv$/)?.[1]).filter(Boolean) as string[];
}

// ---------- public issues & mutual funds ----------
export async function syncIssues(): Promise<number> {
  const now = nowIso();
  let n = 0;
  const st = db.prepare(`INSERT INTO issues (issue_type, symbol, company, ratio, units, price, price_low, price_high, cutoff, opening_date, closing_date, final_date, listing_date, issue_manager, status, share_type, ss_company_id, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(issue_type, ss_company_id, opening_date, units) DO UPDATE SET symbol = excluded.symbol, company = excluded.company, ratio = excluded.ratio, price = excluded.price,
    price_low = excluded.price_low, price_high = excluded.price_high, cutoff = excluded.cutoff, closing_date = excluded.closing_date, final_date = excluded.final_date,
    listing_date = excluded.listing_date, issue_manager = excluded.issue_manager, status = excluded.status, share_type = excluded.share_type, fetched_at = excluded.fetched_at`);
  for (const t of P.ISSUE_TYPES) {
    try {
      const rows = await P.ssIssues(t.type, t.type === 1 || t.type === 3 ? 150 : 50);
      tx(() => { for (const r of rows) st.run(r.issueType, r.symbol, r.company, r.ratio, r.units, r.price, r.priceLow, r.priceHigh, r.cutoff, r.openingDate ?? "", r.closingDate, r.finalDate, r.listingDate, r.issueManager, r.status, r.shareType, r.ssCompanyId ?? 0, now); });
      n += rows.length;
    } catch (e) { console.warn(`[issues] ${t.label}: ${e instanceof Error ? e.message : e}`); }
  }
  fresh("issues", P.SOURCES.sharesansar, new Date().toISOString().slice(0, 10), n);
  return n;
}

export async function syncFunds(): Promise<number> {
  const rows = await P.ssFundNavs();
  const now = nowIso();
  const st = db.prepare(`INSERT INTO fund_navs (symbol, name, kind, fund_size, maturity_date, maturity_period, daily_nav, daily_date, weekly_nav, weekly_date, monthly_nav, monthly_date, ltp, ltp_date, premium_pct, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET name = excluded.name, kind = excluded.kind, fund_size = excluded.fund_size, maturity_date = excluded.maturity_date,
    maturity_period = excluded.maturity_period, daily_nav = excluded.daily_nav, daily_date = excluded.daily_date, weekly_nav = excluded.weekly_nav, weekly_date = excluded.weekly_date,
    monthly_nav = excluded.monthly_nav, monthly_date = excluded.monthly_date, ltp = excluded.ltp, ltp_date = excluded.ltp_date, premium_pct = excluded.premium_pct, fetched_at = excluded.fetched_at`);
  const hist = db.prepare("INSERT OR IGNORE INTO fund_nav_history (symbol, date, nav, basis) VALUES (?, ?, ?, ?)");
  tx(() => {
    for (const r of rows) {
      st.run(r.symbol, r.name, r.kind, r.fundSize, r.maturityDate, r.maturityPeriod, r.dailyNav, r.dailyDate, r.weeklyNav, r.weeklyDate, r.monthlyNav, r.monthlyDate, r.ltp, r.ltpDate, r.premiumPct, now);
      // Keep every weekly NAV we see so NAV history builds up over time.
      if (r.weeklyNav != null && r.weeklyDate) hist.run(r.symbol, r.weeklyDate, r.weeklyNav, "weekly");
      if (r.dailyNav != null && r.dailyDate) hist.run(r.symbol, r.dailyDate, r.dailyNav, "daily");
    }
  });
  fresh("mutual_funds", P.SOURCES.sharesansar, rows.reduce((m, r) => (r.weeklyDate && r.weeklyDate > m ? r.weeklyDate : m), ""), rows.length);
  return rows.length;
}

// ---------- NRB official rates and macro report ----------
export async function syncRates(): Promise<number> {
  const rows = await P.nrbRates();
  if (!rows.length) throw new Error("No rates found on the NRB pages (layout changed?)");
  const now = nowIso();
  tx(() => {
    for (const r of rows) {
      run(`INSERT INTO rates (key, grp, label, value, as_of, prev_value, prev_as_of, source_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET grp = excluded.grp, label = excluded.label, value = excluded.value, as_of = excluded.as_of, prev_value = excluded.prev_value, prev_as_of = excluded.prev_as_of, source_url = excluded.source_url, fetched_at = excluded.fetched_at`,
        r.key, r.grp, r.label, r.value, r.asOf, r.prevValue, r.prevAsOf, r.sourceUrl, now);
      run("INSERT OR REPLACE INTO rate_history (key, as_of, value) VALUES (?, ?, ?)", r.key, r.asOf, r.value);
      if (r.prevAsOf && r.prevValue != null) run("INSERT OR IGNORE INTO rate_history (key, as_of, value) VALUES (?, ?, ?)", r.key, r.prevAsOf, r.prevValue);
    }
  });
  fresh("rates", P.SOURCES.nrbRates, rows.reduce((m, r) => (r.asOf && r.asOf > m ? r.asOf : m), ""), rows.length);
  try {
    const m = await P.nrbMacroReport();
    if (m) {
      run(`INSERT INTO macro_reports (url, pdf_url, title, published, inflation, highlights, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET pdf_url = excluded.pdf_url, title = excluded.title, published = excluded.published, inflation = excluded.inflation, highlights = excluded.highlights, fetched_at = excluded.fetched_at`,
        m.url, m.pdfUrl, m.title, m.published, m.inflation, JSON.stringify(m.highlights), now);
      fresh("macro", P.SOURCES.nrbMacro, m.published, m.highlights.length);
    }
  } catch (e) { freshError("macro", e instanceof Error ? e.message : String(e)); }
  try { await syncRateNotices(); } catch (e) { freshError("rate_notices", e instanceof Error ? e.message : String(e)); }
  return rows.length;
}

/** Latest official deposit/loan rate notices from banks and finance companies (from stored announcements). */
export async function syncRateNotices(): Promise<number> {
  const rows = all<{ url: string; symbol: string | null; title: string; published_date: string }>(
    `SELECT url, symbol, title, published_date FROM announcements WHERE published_date >= date('now', '-75 days')
     AND (lower(title) LIKE '%interest rate%') AND lower(title) NOT LIKE '%loan%only%' ORDER BY published_date DESC`);
  const have = new Set(all<{ url: string }>("SELECT url FROM rate_notices").map((r) => r.url));
  let n = 0;
  for (const r of rows) {
    if (have.has(r.url)) continue;
    const inst = r.title.match(/^(.+?(?:Limited|Ltd\.?|Bank|Finance))\b/i)?.[1]?.trim() ?? r.title.split(" has ")[0];
    const c = r.symbol ? get<{ sector: string }>("SELECT sector FROM companies WHERE symbol = ?", r.symbol) : get<{ sector: string; symbol: string }>("SELECT sector, symbol FROM companies WHERE name = ? COLLATE NOCASE", inst);
    const sym = r.symbol ?? (c as { symbol?: string } | undefined)?.symbol ?? null;
    let img: string | null = null;
    try { img = await P.ssAnnouncementImage(r.url); } catch { /* keep the link without the image */ }
    const eff = r.title.match(/effective from ([^,.]+?\d{4})/i)?.[1] ?? null;
    run("INSERT OR REPLACE INTO rate_notices (url, symbol, institution, inst_type, title, published, image_url, effective, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", r.url, sym, inst, c?.sector ?? null, r.title, r.published_date, img, eff, nowIso());
    n++;
  }
  fresh("rate_notices", P.SOURCES.sharesansar, get<{ d: string }>("SELECT MAX(published) d FROM rate_notices")?.d ?? null, get<{ n: number }>("SELECT COUNT(*) n FROM rate_notices")?.n ?? 0);
  return n;
}

// ---------- audited financial statements ----------
/** For every company: the latest audited / annual-financial announcements (and NEPSE audit-report events), with their statement images or PDFs. */
export async function syncAuditDocs(s?: JobState, opts: { perCompany?: number } = {}): Promise<number> {
  const per = opts.perCompany ?? 2;
  const AUD = "(lower(title) LIKE '%audited%' OR lower(title) LIKE '%annual financial%' OR lower(title) LIKE '%annual report%' OR lower(title) LIKE '%audit report%' OR lower(title) LIKE '%financial statement of the fiscal year%')";
  const cands = all<{ symbol: string; title: string; url: string; published_date: string }>(`
    SELECT symbol, title, url, published_date FROM (
      SELECT symbol, title, url, published_date, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY published_date DESC) rn FROM (
        SELECT symbol, title, url, published_date FROM announcements WHERE symbol IS NOT NULL AND ${AUD} AND lower(title) NOT LIKE '%unaudited%'
        UNION SELECT symbol, title, url, published_date FROM company_events WHERE kind = 'Audited / annual report'))
    WHERE rn <= ${per} ORDER BY published_date DESC`);
  const have = new Set(all<{ url: string }>("SELECT url FROM audit_docs").map((r) => r.url));
  const todo = cands.filter((c) => !have.has(c.url));
  if (s) { s.total = todo.length; s.progress = 0; }
  let n = 0;
  for (const c of todo) {
    try {
      const a = await P.ssAttachments(c.url);
      run("INSERT OR REPLACE INTO audit_docs (url, symbol, fiscal_year, title, published, images, pdfs, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", c.url, c.symbol, P.fiscalYearOf(c.title), c.title, c.published_date, JSON.stringify(a.images), JSON.stringify(a.pdfs), nowIso());
      n++;
    } catch (e) { console.warn(`[audit] ${c.symbol}: ${e instanceof Error ? e.message : e}`); }
    if (s) { s.progress++; s.message = `${c.symbol} (${s.progress}/${s.total})`; }
  }
  fresh("audit_docs", P.SOURCES.sharesansar, get<{ d: string }>("SELECT MAX(published) d FROM audit_docs")?.d ?? null, get<{ n: number }>("SELECT COUNT(DISTINCT symbol) n FROM audit_docs")?.n ?? 0);
  return n;
}

// ---------- floorsheet ----------
/** Summarises every trade of the latest session per stock and per broker; keeps the last 15 sessions. */
export async function syncFloorsheet(s?: JobState): Promise<number> {
  // The floorsheet always shows the latest session; store each stock under the date of its trades.
  const pdate = get<{ d: string }>("SELECT MAX(date) d FROM prices")?.d;
  if (!pdate) return 0;
  const done = new Set(all<{ symbol: string }>("SELECT symbol FROM floorsheet_day WHERE date >= ?", pdate).map((r) => r.symbol));
  const syms = all<{ symbol: string }>("SELECT symbol FROM prices WHERE date = ? AND volume > 0 ORDER BY amount DESC", pdate).map((r) => r.symbol).filter((x) => !done.has(x));
  let date = pdate;
  if (s) { s.total = syms.length; s.progress = 0; }
  let n = 0;
  for (const sym of syms) {
    try {
      const all0 = await P.ssFloorsheet(sym);
      if (!all0.length) continue;
      date = all0.reduce((m, t) => (t.date > m ? t.date : m), all0[0].date);
      const trades = all0.filter((t) => t.date === date);
      const by = new Map<number, { bq: number; sq: number; ba: number; sa: number; t: number }>();
      for (const t of trades) {
        const b = by.get(t.buyer) ?? { bq: 0, sq: 0, ba: 0, sa: 0, t: 0 }; b.bq += t.qty; b.ba += t.amount; b.t++; by.set(t.buyer, b);
        const se = by.get(t.seller) ?? { bq: 0, sq: 0, ba: 0, sa: 0, t: 0 }; se.sq += t.qty; se.sa += t.amount; if (t.seller !== t.buyer) se.t++; by.set(t.seller, se);
      }
      const qty = trades.reduce((a, t) => a + t.qty, 0), amt = trades.reduce((a, t) => a + t.amount, 0);
      tx(() => {
        run("INSERT OR REPLACE INTO floorsheet_day (date, symbol, trades, qty, amount, wacc, high, low, buyers, sellers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", date, sym, trades.length, qty, amt, qty ? amt / qty : null, Math.max(...trades.map((t) => t.rate)), Math.min(...trades.map((t) => t.rate)), new Set(trades.map((t) => t.buyer)).size, new Set(trades.map((t) => t.seller)).size);
        for (const [br, v] of by) run("INSERT OR REPLACE INTO floorsheet_broker (date, symbol, broker, buy_qty, sell_qty, buy_amt, sell_amt, trades) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", date, sym, br, v.bq, v.sq, v.ba, v.sa, v.t);
      });
      n++;
    } catch (e) { console.warn(`[floorsheet] ${sym}: ${e instanceof Error ? e.message : e}`); }
    if (s) { s.progress++; s.message = `${sym} (${s.progress}/${s.total})`; }
  }
  // Keep the last 15 sessions.
  const keep = all<{ date: string }>("SELECT DISTINCT date FROM floorsheet_day ORDER BY date DESC LIMIT 15").map((r) => r.date);
  if (keep.length === 15) { run("DELETE FROM floorsheet_day WHERE date < ?", keep[14]); run("DELETE FROM floorsheet_broker WHERE date < ?", keep[14]); }
  fresh("floorsheet", P.SOURCES.sharesansar, date, get<{ n: number }>("SELECT COUNT(*) n FROM floorsheet_day WHERE date = ?", date)?.n ?? 0);
  return n;
}

// ---------- link checks ----------
/** Checks every product, resource and provider website link (GET, follows redirects), so the app can show which links work. */
export async function syncLinkChecks(): Promise<number> {
  const urls = new Set<string>();
  for (const r of all<{ official_url: string | null; info_url: string | null }>("SELECT official_url, info_url FROM products")) { if (r.official_url) urls.add(r.official_url); if (r.info_url) urls.add(r.info_url); }
  for (const r of all<{ url: string | null; links: string | null }>("SELECT url, links FROM resources")) { if (r.url) urls.add(r.url); try { for (const l of JSON.parse(r.links || "[]") as { url: string }[]) if (l.url) urls.add(l.url); } catch { /* ignore */ } }
  for (const r of all<{ website: string }>("SELECT website FROM companies WHERE website IS NOT NULL AND website <> '' AND sector IN ('Commercial Bank','Development Bank','Finance','Mutual Fund','Life Insurance','Non-Life Insurance','Microfinance','Investment')")) urls.add(r.website);
  for (const u of GUIDE_URLS) urls.add(u);
  const recent = new Set(all<{ url: string }>("SELECT url FROM link_checks WHERE ok = 1 AND checked_at >= datetime('now','-6 days')").map((r) => r.url));
  let n = 0;
  const list = [...urls].filter((u) => !recent.has(u));
  // A few at a time: these are many different hosts.
  for (let i = 0; i < list.length; i += 6) {
    await Promise.all(list.slice(i, i + 6).map(async (u) => {
      let status = 0, final = u;
      try { const res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) SaphalStocks link check" } }); status = res.status; final = res.url; try { await res.body?.cancel(); } catch { /* ignore */ } } catch { status = 0; }
      run("INSERT OR REPLACE INTO link_checks (url, status, ok, final_url, checked_at) VALUES (?, ?, ?, ?, ?)", u, status, status >= 200 && status < 400 ? 1 : 0, final, nowIso());
      n++;
    }));
  }
  fresh("link_checks", { name: "Saphal Stocks link checker", url: "" }, new Date().toISOString().slice(0, 10), n);
  return n;
}

// ---------- orchestration ----------
export function queueDailyRefresh() {
  enqueue("listing", (s) => syncListing(s));
  enqueue("history", (s) => syncHistory(s));
  enqueue("indices", (s) => syncIndices(s));
  enqueue("news", () => syncNews());
  enqueue("forex", () => syncForex());
  enqueue("issues", () => syncIssues());
  enqueue("funds", () => syncFunds());
  enqueue("rates", () => syncRates());
  enqueue("audit", (st) => syncAuditDocs(st));
  enqueue("details", (s) => syncAllDetails(s, { maxAgeDays: 7 }));
}

export function freshnessReport() {
  return all("SELECT * FROM data_freshness ORDER BY dataset");
}

/** Minutes-of-day in Asia/Kathmandu (UTC+5:45, no DST). */
export function nptNow() {
  const d = new Date(Date.now() + (5 * 60 + 45) * 60_000);
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), weekday: d.getUTCDay() };
}

export function startScheduler() {
  const [hh, mm] = (process.env.INGEST_DAILY_AT || "15:45").split(":").map(Number);
  const at = hh * 60 + mm;
  const tick = () => {
    const n = nptNow();
    if (n.minutes < at || getSetting<string>("lastScheduledRefresh", "") === n.date) return;
    // Skip if prices were already refreshed after today's scheduled time (e.g. the server restarted).
    const last = get<{ last_success_at: string }>("SELECT last_success_at FROM data_freshness WHERE dataset = 'prices_latest'");
    const scheduledUtc = Date.parse(`${n.date}T00:00:00Z`) + (at - 345) * 60_000;
    setSetting("lastScheduledRefresh", n.date);
    if (last && Date.parse(last.last_success_at) >= scheduledUtc) return;
    {
      console.log(`[scheduler] daily refresh for ${n.date} (NPT)`);
      queueDailyRefresh();
    }
  };
  setInterval(tick, 60_000);
  // On boot: if the market data is older than 12 hours (or empty), refresh now.
  const latest = get<{ last_success_at: string }>("SELECT last_success_at FROM data_freshness WHERE dataset = 'prices_latest'");
  if (!latest || Date.now() - Date.parse(latest.last_success_at) > 12 * 3_600_000) queueDailyRefresh();
}

// ---------- intraday refresh during market hours ----------
const OPEN = 11 * 60, CLOSE = 15 * 60;
let holidayDate = "";

/** Weekdays (0=Sun..6=Sat) on which NEPSE traded at least 3 times in the last 60 days. */
export function tradingWeekdays(): number[] {
  const rows = all<{ date: string }>("SELECT date FROM indices WHERE index_id = 12 AND date >= date('now', '-60 days')");
  const c: Record<number, number> = {};
  for (const r of rows) { const w = new Date(r.date + "T00:00:00Z").getUTCDay(); c[w] = (c[w] ?? 0) + 1; }
  const days = Object.entries(c).filter(([, n]) => n >= 3).map(([w]) => Number(w));
  return days.length ? days : [1, 2, 3, 4, 5];
}

export function marketStatus() {
  const n = nptNow();
  const tradingDay = tradingWeekdays().includes(n.weekday) && holidayDate !== n.date;
  const session = !tradingDay ? "closed" : n.minutes < OPEN ? "pre-open" : n.minutes <= CLOSE ? "open" : "closed";
  const f = get<{ last_success_at: string; as_of: string }>("SELECT last_success_at, as_of FROM data_freshness WHERE dataset = 'prices_latest'");
  return {
    nptDate: n.date, nptTime: `${String(Math.floor(n.minutes / 60)).padStart(2, "0")}:${String(n.minutes % 60).padStart(2, "0")}`,
    tradingDay, holiday: holidayDate === n.date, session, hours: "11:00-15:00 NPT",
    lastUpdate: f?.last_success_at ?? null, dataDate: f?.as_of ?? null,
    live: session === "open" && !!f && f.as_of === n.date,
    note: "During market hours prices refresh about every 5 minutes from ShareSansar (delayed, not tick-by-tick). Official closing data is loaded after 15:45.",
  };
}

export function startIntradayPoller(intervalMin = Number(process.env.INTRADAY_REFRESH_MIN || 5)) {
  if (intervalMin <= 0) return;
  setInterval(() => {
    const n = nptNow();
    if (!tradingWeekdays().includes(n.weekday) || holidayDate === n.date) return;
    if (n.minutes < OPEN || n.minutes > CLOSE + 10) return;
    const f = get<{ last_success_at: string; as_of: string }>("SELECT last_success_at, as_of FROM data_freshness WHERE dataset = 'prices_latest'");
    if (f && Date.now() - Date.parse(f.last_success_at) < intervalMin * 60_000) return;
    // If by 11:45 the source still shows an older trading date, treat today as a holiday and stop polling.
    if (f && n.minutes > OPEN + 45 && f.as_of !== n.date && Date.now() - Date.parse(f.last_success_at) < 20 * 60_000) { holidayDate = n.date; console.log(`[intraday] no trading detected on ${n.date}; polling paused for today`); return; }
    enqueue("listing", (s) => syncListing(s));
  }, 60_000);
}

// ---------- Gold and silver: official daily rates from FENEGOSIDA (Federation of Nepal Gold & Silver Dealers' Association) ----------
const METAL_API = "https://api.fenegosida.org/api/website/v1/Dashboard";
export async function syncMetals(): Promise<number> {
  const last = get<{ d: string | null }>("SELECT MAX(date) d FROM metal_prices")?.d;
  const start = last ? new Date(Date.parse(last) - 40 * 86_400_000) : new Date("2013-01-15");
  const now = new Date();
  let n = 0, empty = 0;
  const ins = db.prepare("INSERT INTO metal_prices (date, item, price) VALUES (?, ?, ?) ON CONFLICT(date, item) DO UPDATE SET price = excluded.price");
  try {
    for (let y = start.getUTCFullYear(), m = start.getUTCMonth(); y < now.getUTCFullYear() || (y === now.getUTCFullYear() && m <= now.getUTCMonth()); m === 11 ? (y++, m = 0) : m++) {
      const d = `${y}-${String(m + 1).padStart(2, "0")}-15`;
      const rows = await fetchJson<{ todayDate: string; rateType: string; baseRatePerGram: number }[]>(`${METAL_API}/monthwisehistory?date=${d}`).catch(() => null);
      if (!Array.isArray(rows) || !rows.length) { empty++; continue; }
      tx(() => { for (const r of rows) { const item = metalItem(r.rateType); if (item && r.baseRatePerGram > 0 && /^\d{4}-\d{2}-\d{2}/.test(r.todayDate)) { ins.run(r.todayDate.slice(0, 10), item, r.baseRatePerGram); n++; } } });
      await new Promise((r) => setTimeout(r, 1200));
    }
    // Today's rate (published each morning).
    const today = await fetchJson<{ todayDate: string; rateType: string; todayBaseRatePerGram: number }[]>(`${METAL_API}/today`).catch(() => null);
    if (Array.isArray(today)) tx(() => { for (const r of today) { const item = metalItem(r.rateType); if (item && r.todayBaseRatePerGram > 0) { ins.run(r.todayDate.slice(0, 10), item, r.todayBaseRatePerGram); n++; } } });
    const asOf = get<{ d: string | null }>("SELECT MAX(date) d FROM metal_prices")?.d ?? null;
    fresh("metals", { name: "FENEGOSIDA", url: "https://fenegosida.org" }, asOf, n);
  } catch (e) { freshError("metals", e instanceof Error ? e.message : String(e)); throw e; }
  if (empty > 30 && n === 0) throw new Error("FENEGOSIDA returned no rates");
  return n;
}
