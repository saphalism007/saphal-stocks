import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApi } from "../lib/api.ts";
import { Card, Loading, Notice, Score, Seg, Badge, Empty } from "../components/ui.tsx";
import { MultiLineChart, SERIES_COLORS } from "../components/PriceChart.tsx";
import { num, pct, tone, compact, isNum } from "../lib/format.ts";
import { I } from "../components/icons.tsx";
import { useTheme } from "../App.tsx";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = { label: string; get: (s: any) => number | null | undefined; fmt: (v: any) => string; better: "high" | "low" | null };

const ROWS: { group: string; rows: Row[] }[] = [
  { group: "Price & market", rows: [
    { label: "Last close", get: (s) => s.factors?.price, fmt: (v) => num(v), better: null },
    { label: "Market cap", get: (s) => (s.metrics.marketCap?.value != null ? s.metrics.marketCap.value * 1000 : null), fmt: (v) => compact(v), better: null },
    { label: "Avg daily turnover (20d)", get: (s) => s.factors?.avgTurnover20, fmt: (v) => compact(v), better: "high" },
  ] },
  { group: "Valuation", rows: [
    { label: "P/E", get: (s) => s.metrics.pe?.value, fmt: (v) => num(v, 1), better: "low" },
    { label: "P/B", get: (s) => s.metrics.pb?.value, fmt: (v) => num(v, 2), better: "low" },
    { label: "Graham number", get: (s) => s.metrics.graham?.value, fmt: (v) => num(v), better: null },
    { label: "Cash dividend yield %", get: (s) => s.dividend?.cashYieldPct, fmt: (v) => num(v, 2), better: "high" },
  ] },
  { group: "Profitability", rows: [
    { label: "EPS (annualised)", get: (s) => s.metrics.eps?.value, fmt: (v) => num(v), better: "high" },
    { label: "ROE %", get: (s) => s.metrics.roe?.value, fmt: (v) => num(v, 1), better: "high" },
    { label: "ROA %", get: (s) => s.metrics.roa?.value, fmt: (v) => num(v, 2), better: "high" },
    { label: "Net margin %", get: (s) => s.metrics.netMargin?.value, fmt: (v) => num(v, 1), better: "high" },
    { label: "Cost to income %", get: (s) => s.metrics.costIncome?.value, fmt: (v) => num(v, 1), better: "low" },
  ] },
  { group: "Financial health", rows: [
    { label: "NPL %", get: (s) => s.metrics.npl?.value, fmt: (v) => num(v, 2), better: "low" },
    { label: "Capital adequacy %", get: (s) => s.metrics.car?.value, fmt: (v) => num(v, 2), better: "high" },
    { label: "Debt / equity", get: (s) => s.metrics.de?.value, fmt: (v) => num(v, 2), better: "low" },
    { label: "Solvency", get: (s) => s.metrics.solvency?.value, fmt: (v) => num(v, 2), better: "high" },
    { label: "Dividend years (of 5)", get: (s) => s.dividend?.yearsPaidLast5, fmt: (v) => String(v ?? "—"), better: "high" },
  ] },
  { group: "Performance & risk", rows: [
    { label: "Return 3M %", get: (s) => s.factors?.return3m, fmt: (v) => pct(v, 1), better: "high" },
    { label: "Return 1Y %", get: (s) => s.factors?.return1y, fmt: (v) => pct(v, 1), better: "high" },
    { label: "Volatility (ann.) %", get: (s) => s.factors?.volatility, fmt: (v) => num(v, 1), better: "low" },
    { label: "RSI", get: (s) => s.factors?.rsi, fmt: (v) => num(v, 0), better: null },
  ] },
];

export default function Compare() {
  const [params, setParams] = useSearchParams();
  const syms = (params.get("s") || "NABIL,EBL,SCB").split(",").filter(Boolean);
  const [add, setAdd] = useState("");
  const [days, setDays] = useState<"90" | "365" | "1095" | "1825">("365");
  const d = useApi<{ from: string; stocks: any[] }>(`/compare?symbols=${syms.join(",")}&days=${days}`, [syms.join(","), days]);
  const { theme } = useTheme();
  const setSyms = (list: string[]) => setParams({ s: list.join(",") });
  const stocks = (d.data?.stocks ?? []).filter((s) => !s.error);
  const sectors = new Set(stocks.map((s) => s.sector));
  const best = (r: Row) => {
    if (!r.better) return null;
    const vals = stocks.map((s) => r.get(s)).filter(isNum);
    if (vals.length < 2) return null;
    return r.better === "high" ? Math.max(...vals) : Math.min(...vals);
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Compare stocks</h1><p>Side-by-side valuation, profitability, financial health, dividends and performance (up to 6 stocks). Best value in each row is highlighted.</p></div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); const s = add.trim().toUpperCase(); if (s && !syms.includes(s) && syms.length < 6) setSyms([...syms, s]); setAdd(""); }}>
          <input className="input" placeholder="Add symbol" value={add} onChange={(e) => setAdd(e.target.value.toUpperCase())} style={{ width: 140 }} /><button className="btn"><I.plus /> Add</button>
          <Link className="btn" to={`/analyst?q=${encodeURIComponent(`Compare ${syms.join(", ")}: valuation, profitability, financial health, dividends, technical position and risk. Which is most attractive for long-term investing and which for a swing trade, and why?`)}`}><I.ai /> AI comparison</Link>
        </form>
      </div>
      <div className="row">{syms.map((s, i) => <span key={s} className="chip" style={{ borderColor: SERIES_COLORS[i] }}><span className="dot" style={{ background: SERIES_COLORS[i] }} /><Link to={`/stocks/${s}`}>{s}</Link><button className="btn ghost sm" style={{ padding: 0 }} onClick={() => setSyms(syms.filter((x) => x !== s))} aria-label={`Remove ${s}`}><I.x /></button></span>)}</div>
      {sectors.size > 1 && <Notice tone="warn">These stocks are in different sectors ({[...sectors].join(", ")}). Sector-specific ratios (NPL, CAR, solvency, debt) are not comparable across sectors; compare valuation and returns with care.</Notice>}
      {d.data?.stocks.filter((s) => s.error).map((s) => <Notice key={s.symbol} tone="warn">{s.symbol}: {s.error}</Notice>)}
      {d.loading && !d.data ? <Loading /> : stocks.length === 0 ? <Empty title="Add stocks to compare" /> : (
        <>
          <Card title="Price performance (rebased to 100)" actions={<Seg value={days} onChange={setDays} options={[{ key: "90", label: "3M" }, { key: "365", label: "1Y" }, { key: "1095", label: "3Y" }, { key: "1825", label: "5Y" }]} />}>
            <MultiLineChart series={stocks.map((s) => ({ name: s.symbol, data: s.rebased }))} baseline={100} theme={theme} />
            <div className="legend" style={{ marginTop: 6 }}>{stocks.map((s, i) => <span key={s.symbol}><i style={{ background: SERIES_COLORS[i] }} />{s.symbol} {pct((s.rebased[s.rebased.length - 1]?.value ?? 100) - 100, 1)}</span>)}</div>
          </Card>
          <Card flush>
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Metric</th>{stocks.map((s) => <th key={s.symbol} className="num"><Link to={`/stocks/${s.symbol}`}>{s.symbol}</Link><div className="tiny faint" style={{ textTransform: "none" }}>{s.sector}</div></th>)}</tr></thead>
              <tbody>
                <tr><td><strong>Fundamental score</strong></td>{stocks.map((s) => <td key={s.symbol} className="num"><Score value={s.score?.overall} /></td>)}</tr>
                <tr><td><strong>Technical score</strong></td>{stocks.map((s) => <td key={s.symbol} className="num"><Score value={s.factors?.technicalScore} /></td>)}</tr>
                <tr><td>Trend · statements</td>{stocks.map((s) => <td key={s.symbol} className="num small">{s.factors?.trend ?? "—"} · {s.period ?? "no statements"}</td>)}</tr>
                {ROWS.map((g) => [
                  <tr key={g.group}><td colSpan={stocks.length + 1} className="tiny faint" style={{ textTransform: "uppercase", letterSpacing: ".06em", background: "var(--panel-2)" }}>{g.group}</td></tr>,
                  ...g.rows.map((r) => { const b = best(r); return (
                    <tr key={r.label}><td>{r.label}</td>{stocks.map((s) => { const v = r.get(s); const win = b != null && v === b; return <td key={s.symbol} className={`num ${r.label.startsWith("Return") ? tone(v) : ""}`} style={win ? { fontWeight: 700, color: "var(--accent)" } : undefined}>{v == null ? "—" : r.fmt(v)}</td>; })}</tr>
                  ); }),
                ])}
                <tr><td>Strengths</td>{stocks.map((s) => <td key={s.symbol} className="small up">{s.strengths.join(" ") || "—"}</td>)}</tr>
                <tr><td>Red flags</td>{stocks.map((s) => <td key={s.symbol} className="small down">{s.redFlags.join(" ") || "—"}</td>)}</tr>
              </tbody>
            </table></div>
          </Card>
          <p className="tiny faint">Ratios are computed from each company's latest stored quarterly statement; periods can differ between companies. Highlighting marks the best figure only; it is not a recommendation. <Badge>Prices adjusted for bonus issues where detected</Badge></p>
        </>
      )}
    </div>
  );
}
