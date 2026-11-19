// One holding's plan: action, break-even, stop, sell zones, add zone, next steps, signal, scores and news.
// Used on Portfolio (What to do next) and at the top of a stock's page when you hold it.
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.ts";
import { Badge, Score } from "./ui.tsx";
import { I } from "./icons.tsx";
import { num, pct, tone, compact, int, nptDate } from "../lib/format.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export const PLAN_TONE: Record<string, "up" | "down" | "warn" | "blue"> = { ADD: "up", "BOOK PROFIT": "up", HOLD: "blue", REDUCE: "down", SELL: "down", REVIEW: "warn" };
const PLAN_HELP: Record<string, string> = {
  SELL: "The daily signal says exit or reduce.", REVIEW: "The setup failed: decide today.", REDUCE: "Weak trend or business: lighten up on bounces.",
  "BOOK PROFIT": "At resistance with a good gain: take some profit.", ADD: "Sound business at a buy level: you may add.", HOLD: "Keep it, with a stop.",
};

const ACTION_TONE2: Record<string, "up" | "down" | "warn" | "blue"> = { BUY: "up", SELL: "down", WATCH: "warn", HOLD: "blue", AVOID: "down" };

export function PlanCard({ x, news, compactHead = false }: { x: Any; news: Any[]; compactHead?: boolean }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const alerts = async () => {
    try {
      if (x.stop) await api("/alerts", { body: { type: "price_below", symbol: x.symbol, params: { price: x.stop.price }, note: `Stop for your ${x.symbol}` } });
      const t = x.targets.find((t: Any) => !/Break-even/.test(t.basis)) ?? x.targets[0];
      if (t) await api("/alerts", { body: { type: "price_above", symbol: x.symbol, params: { price: t.price }, note: `Sell zone for your ${x.symbol}` } });
      if (x.addZone) await api("/alerts", { body: { type: "price_in_range", symbol: x.symbol, params: { low: x.addZone.low, high: x.addZone.high }, note: `Add zone for ${x.symbol}` } });
      setMsg("Alerts set for the stop, the first sell zone" + (x.addZone ? " and the add zone" : "") + ".");
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className={`card plan-card t-${PLAN_TONE[x.action]}`}>
      <Link to={compactHead ? "#" : `/stocks/${x.symbol}`} className="plan-head" onClick={compactHead ? (e) => e.preventDefault() : undefined}>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}><span className="sym" style={{ fontSize: 16 }}>{x.symbol}</span><Badge tone={PLAN_TONE[x.action]}>{x.action}</Badge>{x.live && <Badge tone="up">live</Badge>}</div>
          <div className="tiny faint" style={{ marginTop: 2 }}>{x.name}{x.sector ? `, ${x.sector}` : ""}</div>
        </div>
        <div className="right">
          <div className="mono">Rs. {num(x.price)}</div>
          <div className={`tiny ${tone(x.pnl)}`}>{x.pnl != null ? `${compact(x.pnl)} (${pct(x.pnlPct, 1)})` : "-"}</div>
        </div>
      </Link>
      <div className="plan-headline">{x.headline}<span className="tiny faint"> {PLAN_HELP[x.action]}</span></div>
      <div className="plan-grid4">
        <div><span>Your cost</span><strong>{num(x.wacc)}</strong><em>{int(x.quantity)} kitta (WACC)</em></div>
        <div><span>Break-even</span><strong>{x.breakeven != null ? num(x.breakeven) : "-"}</strong><em>{x.toBreakevenPct != null ? (x.toBreakevenPct > 0 ? `${num(x.toBreakevenPct, 1)}% above price` : "price is above it") : ""}</em></div>
        <div><span>Stop-loss</span><strong className="down">{x.stop ? num(x.stop.price) : "-"}</strong><em>{x.stop?.basis ?? ""}</em></div>
        <div><span>Sell zones</span><strong className="up">{x.targets.length ? x.targets.map((t: Any) => num(t.price, 0)).join(" / ") : "-"}</strong><em>{x.targets[0] ? `net ${compact(x.targets[0].netProfit)} at the first` : "no level measured above"}</em></div>
        {x.addZone && <div><span>Add more at</span><strong>{num(x.addZone.low)}-{num(x.addZone.high)}</strong><em>{x.addZone.basis}</em></div>}
        {x.longTermInDays != null && x.longTermInDays <= 120 && <div><span>Long-term tax in</span><strong>{x.longTermInDays} days</strong><em>held {x.holdingDays} days</em></div>}
      </div>
      <ol className="plan-steps">{x.steps.map((st: string) => <li key={st}>{st}</li>)}</ol>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {!compactHead && <Link className="btn sm primary" to={`/stocks/${x.symbol}`}>Full company page</Link>}
        {compactHead && <Link className="btn sm primary" to="/portfolio">Open portfolio</Link>}
        <Link className="btn sm" to={`/terminal/${x.symbol}`}>Chart</Link>
        <button className="btn sm" onClick={alerts}><I.alerts /> Set alerts</button>
        <button className="btn sm ghost" onClick={() => setOpen(!open)}>{open ? "Less" : "Why, signal and news"}</button>
      </div>
      {msg && <div className="tiny muted">{msg}</div>}
      {open && <div className="plan-more">
        <div className="grid g2">
          <div><h4 className="small muted">Signal now <Badge tone={ACTION_TONE2[x.signal.action] ?? "blue"}>{x.signal.action}</Badge></h4><div className="small">{x.signal.headline}</div>
            {x.signal.since && <div className="tiny faint">since {nptDate(x.signal.since)}</div>}
            {x.atPurchase && <div className="tiny muted" style={{ marginTop: 6 }}>When you bought ({nptDate(x.atPurchase.date)}): {x.atPurchase.action}{x.atPurchase.entryLow ? `, entry ${num(x.atPurchase.entryLow)}-${num(x.atPurchase.entryHigh)}` : ""}{x.atPurchase.stop ? `, stop ${num(x.atPurchase.stop)}` : ""}{x.atPurchase.t1 ? `, target ${num(x.atPurchase.t1)}` : ""}.</div>}
          </div>
          <div><h4 className="small muted">Scores</h4><div className="row" style={{ gap: 12 }}><span className="small">Fundamental <Score value={x.scores.fundamental} /></span><span className="small">Technical <Score value={x.scores.technical} /></span></div></div>
        </div>
        <div className="grid g2" style={{ marginTop: 8 }}>
          <div><h4 className="small muted">Technical</h4><ul className="small plan-ul">{(x.technical.length ? x.technical : ["No setup details."]).map((t: string) => <li key={t}>{t}</li>)}</ul></div>
          <div><h4 className="small muted">Fundamental</h4><ul className="small plan-ul">{(x.fundamental.length ? x.fundamental : ["No statements stored."]).map((t: string) => <li key={t}>{t}</li>)}</ul></div>
        </div>
        {x.risks.length > 0 && <><h4 className="small muted">Risks / what would change the plan</h4><ul className="small plan-ul">{x.risks.map((t: string) => <li key={t}>{t}</li>)}</ul></>}
        <h4 className="small muted">Latest news</h4>
        {news.length ? <ul className="small plan-ul">{news.slice(0, 5).map((n: Any, i: number) => <li key={i}>{n.url ? <a href={n.url} target="_blank" rel="noreferrer">{n.title}</a> : n.title} <span className="tiny faint">{n.published_date ? nptDate(n.published_date) : ""}</span></li>)}</ul> : <div className="tiny faint">No news in the last 45 days.</div>}
      </div>}
    </div>
  );
}
