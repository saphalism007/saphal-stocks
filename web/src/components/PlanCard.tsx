// One holding's plan: action, break-even, stop, sell zones, add zone, next steps, signal, scores and news.
// Used on Portfolio (What to do next) and at the top of a stock's page when you hold it.
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.ts";
import { Badge, Score } from "./ui.tsx";
import { I } from "./icons.tsx";
import { ResearchCard } from "./ResearchCard.tsx";
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
  const [full, setFull] = useState(false);
  const sm = x.research?.smart;
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
          <div className="tiny faint" style={{ marginTop: 2 }}>{x.name}{x.sector ? `, ${x.sector}` : ""}{x.weightPct != null ? `, ${num(x.weightPct, 1)}% of portfolio` : ""}</div>
        </div>
        <div className="right">
          <div className="mono">Rs. {num(x.price)}</div>
          <div className={`tiny ${tone(x.pnl)}`}>{x.pnl != null ? `${compact(x.pnl)} (${pct(x.pnlPct, 1)})` : "-"}</div>
        </div>
      </Link>
      {x.research && <div className="plan-research"><span className="tiny faint">Research</span> <Badge tone={x.research.decision === "STRONG BUY" || x.research.decision === "BUY" || x.research.decision === "ACCUMULATE" ? "up" : ["SELL", "REDUCE", "AVOID"].includes(x.research.decision) ? "down" : x.research.decision === "WATCH" ? "warn" : "blue"}>{x.research.decision}</Badge>
        <span className="tiny muted">{x.research.agree.positive} for / {x.research.agree.negative} against, {x.research.conviction} conviction</span>
        <span className="plan-dots">{x.research.pillars.map((pp: Any) => <i key={pp.title} title={`${pp.title}: ${pp.summary}`} className={`dot-${pp.verdict}`} />)}</span></div>}
      <div className="plan-headline">{x.headline}<span className="tiny faint"> {PLAN_HELP[x.action]}</span></div>
      {sm && <div className="research-smart">
        <span>Smart money <strong>{sm.phase}</strong></span>
        <span>Big brokers <strong className={sm.brokerRead === "Accumulation" ? "up" : sm.brokerRead === "Distribution" ? "down" : ""}>{sm.brokerRead === "Accumulation" ? "buying" : sm.brokerRead === "Distribution" ? "selling" : sm.brokerRead.toLowerCase()}</strong>{sm.sessions ? <span className="faint"> ({sm.sessions} session{sm.sessions > 1 ? "s" : ""})</span> : null}</span>
        <span>Manipulation risk <strong className={sm.risk === "High" ? "down" : sm.risk === "Medium" ? "warn" : "up"}>{sm.risk}</strong></span>
        {x.strength != null && <span>Holding strength <strong className={x.strength >= 60 ? "up" : x.strength < 40 ? "down" : ""}>{x.strength}/100</strong></span>}
      </div>}
      <div className="plan-grid4">
        <div><span>Your cost</span><strong>{num(x.wacc)}</strong><em>{int(x.quantity)} kitta (WACC)</em></div>
        <div><span>Break-even</span><strong>{x.breakeven != null ? num(x.breakeven) : "-"}</strong><em>{x.toBreakevenPct != null ? (x.toBreakevenPct > 0 ? `${num(x.toBreakevenPct, 1)}% above price` : "price is above it") : ""}</em></div>
        <div><span>Stop-loss</span><strong className="down">{x.stop ? num(x.stop.price) : "-"}</strong><em>{x.stop?.basis ?? ""}</em></div>
        <div><span>Sell zones</span><strong className="up">{x.targets.length ? x.targets.map((t: Any) => num(t.price, 0)).join(" / ") : "-"}</strong><em>{x.targets[0] ? `net ${compact(x.targets[0].netProfit)} at the first` : "no level measured above"}</em></div>
        {x.addZone && <div><span>Add more at</span><strong>{num(x.addZone.low)}-{num(x.addZone.high)}</strong><em>{x.addZone.basis}</em></div>}
        {x.longTermInDays != null && x.longTermInDays <= 120 && <div><span>Long-term tax in</span><strong>{x.longTermInDays} days</strong><em>held {x.holdingDays} days</em></div>}
      </div>
      {x.scenarios?.length > 0 && <div className="plan-scen">
        {x.scenarios.map((sc: Any) => <div key={sc.label}><span>{sc.label}</span><strong className={tone(sc.profit)}>{sc.profit >= 0 ? "+" : ""}{compact(sc.profit)}</strong><em>at Rs. {num(sc.price)}, you receive {compact(sc.receive)}</em></div>)}
        {x.riskReward?.ratio != null && <div><span>Odds from here</span><strong className={x.riskReward.ratio >= 2 ? "up" : x.riskReward.ratio < 1 ? "down" : ""}>1 : {num(x.riskReward.ratio, 1)}</strong><em>risk {compact(x.riskReward.risk)} to make {compact(x.riskReward.reward)}</em></div>}
      </div>}
      <ol className="plan-steps">{x.steps.map((st: string) => <li key={st}>{st}</li>)}</ol>
      {x.timing?.length > 0 && <div className="plan-timing">{x.timing.map((t: Any) => <div key={t.label + t.date}><Badge tone="blue">{t.date ? nptDate(t.date) : t.label}</Badge> <span className="small"><strong>{t.date ? t.label : ""}</strong>{t.date ? ": " : ""}{t.detail}</span></div>)}</div>}
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {!compactHead && <Link className="btn sm primary" to={`/stocks/${x.symbol}`}>Full company page</Link>}
        {compactHead && <Link className="btn sm primary" to="/portfolio">Open portfolio</Link>}
        <Link className="btn sm" to={`/terminal/${x.symbol}`}>Chart</Link>
        <button className="btn sm" onClick={alerts}><I.alerts /> Set alerts</button>
        <button className="btn sm" onClick={() => setFull(!full)}>{full ? "Hide research" : "Full research"}</button>
        <button className="btn sm ghost" onClick={() => setOpen(!open)}>{open ? "Less" : "Why, signal and news"}</button>
      </div>
      {msg && <div className="tiny muted">{msg}</div>}
      {full && <ResearchCard symbol={x.symbol} />}
      {open && <div className="plan-more">
        <div className="grid g2">
          <div><h4 className="small muted">Signal now <Badge tone={ACTION_TONE2[x.signal.action] ?? "blue"}>{x.signal.action}</Badge></h4><div className="small">{x.signal.headline}</div>
            {x.signal.since && <div className="tiny faint">since {nptDate(x.signal.since)}</div>}
            {x.atPurchase && <div className="tiny muted" style={{ marginTop: 6 }}>When you bought ({nptDate(x.atPurchase.date)}): {x.atPurchase.action}{x.atPurchase.entryLow ? `, entry ${num(x.atPurchase.entryLow)}-${num(x.atPurchase.entryHigh)}` : ""}{x.atPurchase.stop ? `, stop ${num(x.atPurchase.stop)}` : ""}{x.atPurchase.t1 ? `, target ${num(x.atPurchase.t1)}` : ""}.</div>}
          </div>
          <div><h4 className="small muted">Scores</h4><div className="row" style={{ gap: 12 }}><span className="small">Fundamental <Score value={x.scores.fundamental} /></span><span className="small">Technical <Score value={x.scores.technical} /></span></div></div>
        </div>
        {x.research && <><h4 className="small muted">Research, area by area</h4><ul className="small plan-ul">{x.research.pillars.map((pp: Any) => <li key={pp.title}><strong>{pp.title}</strong> ({pp.verdict}): {pp.summary}</li>)}</ul></>}
        <div className="grid g2" style={{ marginTop: 8 }}>
          <div><h4 className="small muted">Technical</h4><ul className="small plan-ul">{(x.technical.length ? x.technical : ["No setup details."]).map((t: string) => <li key={t}>{t}</li>)}</ul></div>
          <div><h4 className="small muted">Fundamental</h4><ul className="small plan-ul">{(x.fundamental.length ? x.fundamental : ["No statements stored."]).map((t: string) => <li key={t}>{t}</li>)}</ul></div>
        </div>
        {sm && <><h4 className="small muted">Smart money detail</h4><ul className="small plan-ul">
          <li>{sm.phaseWhy}</li>
          {sm.riskWhy.map((t: string) => <li key={t} className="warn">{t}</li>)}
          {sm.topBuyers.length > 0 && <li>Biggest net buyers: {sm.topBuyers.map((b: Any) => `broker ${b.broker} (+${int(b.net)})`).join(", ")}{sm.metrics.top3NetBuyPct != null ? `; top 3 took ${sm.metrics.top3NetBuyPct}% of volume` : ""}.</li>}
          {sm.topSellers.length > 0 && <li>Biggest net sellers: {sm.topSellers.map((b: Any) => `broker ${b.broker} (${int(b.net)})`).join(", ")}{sm.metrics.top3NetSellPct != null ? `; top 3 gave ${sm.metrics.top3NetSellPct}%` : ""}.</li>}
        </ul></>}
        {x.risks.length > 0 && <><h4 className="small muted">Risks / what would change the plan</h4><ul className="small plan-ul">{x.risks.map((t: string) => <li key={t}>{t}</li>)}</ul></>}
        <h4 className="small muted">Latest news</h4>
        {news.length ? <ul className="small plan-ul">{news.slice(0, 5).map((n: Any, i: number) => <li key={i}>{n.url ? <a href={n.url} target="_blank" rel="noreferrer">{n.title}</a> : n.title} <span className="tiny faint">{n.published_date ? nptDate(n.published_date) : ""}</span></li>)}</ul> : <div className="tiny faint">No news in the last 45 days.</div>}
      </div>}
    </div>
  );
}
