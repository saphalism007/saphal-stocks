// AI Analyst panel beside the chart: the decision, the evidence, levels, strategies by holding
// period, chart Q&A, trade planning (saved plans, paper trades, alerts) and the pattern scanner.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { Markdown, Notice, Loading, Badge, Seg } from "../components/ui.tsx";
import { TradePlanner } from "../components/TradePlanner.tsx";
import { num, rs, todayNpt, nptDate } from "../lib/format.ts";
import { roundTrip } from "../../../shared/costs.ts";
import type { ChartAnalysis, Tone } from "../../../shared/analyst.ts";
import type { Bar } from "../../../shared/types.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export type PanelTab = "ai" | "ask" | "plan" | "scan";
const VCLASS: Record<string, string> = { "STRONG BUY": "v-sbuy", BUY: "v-buy", WAIT: "v-wait", HOLD: "v-hold", SELL: "v-sell", "STRONG SELL": "v-ssell", "NO SIGNAL": "v-none" };
const dot = (t: Tone) => <span className={`tdot ${t}`} />;
const pctS = (x: number | null | undefined) => (x == null ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(2)}%`);

export default function AiPanel({ symbol, analysis, loading, error, bars, tab, setTab, onSymbol, priceInfo }: { symbol: string; analysis: ChartAnalysis | null; loading: boolean; error: string | null; bars: Bar[] | null; tab: PanelTab; setTab: (t: PanelTab) => void; onSymbol: (s: string) => void; priceInfo: Any }) {
  return (
    <div className="ai-panel">
      <div className="ai-tabs">
        {([["ai", "AI Analysis"], ["ask", "Ask AI"], ["plan", "Trade plan"], ["scan", "Scanner"]] as [PanelTab, string][]).map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div className="ai-body">
        {tab === "scan" ? <Scanner onSymbol={onSymbol} current={symbol} />
          : error ? <Notice tone="warn">Analysis unavailable: {error}</Notice>
          : !analysis || loading ? <Loading label="Analysing the chart" />
          : tab === "ai" ? <Analysis a={analysis} priceInfo={priceInfo} />
          : tab === "ask" ? <Ask a={analysis} />
          : <Plan a={analysis} bars={bars} />}
      </div>
    </div>
  );
}

const OK: Record<string, string> = { buy: "o-buy", sell: "o-sell", stop: "o-stop", wait: "o-wait", hold: "o-hold", avoid: "o-stop" };
function Orders({ o }: { o: NonNullable<ChartAnalysis["orders"]> }) {
  const [who, setWho] = useState<"buy" | "own">("buy");
  const steps = who === "buy" ? o.forBuyers : o.forHolders;
  return (
    <div className="orders">
      <div className="row between" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}><strong>What to do</strong><Seg value={who} onChange={setWho} options={[{ key: "buy", label: "I want to buy" }, { key: "own", label: "I own it" }]} /></div>
      <p className="o-sum">{o.summary}</p>
      <ol className="o-steps">{steps.map((st, i) => <li key={i} className={OK[st.kind]}><b>{st.title}</b><span>{st.text}</span></li>)}</ol>
      <div className="tiny faint">Next session: {o.session} (Nepal time). Valid until {o.validUntil}. {o.note}</div>
    </div>
  );
}

function Analysis({ a, priceInfo }: { a: ChartAnalysis; priceInfo: Any }) {
  const [open, setOpen] = useState<string | null>(null);
  const p = a.plan;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className={`verdict ${VCLASS[a.verdict]}`}>
        <div className="row between"><span className="v-label">{a.verdict}</span><span className="small">Confidence <strong>{a.confidence}</strong>/100 · {a.confidenceLabel}</span></div>
        <div className="conf"><i style={{ width: `${a.confidence}%` }} /></div>
        <p className="small" style={{ margin: "6px 0 0" }}>{a.headline}</p>
      </div>
      {a.orders && <Orders o={a.orders} />}
      <div className="tiny faint">Analysis of {a.symbol} on the close of {a.asOf ? nptDate(a.asOf) : "—"} · {priceInfo?.kind === "delayed" ? "delayed intraday prices" : "end-of-day prices"} · source: NEPSE prices via ShareSansar, stored statements. {a.dataNotes.join(" ")}</div>
      <div className="plan-grid ai">
        <div><span>Market price</span><strong>{rs(a.price)}</strong><em className={a.changePct != null && a.changePct >= 0 ? "up" : "down"}>{pctS(a.changePct)}</em></div>
        <div><span>Entry range</span><strong>{p.entryLow != null ? `${num(p.entryLow)}–${num(p.entryHigh)}` : "—"}</strong><em>{p.buyNow === "now" ? "in range now" : p.waitFor ? "wait" : ""}</em></div>
        <div><span>Best buying zone</span><strong>{p.bestZone ? `${num(p.bestZone.low)}–${num(p.bestZone.high)}` : "—"}</strong></div>
        <div><span>Breakout entry</span><strong>{p.breakout ? `> ${num(p.breakout.price)}` : "—"}</strong><em>close on volume</em></div>
        <div><span>Stop-loss</span><strong className="down">{p.stop != null ? num(p.stop) : "—"}</strong><em>{p.stop != null && a.price ? pctS(((p.stop - a.price) / a.price) * 100) : ""}</em></div>
        {[0, 1, 2].map((i) => <div key={i}><span>Target {i + 1}</span><strong className="up">{p.targets[i] ? num(p.targets[i].price) : "—"}</strong><em>{p.targets[i] ? pctS(p.targets[i].pct) : ""}</em></div>)}
        <div><span>Risk : reward</span><strong>{p.riskReward ?? "—"}</strong><em>{p.netRiskReward != null ? `${p.netRiskReward} after costs` : ""}</em></div>
        <div><span>Holding period</span><strong>{p.holding ?? "—"}</strong></div>
        <div><span>Review by</span><strong>{p.reviewBy ? nptDate(p.reviewBy) : "—"}</strong></div>
      </div>
      {p.waitFor && <Notice>Wait for {p.waitFor}.</Notice>}
      {p.bestZone && <p className="tiny muted" style={{ margin: 0 }}><strong>Best zone:</strong> {p.bestZone.why} {p.breakout ? <><strong>Breakout:</strong> {p.breakout.why}</> : null} {p.stopWhy ? <><strong>Stop:</strong> {p.stopWhy}</> : null}</p>}
      <p className="tiny faint" style={{ margin: 0 }}>{p.expiry}</p>

      {a.signals && a.signals.length > 0 && <Sec title={`Past buy signals on this chart (${a.signals.length})`}>
        <p className="tiny muted" style={{ margin: "0 0 6px" }}>The same rules run on past prices: B = buy at the next open, S = where it was sold (target, stop or time limit). Shown as arrows on the chart. Results include fees.</p>
        <div className="table-scroll"><table className="t small"><thead><tr><th>Bought</th><th className="num">Price</th><th>Sold</th><th className="num">Price</th><th className="num">Result</th></tr></thead>
          <tbody>{[...a.signals].reverse().slice(0, 12).map((g) => <tr key={g.date}><td>{nptDate(g.entryDate)}</td><td className="num">{num(g.entry)}</td><td>{nptDate(g.exitDate)} <span className="tiny faint">{g.outcome === "target" ? "target" : g.outcome === "stop" ? "stop-loss" : "time limit"}</span></td><td className="num">{num(g.exit)}</td><td className={`num ${g.netPct >= 0 ? "up" : "down"}`}>{pctS(g.netPct)}</td></tr>)}</tbody></table></div>
      </Sec>}
      <Sec title="Why — the evidence">
        {a.reasons.map((r, i) => <div key={i} className="reason">{dot(r.tone)}<div><strong>{r.topic}</strong><span>{r.text}</span></div></div>)}
      </Sec>
      <Sec title="Support & resistance (drawn on the chart)">
        <table className="t small"><tbody>
          {a.levels.map((l, i) => (
            <tr key={i} onClick={() => setOpen(open === `l${i}` ? null : `l${i}`)} style={{ cursor: "pointer" }}>
              <td><span className={`tdot ${l.side === "support" ? "bull" : l.side === "resistance" ? "bear" : "neutral"}`} /> {l.kind}{open === `l${i}` && <div className="tiny muted" style={{ whiteSpace: "normal" }}>{l.why} <em>How: {l.how}</em></div>}</td>
              <td className="num mono">{num(l.price)}</td><td className="num tiny">{a.price ? pctS(((l.price - a.price) / a.price) * 100) : ""}</td>
            </tr>
          ))}
          {a.zones.map((z, i) => <tr key={`z${i}`} onClick={() => setOpen(open === `z${i}` ? null : `z${i}`)} style={{ cursor: "pointer" }}><td><span className={`tdot ${z.kind === "demand" ? "bull" : "bear"}`} /> {z.kind === "demand" ? "Demand" : "Supply"} zone{z.fresh ? " (fresh)" : ""}{open === `z${i}` && <div className="tiny muted" style={{ whiteSpace: "normal" }}>{z.why}</div>}</td><td className="num mono" colSpan={2}>{num(z.low)}–{num(z.high)}</td></tr>)}
        </tbody></table>
        <p className="tiny faint">Tap a row to see why the level matters and how it was found.</p>
      </Sec>
      <Sec title="Strategies by holding period">
        <div className="strat-grid">{a.strategies.map((s) => (
          <div key={s.key} className={`strat ${s.tone}`}>
            <div className="row between"><strong>{s.title}</strong><span className="tiny faint">{s.horizon}</span></div>
            <div className="s-stance">{s.stance}</div>
            {s.available && (s.entryLow != null || s.stop != null) && <div className="tiny mono">{s.entryLow != null ? `Entry ${num(s.entryLow)}–${num(s.entryHigh)}` : ""}{s.stop != null ? ` · Stop ${num(s.stop)}` : ""}{s.targets.length ? ` · T ${s.targets.map((t) => num(t)).join(" / ")}` : ""}{s.netRR != null ? ` · net R:R ${s.netRR}` : ""}</div>}
            <ul className="tiny">{s.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </div>
        ))}</div>
      </Sec>
      <Sec title="Suitability">
        <div className="assess">{([["Short-term trading", a.assessments.short], ["Medium-term (months)", a.assessments.medium], ["Long-term investing", a.assessments.long]] as const).map(([t, s]) => (
          <div key={t}><span className="tiny faint">{t}</span><Badge tone={s.label === "Suitable" ? "up" : s.label === "Not suitable" ? "down" : s.label === "Mixed" ? "warn" : ""}>{s.label}{s.score != null ? ` · ${s.score}` : ""}</Badge><ul className="tiny">{s.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
        ))}</div>
      </Sec>
      {a.events.length > 0 && <Sec title="Recent signals & patterns">{a.events.slice(0, 12).map((e, i) => <div key={i} className="reason">{dot(e.tone)}<div><span className="tiny faint">{e.date}</span><span>{e.text}</span></div></div>)}</Sec>}
      <Sec title="Risks and what would change the view">
        <ul className="small">{a.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
        <div className="small"><strong>Invalidation:</strong><ul>{a.invalidation.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
      </Sec>
      {(a.history || a.setupHistory) && <Sec title="How reliable has this been?">
        {a.history && <p className="small">This stock's past BUY signals (replayed without hindsight, after costs): <strong>{a.history.trades}</strong> trades, <strong>{a.history.winRatePct ?? "—"}%</strong> profitable, average <strong>{pctS(a.history.avgNetPct)}</strong>.</p>}
        {a.setupHistory && a.setupHistory.trades > 0 && <p className="small">This setup type across NEPSE: {a.setupHistory.trades} trades, {a.setupHistory.winRatePct}% profitable, average {pctS(a.setupHistory.avgNetPct)}.</p>}
      </Sec>}
      <p className="tiny faint">Rules-based analysis of stored prices and statements, not a prediction or licensed investment advice. Check the chart yourself and only risk what you can afford to lose.</p>
    </div>
  );
}

function Sec({ title, children }: { title: string; children: React.ReactNode }) { return <section className="ai-sec"><h4>{title}</h4>{children}</section>; }

const SUGGEST = ["Should I buy this stock now?", "Is this a good entry point?", "What is the safest buying zone?", "Where should I put my stop-loss?", "What are the next resistance levels?", "Is this a genuine breakout or a false breakout?", "Is volume confirming the move?", "What happens if the price breaks support?", "Is it better to buy now or wait for a correction?", "Is this stock suitable for long-term investment?", "Compare with previous similar setups", "Explain this chart like I am a beginner", "What would make you change your recommendation?"];
function Ask({ a }: { a: ChartAnalysis }) {
  const [q, setQ] = useState("");
  const [log, setLog] = useState<{ q: string; a: string; src: string; note?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { setLog([]); }, [a.symbol]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [log, busy]);
  const ask = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true); setQ("");
    try {
      const r = await api<{ answer: string; source: string; note?: string }>(`/chart/${a.symbol}/ask`, { body: { question: text, history: log.slice(-3).map((x) => ({ q: x.q, a: x.a.slice(0, 5000) })) } });
      setLog((l) => [...l, { q: text, a: r.answer, src: r.source, note: r.note }]);
    } catch (e) { setLog((l) => [...l, { q: text, a: e instanceof Error ? e.message : String(e), src: "error" }]); }
    setBusy(false);
  };
  return (
    <div className="col" style={{ gap: 10 }}>
      <p className="tiny muted" style={{ margin: 0 }}>Questions are answered about <strong>{a.symbol}</strong> using this chart's computed levels, indicators and patterns (close of {a.asOf}). With your AI key set in Settings, Claude writes the answer from that data; without one, the built-in analyst answers.</p>
      <div className="chips">{SUGGEST.map((s) => <button key={s} className="chip" onClick={() => ask(s)} disabled={busy}>{s}</button>)}</div>
      {log.map((m, i) => (
        <div key={i} className="qa">
          <div className="qa-q">{m.q}</div>
          <div className="qa-a"><Markdown text={m.a} /><div className="tiny faint">{m.src === "ai" ? "Answered by Claude from this chart's analysis" : m.src === "rules" ? "Answered by the built-in chart analyst" : ""}{m.note ? ` · ${m.note}` : ""}</div></div>
        </div>
      ))}
      {busy && <Loading label="Reading the chart" />}
      <div ref={end} />
      <form className="row" onSubmit={(e) => { e.preventDefault(); ask(q); }}><input className="input" style={{ flex: 1 }} placeholder={`Ask about ${a.symbol}'s chart…`} value={q} onChange={(e) => setQ(e.target.value)} maxLength={1000} /><button className="btn primary" disabled={busy || !q.trim()}>Ask</button></form>
    </div>
  );
}

// ---------- trade plans (saved on this device) and paper trades ----------
interface SavedPlan { id: string; symbol: string; created: string; verdict: string; entryLow: number; entryHigh: number; stop: number; targets: number[]; qty: number; paper: boolean; status?: string; result?: number | null }
const PKEY = "ss-trade-plans";
const loadPlans = (): SavedPlan[] => { try { return JSON.parse(localStorage.getItem(PKEY) || "[]"); } catch { return []; } };
export function planStatus(pl: SavedPlan, bars: Bar[]) {
  const after = bars.filter((b) => b.date > pl.created);
  let entry: number | null = null;
  for (const b of after) {
    if (entry == null) { if (b.low <= pl.entryHigh && b.high >= pl.entryLow * 0.97) entry = Math.min(pl.entryHigh, Math.max(b.open, b.low)); else continue; }
    if (b.low <= pl.stop) { const rt = roundTrip(pl.qty || 100, entry, Math.min(b.open, pl.stop), 10); return { status: `Stop-loss hit ${b.date}`, result: rt.netProfit, outcome: "stop" as const, entry }; }
    if (pl.targets[0] && b.high >= pl.targets[0]) { const rt = roundTrip(pl.qty || 100, entry, Math.max(b.open, pl.targets[0]), 10); return { status: `Target 1 hit ${b.date}`, result: rt.netProfit, outcome: "target" as const, entry }; }
  }
  const last = bars[bars.length - 1];
  if (entry == null) return { status: "Waiting for entry", result: null, outcome: "waiting" as const, entry: null };
  return { status: `Open since entry at ${num(entry)}`, result: roundTrip(pl.qty || 100, entry, last.close, 10).netProfit, outcome: "open" as const, entry };
}

function Plan({ a, bars }: { a: ChartAnalysis; bars: Bar[] | null }) {
  const ports = useApi<Any[]>("/portfolios");
  const [qty, setQty] = useState<{ q: number; e: number } | null>(null);
  const [plans, setPlans] = useState<SavedPlan[]>(loadPlans);
  const [msg, setMsg] = useState<{ t: string; warn?: boolean } | null>(null);
  const p = a.plan;
  const entry = p.entryLow != null && p.entryHigh != null ? (p.entryLow + p.entryHigh) / 2 : a.price;
  const save = (x: SavedPlan[]) => { setPlans(x); try { localStorage.setItem(PKEY, JSON.stringify(x)); } catch { /* ignore */ } };
  const tracked = useMemo(() => plans.map((pl) => (pl.symbol === a.symbol && bars ? { ...pl, ...planStatus(pl, bars) } : pl)), [plans, bars, a.symbol]);
  useEffect(() => { if (bars && tracked.some((t, i) => t.status !== plans[i]?.status)) save(tracked.map(({ id, symbol, created, verdict, entryLow, entryHigh, stop, targets, qty: q, paper, status, result }) => ({ id, symbol, created, verdict, entryLow, entryHigh, stop, targets, qty: q, paper, status, result }))); }, [tracked]); // eslint-disable-line react-hooks/exhaustive-deps
  const closed = tracked.filter((t) => /hit/.test(t.status ?? ""));
  const hits = closed.filter((t) => /Target/.test(t.status ?? "")).length;
  const add = (paper: boolean) => {
    if (!entry || p.stop == null) { setMsg({ t: "This analysis has no entry and stop to save. Set them in the planner above or wait for a setup.", warn: true }); return; }
    save([{ id: String(Date.now()), symbol: a.symbol, created: a.asOf ?? todayNpt(), verdict: a.verdict, entryLow: p.entryLow ?? entry, entryHigh: p.entryHigh ?? entry, stop: p.stop, targets: p.targets.map((t) => t.price), qty: qty?.q ?? 0, paper }, ...plans].slice(0, 100));
  };
  const paperTrade = async () => {
    const paper = (ports.data ?? []).find((x: Any) => x.kind === "paper");
    if (!paper || !qty) { setMsg({ t: "No paper-trading portfolio found (create one under My Portfolio).", warn: true }); return; }
    try {
      await api(`/portfolios/${paper.id}/transactions`, { body: { symbol: a.symbol, type: "buy", date: todayNpt(), quantity: qty.q, price: qty.e, notes: `Paper trade from the Chart Terminal AI plan (${a.verdict}); stop ${p.stop ?? "—"}, T1 ${p.targets[0]?.price ?? "—"}` } });
      if (p.stop != null) await api("/alerts", { body: { type: "price_below", symbol: a.symbol, params: { price: p.stop }, note: "Paper trade stop-loss" } });
      if (p.targets[0]) await api("/alerts", { body: { type: "price_above", symbol: a.symbol, params: { price: p.targets[0].price }, note: "Paper trade target 1" } });
      add(true);
      setMsg({ t: `Paper-bought ${qty.q} ${a.symbol} at Rs. ${num(qty.e)} in "${paper.name}", with stop and target alerts. No real money is used.` });
    } catch (e) { setMsg({ t: e instanceof Error ? e.message : String(e), warn: true }); }
  };
  const alerts = async () => {
    try {
      if (p.entryLow != null && p.entryHigh != null) await api("/alerts", { body: { type: "price_in_range", symbol: a.symbol, params: { low: p.entryLow, high: p.entryHigh }, note: "Reached the AI buying range" } });
      if (p.breakout) await api("/alerts", { body: { type: "price_above", symbol: a.symbol, params: { price: p.breakout.price }, note: "Breakout level" } });
      if (p.stop != null) await api("/alerts", { body: { type: "price_below", symbol: a.symbol, params: { price: p.stop }, note: "AI stop-loss" } });
      setMsg({ t: "Alerts set for the buying range, breakout and stop-loss. Manage them under Alerts." });
    } catch (e) { setMsg({ t: e instanceof Error ? e.message : String(e), warn: true }); }
  };
  return (
    <div className="col" style={{ gap: 12 }}>
      <p className="tiny muted" style={{ margin: 0 }}>Pre-filled from the AI plan ({a.verdict}). Enter your capital and maximum risk: the planner sizes the position and shows the net result after broker commission, SEBON fee, DP charge and capital gains tax.</p>
      <TradePlanner key={a.symbol + a.asOf} entry={entry ? Math.round(entry * 100) / 100 : null} stop={p.stop} targets={p.targets.map((t) => t.price)} holdingDays={/week/.test(p.holding ?? "") ? 20 : 60} onQty={(q, e) => setQty({ q, e })} />
      <div className="row wrap">
        <button className="btn primary" onClick={() => add(false)}>Save plan & track it</button>
        <button className="btn" onClick={paperTrade} disabled={!qty}>Paper-trade it</button>
        <button className="btn" onClick={alerts}>Set alerts</button>
      </div>
      {msg && <Notice tone={msg.warn ? "warn" : "info"}>{msg.t}</Notice>}
      <section className="ai-sec"><h4>Saved plans ({plans.length}){closed.length ? ` · ${hits}/${closed.length} hit target 1 first` : ""}</h4>
        {tracked.length === 0 ? <p className="tiny faint">Saved plans are tracked against real prices after the day you save them: entry reached, target or stop hit, and profit or loss after fees.</p> :
          <table className="t small"><thead><tr><th>Stock</th><th>Plan</th><th>Status</th><th className="num">Net P/L</th><th /></tr></thead><tbody>
            {tracked.map((t) => <tr key={t.id}><td><strong>{t.symbol}</strong>{t.paper ? <span className="tiny faint"> paper</span> : null}<div className="tiny faint">{t.created} · {t.verdict}</div></td><td className="tiny mono">{num(t.entryLow)}–{num(t.entryHigh)}<br />SL {num(t.stop)} · T1 {t.targets[0] ? num(t.targets[0]) : "—"}</td><td className="tiny">{t.status ?? "Open the chart to update"}</td><td className={`num ${(t.result ?? 0) >= 0 ? "up" : "down"}`}>{t.result != null ? rs(t.result, 0) : "—"}</td><td><button className="btn ghost sm" onClick={() => save(plans.filter((x) => x.id !== t.id))} title="Delete">✕</button></td></tr>)}
          </tbody></table>}
        <p className="tiny faint">Tracking uses daily highs and lows (first of stop or target 1 to be touched; if both on one day, the stop is assumed). Quantity 0 = shown per 100 shares. Plans are saved on this device.</p>
      </section>
    </div>
  );
}

const CATS: [string, string][] = [["buy", "Best buy setups"], ["near-support", "Near support"], ["near-resistance", "Near resistance"], ["breakout", "Breakout candidates"], ["momentum", "Strong momentum"], ["oversold", "Oversold"], ["overbought", "Overbought"], ["reversal-up", "Bullish reversal"], ["reversal-down", "Bearish reversal"], ["volume-spike", "Volume spikes"], ["golden-cross", "Golden cross"], ["death-cross", "Death cross"]];
function Scanner({ onSymbol, current }: { onSymbol: (s: string) => void; current: string }) {
  const s = useApi<{ asOf: string; rows: Any[] }>("/market/scanner");
  const [cat, setCat] = useState("buy");
  if (s.error) return <Notice tone="warn">{s.error}</Notice>;
  if (!s.data) return <Loading label="Scanning NEPSE" />;
  const rows = s.data.rows.filter((r) => r.tags.includes(cat)).sort((a, b) => b.confidence - a.confidence);
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="chips">{CATS.map(([k, l]) => <button key={k} className={`chip ${cat === k ? "on" : ""}`} onClick={() => setCat(k)}>{l} ({s.data!.rows.filter((r) => r.tags.includes(k)).length})</button>)}</div>
      <p className="tiny faint" style={{ margin: 0 }}>Liquid NEPSE stocks (Rs. 10 lakh+ daily turnover) scanned on the close of {s.data.asOf ? nptDate(s.data.asOf) : "—"}. Tap one to open its chart.</p>
      {rows.length === 0 ? <p className="small muted">No stock in this list today.</p> : rows.map((r) => (
        <button key={r.symbol} className={`scan-row ${r.symbol === current ? "on" : ""}`} onClick={() => onSymbol(r.symbol)}>
          <div className="row between"><span><strong>{r.symbol}</strong> <span className="tiny faint">{r.sector}</span></span><span className="mono small">{num(r.close)} <span className={(r.changePct ?? 0) >= 0 ? "up" : "down"}>{pctS(r.changePct)}</span></span></div>
          <div className="row between tiny"><span className={`vchip ${VCLASS[r.verdict]}`}>{r.verdict}</span><span className="faint">RSI {r.rsi != null ? num(r.rsi, 0) : "—"} · Vol {r.volumeRatio ?? "—"}×</span></div>
          <div className="tiny muted" style={{ textAlign: "left" }}>{r.notes[cat]}</div>
        </button>
      ))}
      <Link className="tiny" to="/signals">Full technical signal board →</Link>
    </div>
  );
}
