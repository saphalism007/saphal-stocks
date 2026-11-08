// Data quality checks over stored market data and statements. Findings are
// shown on Settings -> Data quality so problems are visible, not hidden.
import { all, get } from "../db.ts";
import * as M from "./market.ts";

export interface Finding { severity: "error" | "warning" | "info"; check: string; symbol: string | null; detail: string; date?: string | null }

let cache: { key: string; result: ReturnType<typeof compute> } | null = null;

export function dataQuality() {
  const key = `${M.latestTradingDate()}|${get<{ n: number }>("SELECT COUNT(*) n FROM reports")?.n}|${get<{ n: number }>("SELECT COUNT(*) n FROM prices")?.n}`;
  if (cache?.key !== key) cache = { key, result: compute() };
  return cache.result;
}

function compute() {
  const findings: Finding[] = [];
  const latest = M.latestTradingDate();
  const latestIdx = get<{ d: string }>("SELECT MAX(date) d FROM indices WHERE index_id = 12")?.d ?? null;

  // 1) Impossible OHLC rows.
  for (const r of all<{ symbol: string; date: string; open: number; high: number; low: number; close: number }>(
    "SELECT symbol, date, open, high, low, close FROM prices WHERE high < low OR close > high * 1.0001 OR close < low * 0.9999 OR close <= 0 LIMIT 200")) {
    findings.push({ severity: "error", check: "Impossible OHLC", symbol: r.symbol, date: r.date, detail: `O ${r.open} H ${r.high} L ${r.low} C ${r.close}` });
  }

  // 2) Stale or suspended: no trade for 30+ days while the market traded.
  if (latest) {
    for (const r of all<{ symbol: string; last: string; sector: string | null }>(
      "SELECT c.symbol, MAX(p.date) last, c.sector FROM companies c JOIN prices p ON p.symbol = c.symbol WHERE c.status = 'active' GROUP BY c.symbol HAVING last < date(?, '-30 days')", latest)) {
      findings.push({ severity: "warning", check: "No trades in 30+ days", symbol: r.symbol, date: r.last, detail: `Last stored trade ${r.last}. Possibly suspended, delisted, or very illiquid${r.sector ? ` (${r.sector})` : ""}. Technical signals are not generated for stale prices.` });
    }
  }

  // 3) Unexplained jumps beyond NEPSE's daily price band, after bonus adjustment (last 2 years).
  const since = new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10);
  const syms = all<{ symbol: string }>("SELECT DISTINCT symbol FROM prices WHERE date >= ?", since).map((r) => r.symbol);
  let jumps = 0;
  for (const s of syms) {
    const b = M.bars(s).bars.filter((x) => x.date >= since);
    for (let i = 1; i < b.length; i++) {
      const ch = b[i].close / b[i - 1].close - 1;
      const gapDays = (Date.parse(b[i].date) - Date.parse(b[i - 1].date)) / 86_400_000;
      if (Math.abs(ch) > 0.15 && gapDays < 20) {
        jumps++;
        if (jumps <= 150) findings.push({ severity: "warning", check: "Move beyond daily price band", symbol: s, date: b[i].date, detail: `${(ch * 100).toFixed(1)}% from ${b[i - 1].close.toFixed(2)} to ${b[i].close.toFixed(2)} in one session (after bonus/right adjustments). Likely an unadjusted right share/dividend, a new listing's opening band, or a data error. Indicators around this date may be distorted.` });
      }
    }
  }

  // 4) Balance sheet does not balance (assets vs liabilities + equity), latest report per company.
  for (const r of all<{ symbol: string; period: string; id: number }>("SELECT r.symbol, r.period, r.id FROM reports r JOIN (SELECT symbol, MAX(fiscal_year || quarter) k FROM reports GROUP BY symbol) m ON m.symbol = r.symbol AND m.k = r.fiscal_year || r.quarter")) {
    const items = all<{ label: string; value: number | null }>("SELECT label, value FROM report_items WHERE report_id = ? AND statement = 'balance_sheet'", r.id);
    const f = (re: RegExp) => items.find((i) => re.test(i.label) && i.value != null)?.value ?? null;
    const assets = f(/^total assets$/i);
    const le = f(/^total (liabilities and equity|equity and liabilities)/i);
    if (assets && le && Math.abs(assets - le) / assets > 0.01) {
      findings.push({ severity: "warning", check: "Balance sheet does not balance", symbol: r.symbol, date: r.period, detail: `Total assets ${assets.toLocaleString("en-IN")} vs liabilities + equity ${le.toLocaleString("en-IN")} (Rs. '000). The published figures or their transcription may contain an error.` });
    }
    if (!items.length) findings.push({ severity: "info", check: "Report without balance sheet", symbol: r.symbol, date: r.period, detail: "Only part of the quarterly report was available." });
  }

  // 5) Outdated statements: latest stored report more than 2 quarters behind the most common latest period.
  const latestPeriods = all<{ symbol: string; fy: string; q: number }>("SELECT symbol, MAX(fiscal_year) fy, MAX(quarter) q FROM reports WHERE (symbol, fiscal_year) IN (SELECT symbol, MAX(fiscal_year) FROM reports GROUP BY symbol) GROUP BY symbol");
  const idxOf = (fy: string, q: number) => parseInt(fy.slice(0, 4), 10) * 4 + q;
  const counts = new Map<number, number>();
  for (const r of latestPeriods) counts.set(idxOf(r.fy, r.q), (counts.get(idxOf(r.fy, r.q)) ?? 0) + 1);
  const mode = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (mode) for (const r of latestPeriods) if (mode - idxOf(r.fy, r.q) >= 2) findings.push({ severity: "warning", check: "Outdated statements", symbol: r.symbol, date: `${r.fy} Q${r.q}`, detail: "Latest stored quarterly report is 2+ quarters older than most companies'. Fundamental scores may be stale." });

  // 6) Companies with prices but no statements (excluding funds and debentures).
  const noReports = all<{ symbol: string; sector: string | null }>("SELECT c.symbol, c.sector FROM companies c WHERE c.status = 'active' AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.symbol = c.symbol) AND (c.sector IS NULL OR c.sector NOT IN ('Mutual Fund','Corporate Debentures','Promoter Share'))");
  for (const r of noReports) findings.push({ severity: "info", check: "No financial statements", symbol: r.symbol, detail: `No quarterly report available from the source${r.sector ? ` (${r.sector})` : ""}. Fundamental scores are unavailable.` });

  // 7) Market data date vs index date.
  if (latest && latestIdx && latest !== latestIdx) findings.push({ severity: "warning", check: "Prices and index out of sync", symbol: null, detail: `Latest prices ${latest}, latest NEPSE index ${latestIdx}. Run a refresh.` });

  const summary: Record<string, number> = {};
  for (const f of findings) summary[f.check] = (summary[f.check] ?? 0) + 1;
  return {
    checkedAt: new Date().toISOString(), latestPrices: latest, latestIndex: latestIdx,
    counts: { error: findings.filter((f) => f.severity === "error").length, warning: findings.filter((f) => f.severity === "warning").length, info: findings.filter((f) => f.severity === "info").length, jumpsTotal: jumps },
    summary, findings,
  };
}
