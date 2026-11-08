import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { Card, Stat, Notice, DataTable, Badge } from "../components/ui.tsx";
import { num, pct, tone } from "../lib/format.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function StrategyLab() {
  const strategies = useApi<any[]>("/backtest/strategies");
  const sectors = useApi<{ sector: string }[]>("/sectors");
  const [f, setF] = useState({ strategy: "breakout_20", universe: "liquid", sector: "", symbols: "", years: 5, stopLossPct: "", takeProfitPct: "", maxHoldDays: "" });
  const [params, setParams] = useState<Record<string, number>>({});
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const def = strategies.data?.find((s) => s.id === f.strategy);
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      setRes(await api("/backtest/universe", { body: {
        strategy: f.strategy, params: { ...def?.defaults, ...params }, years: +f.years, universe: f.universe, sector: f.sector || undefined,
        symbols: f.universe === "symbols" ? f.symbols.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean) : undefined,
        stopLossPct: f.stopLossPct ? +f.stopLossPct : null, takeProfitPct: f.takeProfitPct ? +f.takeProfitPct : null, maxHoldDays: f.maxHoldDays ? +f.maxHoldDays : null,
      } }));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const s = res?.summary;
  const maxBin = Math.max(1, ...(res?.histogram ?? []).map((h: any) => h.count));
  return (
    <div className="page">
      <div className="page-head"><div><h1>Strategy Lab</h1><p>Test whether a trading rule actually works on NEPSE: run it across many stocks over years of real prices, with Nepal costs and taxes, and compare with simply buying and holding.</p></div></div>
      <Card title="Test setup">
        <div className="form-grid">
          <label className="field">Strategy<select className="input" value={f.strategy} onChange={(e) => { setF({ ...f, strategy: e.target.value }); setParams({}); }}>{strategies.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          {def && Object.entries(def.defaults).map(([k, v]) => <label key={k} className="field">{k}<input className="input" type="number" value={params[k] ?? (v as number)} onChange={(e) => setParams({ ...params, [k]: +e.target.value })} /></label>)}
          <label className="field">Stocks<select className="input" value={f.universe} onChange={(e) => setF({ ...f, universe: e.target.value })}><option value="liquid">Liquid stocks (≥ Rs. 50 L/day)</option><option value="all">All stocks</option><option value="sector">One sector</option><option value="symbols">My list</option></select></label>
          {f.universe === "sector" && <label className="field">Sector<select className="input" value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })}><option value="">Choose…</option>{sectors.data?.map((x) => <option key={x.sector}>{x.sector}</option>)}</select></label>}
          {f.universe === "symbols" && <label className="field">Symbols<input className="input" value={f.symbols} placeholder="NABIL, EBL, UPPER" onChange={(e) => setF({ ...f, symbols: e.target.value })} /></label>}
          <label className="field">Years<input className="input" type="number" value={f.years} onChange={(e) => setF({ ...f, years: +e.target.value })} /></label>
          <label className="field">Stop-loss %<input className="input" type="number" placeholder="none" value={f.stopLossPct} onChange={(e) => setF({ ...f, stopLossPct: e.target.value })} /></label>
          <label className="field">Take-profit %<input className="input" type="number" placeholder="none" value={f.takeProfitPct} onChange={(e) => setF({ ...f, takeProfitPct: e.target.value })} /></label>
          <label className="field">Max holding days<input className="input" type="number" placeholder="none" value={f.maxHoldDays} onChange={(e) => setF({ ...f, maxHoldDays: e.target.value })} /></label>
        </div>
        {def && <p className="small muted" style={{ marginTop: 8 }}>{def.description}</p>}
        <button className="btn primary" onClick={run} disabled={busy} style={{ marginTop: 6 }}>{busy ? <><span className="spinner" /> Testing…</> : "Run across stocks"}</button>
        {err && <div style={{ marginTop: 8 }}><Notice tone="warn">{err}</Notice></div>}
      </Card>
      {res && (
        <>
          <Notice tone={s.pctBeatBuyHold != null && s.pctBeatBuyHold < 50 ? "warn" : "info"}>
            <strong>{res.strategy.name}</strong> over {res.years} years on {res.tested} stocks ({res.skippedShortHistory} skipped for short history): median return {pct(s.medianReturnPct, 1)} vs buy & hold {pct(s.medianBuyHoldPct, 1)}. It beat buy & hold on {s.pctBeatBuyHold}% of stocks. {s.pctBeatBuyHold != null && s.pctBeatBuyHold < 50 ? "On this evidence, the rule did not add value over simply holding." : "The rule added value on most stocks in this period; check that it holds in other periods too."}
          </Notice>
          <div className="grid g6">
            <Stat label="Median strategy return" value={pct(s.medianReturnPct, 1)} tone={tone(s.medianReturnPct)} sub={`Mean ${pct(s.meanReturnPct, 1)}`} />
            <Stat label="Median buy & hold" value={pct(s.medianBuyHoldPct, 1)} tone={tone(s.medianBuyHoldPct)} />
            <Stat label="Beat buy & hold" value={`${s.pctBeatBuyHold ?? "—"}%`} sub={`${s.pctStocksProfitable ?? "—"}% of stocks profitable`} />
            <Stat label="Trade win rate" value={s.winRatePct != null ? `${num(s.winRatePct, 1)}%` : "—"} sub={`${s.totalTrades} trades · avg ${pct(s.avgTradePct, 1)}`} />
            <Stat label="Profit factor" value={num(s.profitFactor)} sub={`Median hold ${num(s.medianHoldingDays, 0)} days`} />
            <Stat label="Median max drawdown" value={`-${num(s.medianMaxDrawdownPct, 1)}%`} tone="down" />
          </div>
          <div className="grid g3">
            <Card title="Distribution of trade returns">
              {res.histogram.map((h: any) => (
                <div key={h.range} className="row small" style={{ gap: 8, marginBottom: 4, flexWrap: "nowrap" }}>
                  <span style={{ width: 100 }} className="muted">{h.range}</span>
                  <div className="bar" style={{ flex: 1 }}><span style={{ width: `${(h.count / maxBin) * 100}%`, background: h.range.startsWith("<") || h.range.startsWith("-") ? "var(--down)" : "var(--up)" }} /></div>
                  <span className="mono" style={{ width: 40, textAlign: "right" }}>{h.count}</span>
                </div>
              ))}
            </Card>
            <Card title="Per-stock results" className="span2" flush>
              <DataTable rows={res.results} onRow={(r: any) => nav(`/stocks/${r.symbol}`)} maxHeight={480} cols={[
                { key: "symbol", label: "Stock", render: (r: any) => <><span className="sym">{r.symbol}</span><div className="tiny faint">{r.sector}</div></> },
                { key: "totalReturnPct", label: "Strategy", num: true, render: (r: any) => <span className={tone(r.totalReturnPct)}>{pct(r.totalReturnPct, 1)}</span> },
                { key: "buyHoldReturnPct", label: "Buy & hold", num: true, render: (r: any) => <span className={tone(r.buyHoldReturnPct)}>{pct(r.buyHoldReturnPct, 1)}</span> },
                { key: "beatBuyHold", label: "Beat?", render: (r: any) => <Badge tone={r.beatBuyHold ? "up" : ""}>{r.beatBuyHold ? "Yes" : "No"}</Badge> },
                { key: "trades", label: "Trades", num: true }, { key: "winRatePct", label: "Win %", num: true, render: (r: any) => num(r.winRatePct, 0) },
                { key: "maxDrawdownPct", label: "Max DD", num: true, render: (r: any) => `-${num(r.maxDrawdownPct, 1)}%` },
                { key: "profitFactor", label: "PF", num: true, render: (r: any) => num(r.profitFactor) },
                { key: "exposurePct", label: "In market", num: true, render: (r: any) => `${num(r.exposurePct, 0)}%` },
              ]} />
            </Card>
          </div>
          <Notice tone="warn">{res.caveats.join(" ")}</Notice>
        </>
      )}
    </div>
  );
}
