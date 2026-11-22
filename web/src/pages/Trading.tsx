// Trading Opportunities: every listed stock classified BUY / SELL / HOLD / WATCH / AVOID (or
// insufficient data) by transparent rules, long-term ideas judged separately, a trade planner,
// paper trading, alerts, and the rules' real track record after fees.
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { Card, Stat, Loading, ErrorBox, Empty, Badge, Tabs, Modal, Notice, DataTable } from "../components/ui.tsx";
import { TradePlanner } from "../components/TradePlanner.tsx";
import { ResearchCard, DECISION_TONE } from "../components/ResearchCard.tsx";
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
  const nav = useNavigate();
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
      <ResearchPicks research={d.data.research ?? {}} rows={d.data.rows} onOpen={(sym) => nav(`/stocks/${sym}?from=research`)} />
      <MarketIntel onOpen={(sym) => nav(`/stocks/${sym}?from=research`)} />
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
            <DataTable rows={rows} rowKey={(r: Any) => r.symbol} onRow={(r: Any) => nav(`/stocks/${r.symbol}?tab=plan&from=research`)} maxHeight={640} initialSort={{ key: "confidence", dir: -1 }} cols={[
              { key: "symbol", label: "Stock", render: (r: Any) => <span><span className="sym">{r.symbol}</span> <span className="tiny faint">{r.sector}</span></span> },
              { key: "price", label: "Close", num: true, title: "The closing price the signal was set on", render: (r: Any) => <span>{num(r.price)}<span className="tiny faint" style={{ display: "block" }}>{nptDate(r.priceDate)}</span></span> },
              { key: "live", label: "Live now", num: true, sort: (r: Any) => r.live?.price ?? 0, render: (r: Any) => r.live ? <span title={r.live.note}>{num(r.live.price)}<span style={{ display: "block" }}><LiveTag s={r.live.status} /></span></span> : <span className="tiny faint">-</span> },
              { key: "action", label: "Action", render: (r: Any) => <span><Badge tone={ACTION_TONE[r.action]}>{r.action === "INSUFFICIENT" ? "NO DATA" : r.action}</Badge>{r.signalSince && <span className="tiny faint" style={{ display: "block" }}>since {nptDate(r.signalSince)}</span>}</span> },
              ...(tab === "buy" || tab === "watch" ? [
                { key: "entryLow", label: "Buy range", num: true, render: (r: Any) => r.entryLow != null ? `${num(r.entryLow)}-${num(r.entryHigh)}` : "-" },
                { key: "stop", label: "Stop", num: true, render: (r: Any) => r.stop != null ? num(r.stop) : "-" },
                { key: "t", label: "Targets", num: true, render: (r: Any) => r.targets.length ? r.targets.map((x: Any) => num(x.price, 0)).join(" / ") : "-" },
                { key: "netRiskReward", label: "R:R net", num: true, render: (r: Any) => r.netRiskReward != null ? <span title={`Before costs ${num(r.riskReward, 2)}`}>{num(r.netRiskReward, 2)}</span> : "-" },
                { key: "holdingPeriod", label: "Hold", render: (r: Any) => <span className="small">{r.holdingPeriod ?? "-"}</span> },
              ] : [{ key: "stop", label: tab === "hold" ? "Exit below" : "Stop / invalidation", num: true, render: (r: Any) => r.stop != null ? num(r.stop) : "-" }]),
              { key: "research", label: "Research", sort: (r: Any) => ["STRONG BUY", "BUY", "ACCUMULATE", "WATCH", "HOLD", "REDUCE", "SELL", "AVOID"].indexOf(d.data.research?.[r.symbol]?.decision ?? "x"), render: (r: Any) => { const x = d.data.research?.[r.symbol]; return x ? <span title={x.headline}><Badge tone={DECISION_TONE[x.decision]}>{x.decision}</Badge><span className="tiny faint" style={{ display: "block" }}>{x.agree.positive} for / {x.agree.negative} against</span></span> : <span className="tiny faint">-</span>; } },
              { key: "confidence", label: "Confidence", num: true, render: (r: Any) => r.confidenceLabel === "-" ? "-" : <span title={`${r.confidence}/100`}>{r.confidenceLabel}</span> },
              { key: "headline", label: "Why", render: (r: Any) => <span className="small">{r.headline}</span> },
            ]} />
          )}
          <p className="tiny faint" style={{ marginTop: 8 }}>Signals are set on the last official close and stay the same all day; they are recalculated once after each day's close. "Live now" shows whether the entry is still available at today's price. Tap a stock for the full plan, trade planner, paper trading, alerts and the full company page.</p>
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

export function Detail({ symbol }: { symbol: string }) {
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
      <div className="row" style={{ gap: 8 }}><Link className="btn primary sm" to={`/stocks/${symbol}`}>Full company page: chart, financials, news</Link><Link className="btn sm" to={`/terminal/${symbol}`}>Open chart</Link></div>
      {d.live && <Notice tone={d.live.status === "in-zone" ? "info" : "warn"}><strong>Live now:</strong> {d.live.note}</Notice>}
      <ResearchCard symbol={symbol} />
      <h4 className="small muted" style={{ margin: "4px 0 0" }}>The chart setup in detail</h4>
      <Notice tone={d.action === "BUY" ? "info" : "warn"}>{d.signalSince ? <strong>Signal since {nptDate(d.signalSince)}. </strong> : null}{d.headline}{d.buyNow === "wait" && d.waitFor ? ` Wait for ${d.waitFor}.` : d.buyNow === "now" ? " Entry conditions are met now." : ""}</Notice>
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

const LIVE_LABEL: Record<string, [string, "up" | "down" | "warn" | "blue"]> = { "in-zone": ["still in zone", "up"], "above-zone": ["above zone, wait", "warn"], "below-zone": ["below zone", "warn"], "stop-hit": ["stop hit", "down"], "target-hit": ["target hit", "blue"], holding: ["", "blue"], none: ["", "blue"] };
function LiveTag({ s }: { s: string }) {
  const [label, t] = LIVE_LABEL[s] ?? ["", "blue"];
  return label ? <Badge tone={t}>{label}</Badge> : null;
}

/** The final research decisions, best first: what to buy, accumulate, and what holders should sell or reduce. */
function ResearchPicks({ research, rows, onOpen }: { research: Record<string, Any>; rows: Any[]; onOpen: (s: string) => void }) {
  const by = new Map(rows.map((r: Any) => [r.symbol, r]));
  const list = (ds: string[]) => Object.entries(research).filter(([, v]) => ds.includes(v.decision)).sort((a, b) => ds.indexOf(a[1].decision) - ds.indexOf(b[1].decision) || b[1].agree.positive - a[1].agree.positive);
  const buys = list(["STRONG BUY", "BUY"]), acc = list(["ACCUMULATE"]), sells = list(["SELL", "REDUCE"]);
  // How every company studied today ended up.
  const n = (f: (r: Any) => boolean) => rows.filter(f).length;
  const funnel = [
    { k: "Trade buy signal", v: n((r) => r.action === "BUY"), t: "up" },
    { k: "Close to a buy", v: n((r) => r.action === "WATCH" && r.entryLow != null), t: "warn" },
    { k: "Uptrend, hold if owned", v: n((r) => r.action === "HOLD"), t: "blue" },
    { k: "No setup yet", v: n((r) => r.action === "WATCH" && r.entryLow == null), t: "muted" },
    { k: "Downtrend, avoid", v: n((r) => r.action === "AVOID" && !/illiquid/i.test(r.headline)), t: "down" },
    { k: "Too thinly traded", v: n((r) => r.action === "AVOID" && /illiquid/i.test(r.headline)), t: "muted" },
    { k: "Sell signal", v: n((r) => r.action === "SELL"), t: "down" },
    { k: "Too new to judge", v: n((r) => r.action === "INSUFFICIENT"), t: "muted" },
  ];
  const near = rows.filter((r: Any) => r.action === "WATCH" && r.entryLow != null).sort((a: Any, b: Any) => b.confidence - a.confidence).slice(0, 8);
  const row = ([s, v]: [string, Any]) => (
    <button key={s} className="pick-row" onClick={() => onOpen(s)}>
      <span><span className="sym">{s}</span> <Badge tone={DECISION_TONE[v.decision]}>{v.decision}</Badge></span>
      <span className="tiny muted pick-why">{v.headline}</span>
      <span className="tiny faint">{v.conviction} conviction, {v.agree.positive} for / {v.agree.negative} against{by.get(s)?.price ? `, Rs. ${num(by.get(s).price)}` : ""}{v.smart ? `. Smart money: ${v.smart.phase.toLowerCase()}, brokers ${v.smart.brokerRead.toLowerCase()}, manipulation risk ${v.smart.risk.toLowerCase()}` : ""}</span>
    </button>
  );
  return (
    <Card title="Final research picks" sub="Only where the chart, indicators, business, reports, news, market, smart money (brokers and manipulation) and the economy were all studied. Tap a stock for the full research and plan.">
      <div className="funnel">
        <div className="small"><strong>All {rows.length} listed companies were studied today</strong> <span className="muted">(debentures, bonds, mutual funds and promoter shares are left out). This is where each one stands:</span></div>
        <div className="funnel-row">{funnel.map((f) => <span key={f.k} className="funnel-chip"><strong className={f.t}>{f.v}</strong> {f.k}</span>)}</div>
        <div className="tiny muted">A trade buy needs a confirmed setup in the buy range, a reward at least 1.8 times the risk after all charges and tax, enough trading volume, and then the research checks above. In a falling market few stocks pass, and that is deliberate: even with these strict rules, past signals in this weak market averaged a small loss (see the track record below), so the app does not loosen them to show more buys.</div>
      </div>
      <div className="grid g3">
        <div><h4 className="small muted">Buy (trade)</h4>{buys.length ? buys.map(row) : <div className="tiny faint">No stock passes every check for a buy today. That is a normal, honest result in a weak or fearful market.</div>}</div>
        <div><h4 className="small muted">Accumulate (long term)</h4>{acc.length ? acc.map(row) : <div className="tiny faint">None today.</div>}</div>
        <div><h4 className="small muted">Sell / reduce (if you hold)</h4>{sells.length ? sells.map(row) : <div className="tiny faint">None today.</div>}</div>
      </div>
      {near.length > 0 && <>
        <h4 className="small muted" style={{ marginTop: 14 }}>Closest to a buy, and what is still missing</h4>
        <div className="near-list">{near.map((r: Any) => (
          <button key={r.symbol} className="pick-row" onClick={() => onOpen(r.symbol)}>
            <span><span className="sym">{r.symbol}</span> <span className="tiny muted">{r.setupType}, quality {r.confidence}/100</span></span>
            <span className="tiny muted pick-why">Missing: {r.headline.replace(/^.*?not a buy yet: /, "")}</span>
            <span className="tiny faint">Buy range Rs. {num(r.entryLow)}-{num(r.entryHigh)}{r.stop ? `, stop ${num(r.stop)}` : ""}{r.price ? `, now ${num(r.price)}` : ""}</span>
          </button>
        ))}</div>
      </>}
    </Card>
  );
}

/** Market-wide: the economy and policy backdrop, what the biggest brokers are buying and selling, and stocks showing operator footprints. */
function MarketIntel({ onOpen }: { onOpen: (s: string) => void }) {
  const r = useApi<Any>("/market/intel", []);
  if (!r.data) return null;
  const { macro: m, favourites: f, flagged, accumulating, distributing } = r.data;
  const eff = (e: string) => (e === "positive" ? "up" : e === "negative" ? "down" : "muted");
  const sym = (s: string, extra?: string) => <button key={s} type="button" className="chip-link" onClick={() => onOpen(s)}><span className="sym">{s}</span>{extra ? <span className="tiny muted"> {extra}</span> : null}</button>;
  return (
    <Card title="Smart money and economy" sub="NEPSE is easily moved by large traders and by policy. This is what the brokers, NRB data and the news say right now. Every stock's research includes it.">
      <div className="grid g2">
        <div>
          <h4 className="small muted">Economy, policy and politics <Badge tone={m.verdict === "positive" ? "up" : m.verdict === "negative" ? "down" : "warn"}>{m.verdict === "positive" ? "Supportive" : m.verdict === "negative" ? "Against" : m.verdict === "unknown" ? "No data" : "Mixed"}</Badge></h4>
          <div className="tiny muted" style={{ marginBottom: 6 }}>{m.summary}{m.asOf ? ` NRB report of ${nptDate(m.asOf)}.` : ""}</div>
          <ul className="small intel-list">{m.points.map((p: Any) => <li key={p.label}><strong className={eff(p.effect)}>{p.label}: {p.value}.</strong> <span className="muted">{p.why}</span></li>)}</ul>
          {m.news.filter((x: Any) => x.theme !== "Market").length > 0 && <>
            <h4 className="small muted" style={{ marginTop: 10 }}>Headlines that can move the market (last 3 weeks)</h4>
            <ul className="tiny intel-list">{m.news.filter((x: Any) => x.theme !== "Market").slice(0, 8).map((x: Any) => <li key={x.title}><span className={eff(x.tone)}>{x.theme}</span>: {x.url ? <a href={x.url} target="_blank" rel="noreferrer">{x.title}</a> : x.title}{x.date ? <span className="faint"> ({nptDate(x.date)})</span> : null}</li>)}</ul>
            <div className="tiny faint">Tone is read from headline words, a guide only; open the headline to read it.</div>
          </>}
          <ul className="tiny muted intel-list" style={{ marginTop: 8 }}>{m.calendar.map((c: string) => <li key={c}>{c}</li>)}</ul>
        </div>
        <div>
          <h4 className="small muted">Brokers' favourites{f.sessions ? ` (${f.sessions} session${f.sessions > 1 ? "s" : ""}${f.from ? `, ${f.from === f.to ? nptDate(f.from) : `${nptDate(f.from)} to ${nptDate(f.to)}`}` : ""})` : ""}</h4>
          {f.sessions ? <>
            <div className="tiny muted" style={{ marginBottom: 4 }}>What the 10 brokers with the highest turnover net bought and sold (Rs. crore). Heavy net buying by big brokers often comes before a move; heavy net selling often marks distribution.</div>
            <div className="small"><strong className="up">Net bought:</strong> <span className="chip-row">{f.buy.slice(0, 10).map((x: Any) => sym(x.symbol, `+${x.netCr}`))}</span></div>
            <div className="small" style={{ marginTop: 6 }}><strong className="down">Net sold:</strong> <span className="chip-row">{f.sell.slice(0, 10).map((x: Any) => sym(x.symbol, `${x.netCr}`))}</span></div>
          </> : <div className="tiny faint">No broker (floorsheet) data stored yet.</div>}
          <h4 className="small muted" style={{ marginTop: 12 }}>Footprints among stocks with signals</h4>
          <div className="small"><strong className="up">Accumulation:</strong> {accumulating.length ? <span className="chip-row">{accumulating.map((x: Any) => sym(x.symbol))}</span> : <span className="tiny faint">none seen</span>}</div>
          <div className="small" style={{ marginTop: 6 }}><strong className="down">Distribution:</strong> {distributing.length ? <span className="chip-row">{distributing.map((x: Any) => sym(x.symbol))}</span> : <span className="tiny faint">none seen</span>}</div>
          <div className="small" style={{ marginTop: 6 }}><strong className="warn">Possible operator activity:</strong> {flagged.length ? <span className="chip-row">{flagged.map((x: Any) => sym(x.symbol))}</span> : <span className="tiny faint">none flagged</span>}</div>
          <div className="tiny faint" style={{ marginTop: 8 }}>Broker numbers are as shown on the NEPSE floorsheet. The floorsheet shows brokers, not their clients, so this reads footprints, not intentions.</div>
        </div>
      </div>
    </Card>
  );
}
