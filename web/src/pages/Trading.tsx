// Trading Opportunities: every listed stock classified BUY / SELL / HOLD / WATCH / AVOID (or
// insufficient data) by transparent rules, long-term ideas judged separately, a trade planner,
// paper trading, alerts, and the rules' real track record after fees.
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { Card, Stat, Loading, ErrorBox, Empty, Badge, Tabs, Modal, Notice, DataTable } from "../components/ui.tsx";
import { TradePlanner } from "../components/TradePlanner.tsx";
import { I } from "../components/icons.tsx";
import { num, rs, nptDate, compact, pct, tone, todayNpt } from "../lib/format.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Tab = "buy" | "sell" | "watch" | "hold" | "longterm" | "avoid" | "insufficient" | "track";
const ACTION_TONE: Record<string, "up" | "down" | "warn" | "blue" | ""> = { BUY: "up", SELL: "down", WATCH: "warn", HOLD: "blue", AVOID: "down", INSUFFICIENT: "" };

export default function Trading() {
  const d = useApi<Any>("/trading/opportunities");
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "buy";
  const [sector, setSector] = useState("");
  const [minConf, setMinConf] = useState(0);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const r of d.data?.rows ?? []) c[r.bucket] = (c[r.bucket] ?? 0) + 1; return c; }, [d.data]);
  const sectors = useMemo(() => [...new Set((d.data?.rows ?? []).map((r: Any) => r.sector))].sort() as string[], [d.data]);
  if (d.error) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <div className="page"><Loading label="Evaluating NEPSE stocks" /></div>;
  const term = q.trim().toLowerCase();
  const rows = d.data.rows.filter((r: Any) => r.bucket === tab && (!sector || r.sector === sector) && r.confidence >= minConf && (!term || r.symbol.toLowerCase().includes(term) || r.name.toLowerCase().includes(term)));
  const t = d.data.track;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Trading Opportunities</h1><p className="small muted">{d.data.price.note} Signals are reviewed daily; each shows its review date. {d.data.disclaimer}</p></div></div>
      <Card title="How these rules have actually done" sub="Past year, after all fees and tax" actions={<button className="btn sm" onClick={() => setSp({ tab: "track" })}>Details</button>}>
        <div className="grid g4">
          <Stat label="Past BUY signals" value={t.trades} sub="judged on later prices" />
          <Stat label="Profitable" value={t.winRatePct != null ? `${num(t.winRatePct, 0)}%` : "-"} sub={`Target hit ${num(t.targetHitPct, 0)}%, stop hit ${num(t.stopHitPct, 0)}%`} />
          <Stat label="Average result" value={t.avgNetPct != null ? `${num(t.avgNetPct, 2)}%` : "-"} tone={tone(t.avgNetPct)} sub="per trade, net of costs" />
          <Stat label="Best setup type" value={<span className="stat-text">{[...t.byType].filter((x: Any) => x.trades >= 10).sort((a: Any, b: Any) => (b.avgNetPct ?? -99) - (a.avgNetPct ?? -99))[0]?.type ?? "-"}</span>} sub="by average result" />
        </div>
        {t.avgNetPct != null && t.avgNetPct < 0 && <Notice tone="warn">These rules lost money on average over the past year (a weak, sideways NEPSE). Treat signals as a starting point for your own judgement, keep position sizes small, and use the paper-trading account to test them before risking real money.</Notice>}
      </Card>
      <Tabs value={tab} onChange={(k) => setSp({ tab: k })} tabs={[
        { key: "buy", label: `Buy (${counts.buy ?? 0})` }, { key: "sell", label: `Sell (${counts.sell ?? 0})` }, { key: "watch", label: `Watch (${counts.watch ?? 0})` },
        { key: "hold", label: `Hold (${counts.hold ?? 0})` }, { key: "longterm", label: `Long-term (${d.data.longTerm.length})` }, { key: "avoid", label: `Avoid (${counts.avoid ?? 0})` },
        { key: "insufficient", label: `Insufficient data (${counts.insufficient ?? 0})` }, { key: "track", label: "Track record" },
      ]} />
      {tab === "track" ? <TrackRecord /> : tab === "longterm" ? <LongTerm rows={d.data.longTerm} /> : (
        <Card title={TAB_TITLE[tab]} sub={TAB_SUB[tab]} actions={<>
          <input className="input" style={{ width: 150 }} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" value={sector} onChange={(e) => setSector(e.target.value)}><option value="">All sectors</option>{sectors.map((s) => <option key={s}>{s}</option>)}</select>
          {(tab === "buy" || tab === "watch") && <select className="input" value={minConf} onChange={(e) => setMinConf(Number(e.target.value))}><option value={0}>Any confidence</option><option value={55}>Medium+</option><option value={75}>High</option></select>}
        </>}>
          {rows.length === 0 ? <Empty title="No stocks in this group right now">{tab === "buy" ? "No stock meets every BUY condition today (setup quality, reward/risk at least 1.8, price in the entry zone, liquidity). That is a normal result." : ""}</Empty> : (
            <DataTable rows={rows} rowKey={(r: Any) => r.symbol} onRow={(r: Any) => setOpen(r.symbol)} maxHeight={640} initialSort={{ key: "confidence", dir: -1 }} cols={[
              { key: "symbol", label: "Stock", render: (r: Any) => <span><span className="sym">{r.symbol}</span> <span className="tiny faint">{r.sector}</span></span> },
              { key: "price", label: "Price", num: true, render: (r: Any) => <span>{num(r.price)}<span className="tiny faint" style={{ display: "block" }}>{r.priceDate}</span></span> },
              { key: "action", label: "Action", render: (r: Any) => <Badge tone={ACTION_TONE[r.action]}>{r.action === "INSUFFICIENT" ? "NO DATA" : r.action}</Badge> },
              ...(tab === "buy" || tab === "watch" ? [
                { key: "entryLow", label: "Buy range", num: true, render: (r: Any) => r.entryLow != null ? `${num(r.entryLow)}-${num(r.entryHigh)}` : "-" },
                { key: "stop", label: "Stop", num: true, render: (r: Any) => r.stop != null ? num(r.stop) : "-" },
                { key: "t", label: "Targets", num: true, render: (r: Any) => r.targets.length ? r.targets.map((x: Any) => num(x.price, 0)).join(" / ") : "-" },
                { key: "netRiskReward", label: "R:R net", num: true, render: (r: Any) => r.netRiskReward != null ? <span title={`Before costs ${num(r.riskReward, 2)}`}>{num(r.netRiskReward, 2)}</span> : "-" },
                { key: "holdingPeriod", label: "Hold", render: (r: Any) => <span className="small">{r.holdingPeriod ?? "-"}</span> },
              ] : [{ key: "stop", label: tab === "hold" ? "Exit below" : "Stop / invalidation", num: true, render: (r: Any) => r.stop != null ? num(r.stop) : "-" }]),
              { key: "confidence", label: "Confidence", num: true, render: (r: Any) => r.confidenceLabel === "-" ? "-" : <span title={`${r.confidence}/100`}>{r.confidenceLabel}</span> },
              { key: "headline", label: "Why", render: (r: Any) => <span className="small">{r.headline}</span> },
            ]} />
          )}
          <p className="tiny faint" style={{ marginTop: 8 }}>Tap a stock for the full plan, trade planner, paper trading and alerts. Review signals after each trading day; levels change when prices do.</p>
        </Card>
      )}
      {open && <Modal title={`${open}, trade plan`} onClose={() => setOpen(null)}><Detail symbol={open} /></Modal>}
    </div>
  );
}

const TAB_TITLE: Record<string, string> = { buy: "Buy opportunities", sell: "Sell / exit signals", watch: "Watch: wait for a better entry", hold: "Hold", avoid: "High risk / avoid for now", insufficient: "Insufficient data" };
const TAB_SUB: Record<string, string> = {
  buy: "A rule-based setup with quality at least 60, reward/risk at least 1.8 before and at least 1.5 after all costs, liquid, stop below the buy range, and price inside the entry zone today",
  sell: "Breakdown or overbought-at-resistance signals: for holders to exit or trim (NEPSE has no short selling)",
  watch: "A setup is forming or price is outside the entry zone: wait for the stated condition",
  hold: "Uptrend intact without a fresh entry: keep holdings, exit below the stated level",
  avoid: "Illiquid, or in a downtrend with weak fundamentals",
  insufficient: "Too little or stale price history: no signal is given",
};

function Detail({ symbol }: { symbol: string }) {
  const o = useApi<Any>(`/trading/stock/${symbol}`, [symbol]);
  const ports = useApi<Any[]>("/portfolios");
  const [qty, setQty] = useState<{ q: number; e: number } | null>(null);
  const [msg, setMsg] = useState<{ t: string; warn?: boolean } | null>(null);
  if (o.error) return <ErrorBox error={o.error} />;
  if (!o.data) return <Loading />;
  const d = o.data;
  const paper = (ports.data ?? []).find((p: Any) => p.kind === "paper");
  const paperTrade = async () => {
    if (!paper || !qty) return;
    try {
      await api(`/portfolios/${paper.id}/transactions`, { body: { symbol, type: "buy", date: todayNpt(), quantity: qty.q, price: qty.e, notes: `Paper trade from Trading Opportunities (${d.setupType ?? d.action}); stop ${d.stop ?? "-"}, T1 ${d.targets[0]?.price ?? "-"}` } });
      if (d.stop) await api("/alerts", { body: { type: "price_below", symbol, params: { price: d.stop }, note: "Paper trade stop-loss" } });
      if (d.targets[0]) await api("/alerts", { body: { type: "price_above", symbol, params: { price: d.targets[0].price }, note: "Paper trade target 1" } });
      setMsg({ t: `Paper-bought ${qty.q} ${symbol} at Rs. ${num(qty.e)} in "${paper.name}", with stop and target alerts.` });
    } catch (e) { setMsg({ t: e instanceof Error ? e.message : String(e), warn: true }); }
  };
  const setAlerts = async () => {
    try {
      if (d.entryLow && d.entryHigh) await api("/alerts", { body: { type: "price_in_range", symbol, params: { low: d.entryLow, high: d.entryHigh }, note: "Reached buying range" } });
      if (d.targets[0]) await api("/alerts", { body: { type: "price_above", symbol, params: { price: d.targets[0].price }, note: "Target 1" } });
      if (d.stop) await api("/alerts", { body: { type: "price_below", symbol, params: { price: d.stop }, note: "Stop-loss" } });
      setMsg({ t: "Alerts set: buying range, target 1 and stop-loss. Manage them under Alerts." });
    } catch (e) { setMsg({ t: e instanceof Error ? e.message : String(e), warn: true }); }
  };
  const ind = d.indicators;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row between">
        <div><strong style={{ fontSize: 18 }}>{d.name}</strong> <span className="small muted">{d.sector}</span><div className="small">Rs. {num(d.price)}, {d.priceDate}, <span className="faint">{d.priceInfo?.kind === "delayed" ? "delayed intraday (about 15 min)" : "end-of-day price"}</span></div></div>
        <Badge tone={ACTION_TONE[d.action]}>{d.action === "INSUFFICIENT" ? "INSUFFICIENT DATA" : d.action}</Badge>
      </div>
      <Notice tone={d.action === "BUY" ? "info" : "warn"}>{d.headline}{d.buyNow === "wait" && d.waitFor ? ` Wait for ${d.waitFor}.` : d.buyNow === "now" ? " Entry conditions are met now." : ""}</Notice>
      {d.entryLow != null && (
        <div className="plan-grid">
          <div><span>Buy range</span><strong>{num(d.entryLow)}-{num(d.entryHigh)}</strong><em>entry about {num(d.entry)}</em></div>
          <div><span>Stop-loss</span><strong className="down">{num(d.stop)}</strong><em>{num(d.riskPct, 1)}% below entry</em></div>
          {d.targets.map((t: Any, i: number) => <div key={i}><span>Target {i + 1}</span><strong className="up">{num(t.price)}</strong><em>{t.basis}</em></div>)}
          <div><span>Reward : risk</span><strong>{num(d.riskReward, 2)}</strong><em>before costs, <strong>{d.netRiskReward != null ? num(d.netRiskReward, 2) : "-"}</strong> after costs{d.netAtT1Pct != null ? ` (net ${num(d.netAtT1Pct, 1)}% at T1)` : ""}</em></div>
          <div><span>Holding period</span><strong className="stat-text">{d.holdingPeriod}</strong><em>review by {nptDate(d.reviewBy)}</em></div>
          <div><span>Confidence</span><strong className="stat-text">{d.confidenceLabel} ({d.confidence}/100)</strong><em>{d.history ? `${d.setupType}: ${d.history.trades} past trades, ${num(d.history.winRatePct, 0)}% profitable, avg ${num(d.history.avgNetPct, 1)}%` : "no track record for this setup yet"}</em></div>
        </div>
      )}
      <div className="grid g2">
        <div><h4 className="small muted">Technical reasons</h4><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{(d.techReasons.length ? d.techReasons : ["-"]).map((x: string) => <li key={x}>{x}</li>)}</ul></div>
        <div><h4 className="small muted">Fundamentals</h4><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{(d.fundReasons.length ? d.fundReasons : ["No statements stored."]).map((x: string) => <li key={x}>{x}</li>)}</ul></div>
      </div>
      <table className="t small"><tbody>
        <tr><td>Support</td><td>{d.supports.length ? d.supports.map((x: number) => num(x)).join(", ") : "-"}</td></tr>
        <tr><td>Resistance</td><td>{d.resistances.length ? d.resistances.map((x: number) => num(x)).join(", ") : "-"}</td></tr>
        <tr><td>RSI (14)</td><td>{num(ind.rsi, 1)}{ind.rsi != null ? (ind.rsi > 70 ? ", overbought" : ind.rsi < 30 ? ", oversold" : "") : ""}</td></tr>
        <tr><td>MACD</td><td>{ind.macd ?? "-"}</td></tr>
        <tr><td>Moving averages</td><td>SMA20 {num(ind.sma20)}, SMA50 {num(ind.sma50)}, SMA200 {num(ind.sma200)}, {ind.maPosition ?? "-"}</td></tr>
        <tr><td>Trend / ADX</td><td>{ind.trend ?? "-"}, ADX {num(ind.adx, 0)}</td></tr>
        <tr><td>Volume</td><td>{num(ind.volumeRatio, 2)}x 20-day average{ind.volumeConfirmed != null ? (ind.volumeConfirmed ? ", confirmed" : ", not confirmed") : ""}{ind.obv ? `, OBV ${ind.obv}` : ""}</td></tr>
        <tr><td>Liquidity</td><td>{d.avgTurnover ? `${compact(d.avgTurnover)} average daily turnover` : "-"}</td></tr>
      </tbody></table>
      {d.invalidation.length > 0 && <div><h4 className="small muted">What would invalidate this</h4><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{d.invalidation.map((x: string) => <li key={x}>{x}</li>)}</ul></div>}
      {d.longTerm && <Notice>Long-term view: fundamentals qualify (score {d.longTerm.fundamentalScore}/100). {d.longTerm.entryNote}</Notice>}
      <h4 className="small muted" style={{ marginBottom: 0 }}>Trade planner</h4>
      <TradePlanner key={symbol} entry={d.entry ?? d.price} stop={d.stop} targets={d.targets.map((t: Any) => t.price)} holdingDays={d.holdingPeriod?.startsWith("1-4") ? 21 : 90} fees={d.fees} onQty={(q, e) => setQty({ q, e })} />
      <div className="row">
        {paper && d.action !== "SELL" && d.action !== "INSUFFICIENT" && <button className="btn primary" disabled={!qty} onClick={paperTrade}><I.portfolio /> Paper trade this</button>}
        {d.action !== "INSUFFICIENT" && <button className="btn" onClick={setAlerts}><I.alerts /> Set alerts</button>}
        <Link className="btn" to={`/stocks/${symbol}`}>Full analysis</Link>
      </div>
      {msg && <Notice tone={msg.warn ? "warn" : "info"}>{msg.t}</Notice>}
      <p className="tiny faint">Educational, rule-based analysis of stored NEPSE data, not a guarantee. Confirm the price in your broker's TMS before trading.</p>
    </div>
  );
}

function LongTerm({ rows }: { rows: Any[] }) {
  return (
    <Card title="Long-term investment ideas" sub="Judged on the business, separately from short-term trades: fundamental score at least 65, no red flags, reasonable valuation, liquid">
      {rows.length === 0 ? <Empty title="No stock meets every long-term condition today" /> : (
        <DataTable rows={rows} rowKey={(r: Any) => r.symbol} maxHeight={600} initialSort={{ key: "fundamentalScore", dir: -1 }} cols={[
          { key: "symbol", label: "Stock", render: (r: Any) => <span><Link className="sym" to={`/stocks/${r.symbol}`}>{r.symbol}</Link> <span className="tiny faint">{r.sector}</span></span> },
          { key: "price", label: "Price", num: true, render: (r: Any) => num(r.price) },
          { key: "fundamentalScore", label: "Fund. score", num: true },
          { key: "pe", label: "P/E", num: true, render: (r: Any) => num(r.pe, 1) }, { key: "pb", label: "P/B", num: true, render: (r: Any) => num(r.pb, 2) },
          { key: "roe", label: "ROE", num: true, render: (r: Any) => r.roe != null ? `${num(r.roe, 1)}%` : "-" },
          { key: "cashYield", label: "Cash yield", num: true, render: (r: Any) => r.cashYield != null ? `${num(r.cashYield, 1)}%` : "-" },
          { key: "yearsPaid5", label: "Div. yrs (5)", num: true },
          { key: "entryNote", label: "Approach", render: (r: Any) => <span className="small">{r.entryNote}{r.cautions.length ? ` Caution: ${r.cautions.join("; ")}.` : ""}</span> },
        ]} />
      )}
      <p className="tiny faint" style={{ marginTop: 8 }}>A good business can still be a poor trade this month; buy in parts over time. See also <Link to="/future">Invest for the Future</Link>.</p>
    </Card>
  );
}

function TrackRecord() {
  const t = useApi<Any>("/trading/track");
  if (!t.data) return <Loading />;
  const s = t.data.summary, log = t.data.log;
  return (
    <div className="col">
      <Card title="Replay of the BUY rule (past year)" sub={t.data.method}>
        <table className="t small"><thead><tr><th>Setup type</th><th className="num">Trades</th><th className="num">Profitable</th><th className="num">Target hit</th><th className="num">Stop hit</th><th className="num">Avg net</th><th className="num">Avg R</th></tr></thead>
          <tbody>{s.byType.map((x: Any) => <tr key={x.type}><td>{x.type}</td><td className="num">{x.trades}</td><td className="num">{num(x.winRatePct, 0)}%</td><td className="num">{num(x.targetHitPct, 0)}%</td><td className="num">{num(x.stopHitPct, 0)}%</td><td className={`num ${tone(x.avgNetPct)}`}>{pct(x.avgNetPct, 2)}</td><td className="num">{num(x.avgR, 2)}</td></tr>)}
            <tr><td><strong>All</strong></td><td className="num">{s.trades}</td><td className="num">{num(s.winRatePct, 0)}%</td><td className="num">{num(s.targetHitPct, 0)}%</td><td className="num">{num(s.stopHitPct, 0)}%</td><td className={`num ${tone(s.avgNetPct)}`}>{pct(s.avgNetPct, 2)}</td><td className="num">{num(s.avgR, 2)}</td></tr></tbody></table>
      </Card>
      <Card title="Recent replayed trades">
        <DataTable rows={t.data.trades} rowKey={(r: Any, i) => `${r.symbol}-${r.date}-${i}`} maxHeight={420} cols={[
          { key: "date", label: "Signal", render: (r: Any) => <span className="small">{r.date}</span> }, { key: "symbol", label: "Stock", render: (r: Any) => <Link className="sym" to={`/stocks/${r.symbol}`}>{r.symbol}</Link> },
          { key: "type", label: "Setup", render: (r: Any) => <span className="small">{r.type}</span> }, { key: "entry", label: "Entry", num: true, render: (r: Any) => num(r.entry) },
          { key: "stop", label: "Stop", num: true, render: (r: Any) => num(r.stop) }, { key: "t1", label: "T1", num: true, render: (r: Any) => num(r.t1) },
          { key: "outcome", label: "Outcome", render: (r: Any) => <Badge tone={r.outcome === "target" ? "up" : r.outcome === "stop" ? "down" : ""}>{r.outcome} {r.exitDate}</Badge> },
          { key: "netPct", label: "Net", num: true, render: (r: Any) => <span className={tone(r.netPct)}>{pct(r.netPct, 2)}</span> },
        ]} />
      </Card>
      <Card title="Live signal log" sub={log.summary?.sinceDate ? `Signals recorded each day since ${log.summary.sinceDate}; ${log.summary.closed} BUY signals closed, ${log.summary.targetHitPct ?? "-"}% hit a target` : "Signals are recorded each trading day from now on and judged against later prices"}>
        {log.rows.length === 0 ? <Empty title="No live signals recorded yet" /> : (
          <DataTable rows={log.rows} rowKey={(r: Any) => `${r.date}-${r.symbol}`} maxHeight={420} cols={[
            { key: "date", label: "Date", render: (r: Any) => <span className="small">{r.date}</span> }, { key: "symbol", label: "Stock", render: (r: Any) => <Link className="sym" to={`/stocks/${r.symbol}`}>{r.symbol}</Link> },
            { key: "action", label: "Signal", render: (r: Any) => <Badge tone={ACTION_TONE[r.action]}>{r.action}</Badge> }, { key: "price", label: "Price then", num: true, render: (r: Any) => num(r.price) },
            { key: "lastClose", label: "Now", num: true, render: (r: Any) => <span>{num(r.lastClose)} <span className={tone(r.changePct)}>{r.changePct != null ? `(${pct(r.changePct, 1)})` : ""}</span></span> },
            { key: "status", label: "Status", render: (r: Any) => <span className="small">{r.status}{r.on ? `, ${r.on}` : ""}</span> },
          ]} />
        )}
      </Card>
    </div>
  );
}
