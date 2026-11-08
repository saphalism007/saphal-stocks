// Ingestion jobs: fetch from providers, validate, upsert, and record freshness.
// Jobs run through a single in-process queue so we never hammer a provider.
import { db, all, get, run, tx, nowIso } from "../db.ts";
import * as P from "./providers.ts";
import { parsePeriod } from "../../shared/fundamentals.ts";
import { fetchJson } from "../lib/fetcher.ts";

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
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const rows = await P.nrbForex(from, to);
  const st = db.prepare("INSERT INTO forex (date, currency, unit, buy, sell) VALUES (?, ?, ?, ?, ?) ON CONFLICT(date, currency) DO UPDATE SET buy = excluded.buy, sell = excluded.sell, unit = excluded.unit");
  tx(() => { for (const r of rows) st.run(r.date, r.currency, r.unit, r.buy, r.sell); });
  fresh("forex", P.SOURCES.nrb, rows.reduce((m, r) => (r.date > m ? r.date : m), ""), rows.length);
  return rows.length;
}

/** Symbols listed in the nepse-data repository (one GitHub API call). */
export async function nepseDataSymbols(): Promise<string[]> {
  const j = await fetchJson<{ tree: { path: string }[] }>("https://api.github.com/repos/Aabishkar2/nepse-data/git/trees/main?recursive=1");
  return j.tree.map((t) => t.path.match(/^data\/company-wise\/([A-Z0-9]+)\.csv$/)?.[1]).filter(Boolean) as string[];
}

// ---------- orchestration ----------
export function queueDailyRefresh() {
  enqueue("listing", (s) => syncListing(s));
  enqueue("history", (s) => syncHistory(s));
  enqueue("indices", (s) => syncIndices(s));
  enqueue("news", () => syncNews());
  enqueue("forex", () => syncForex());
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

let lastScheduledDate = "";
export function startScheduler() {
  const [hh, mm] = (process.env.INGEST_DAILY_AT || "15:45").split(":").map(Number);
  const at = hh * 60 + mm;
  const tick = () => {
    const n = nptNow();
    if (n.minutes >= at && lastScheduledDate !== n.date) {
      lastScheduledDate = n.date;
      console.log(`[scheduler] daily refresh for ${n.date} (NPT)`);
      queueDailyRefresh();
    }
  };
  setInterval(tick, 60_000);
  // On boot: if the market data is older than a day (or empty), refresh now.
  const latest = get<{ last_success_at: string }>("SELECT last_success_at FROM data_freshness WHERE dataset = 'prices_latest'");
  if (!latest || Date.now() - Date.parse(latest.last_success_at) > 12 * 3_600_000) queueDailyRefresh();
}
