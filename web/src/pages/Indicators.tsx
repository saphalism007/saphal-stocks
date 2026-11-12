// Indicator Guide: every indicator in the chart library explained to the point (origin, what it shows,
// how to read it, buy and sell signals, best use, the common trap, a tip), with a live reading and a
// mini chart on a real stock, an all-indicator consensus for that stock, and one tap to add it to the chart.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api.ts";
import { Badge, Card, Notice } from "../components/ui.tsx";
import { INDICATORS, INDICATOR_MAP, type Group, type IndicatorDef } from "../../../shared/ta.ts";
import { GUIDE, interpret, type Reading } from "../../../shared/indicatorGuide.ts";
import type { Bar } from "../../../shared/types.ts";

const START = ["sma", "ema", "rsi", "macd", "bb", "volume", "atr", "adx", "supertrend", "obv"];
const GROUPS: (Group | "All" | "Start here")[] = ["Start here", "All", "Moving averages", "Trend", "Momentum", "Volatility", "Volume"];
const toneCls = (t: Reading["tone"]) => (t === "bull" ? "up" : t === "bear" ? "down" : "");
const toneWord = (t: Reading["tone"]) => (t === "bull" ? "Bullish" : t === "bear" ? "Bearish" : "Neutral");

function defaults(d: IndicatorDef) { return Object.fromEntries(d.params.map((p) => [p.key, p.def])); }

function Mini({ def, bars, vals }: { def: IndicatorDef; bars: Bar[]; vals: Record<string, (number | null)[]> }) {
  const N = Math.min(120, bars.length), W = 320, H = 90, s0 = bars.length - N;
  const series: { pts: (number | null)[]; color: string; kind?: string }[] = def.outputs.map((o) => ({ pts: (vals[o.key] ?? []).slice(s0), color: o.color, kind: o.kind }));
  if (def.overlay) series.unshift({ pts: bars.slice(s0).map((b) => b.close), color: "var(--text-3)" });
  const all = series.flatMap((s) => s.pts).filter((v): v is number => v != null && Number.isFinite(v));
  if (!def.overlay) all.push(...(def.levels ?? []));
  if (all.length < 2) return <div className="tiny faint">Not enough history to draw.</div>;
  let lo = Math.min(...all), hi = Math.max(...all); if (hi === lo) { hi += 1; lo -= 1; }
  const x = (i: number) => (i / Math.max(1, N - 1)) * W, y = (v: number) => H - 4 - ((v - lo) / (hi - lo)) * (H - 8);
  return (
    <svg className="ig-mini" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${def.name} on the last ${N} sessions`}>
      {!def.overlay && (def.levels ?? []).map((l) => <line key={l} x1={0} x2={W} y1={y(l)} y2={y(l)} stroke="var(--border)" strokeDasharray="3 3" />)}
      {series.map((s, k) => s.kind === "dots" ? <g key={k}>{s.pts.map((v, i) => v == null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={1.6} fill={s.color} />)}</g> : s.kind === "histogram"
        ? <g key={k}>{s.pts.map((v, i) => v == null ? null : <rect key={i} x={x(i) - 1} width={2} y={Math.min(y(v), y(Math.max(lo, Math.min(hi, 0))))} height={Math.abs(y(v) - y(Math.max(lo, Math.min(hi, 0))))} fill={v >= 0 ? "#22c55e" : "#ef4444"} opacity={0.6} />)}</g>
        : <path key={k} fill="none" stroke={s.color} strokeWidth={k === 0 && def.overlay ? 1 : 1.5} d={s.pts.reduce((d, v, i) => (v == null || !Number.isFinite(v) ? d : d + `${d && s.pts[i - 1] != null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`), "")} />)}
    </svg>
  );
}

export default function Indicators() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<(typeof GROUPS)[number]>(params.get("id") ? "All" : "Start here");
  const [open, setOpen] = useState<string | null>(params.get("id"));
  const [sym, setSym] = useState(() => { try { return (localStorage.getItem("ss-terminal-symbol") || "NABIL").toUpperCase(); } catch { return "NABIL"; } });
  const [symIn, setSymIn] = useState(sym);
  const [bars, setBars] = useState<Bar[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { let live = true; setErr(null); api<{ bars: Bar[] }>(`/stocks/${sym}/bars`).then((r) => live && setBars(r.bars)).catch((e) => live && (setBars([]), setErr(String(e?.message ?? e)))); return () => { live = false; }; }, [sym]);
  const [jump, setJump] = useState<string | null>(params.get("id"));
  useEffect(() => { const id = params.get("id"); if (id && INDICATOR_MAP.has(id) && id !== open) { setOpen(id); setJump(id); } }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute every indicator once per stock for the consensus and the live readings.
  const results = useMemo(() => {
    const m = new Map<string, { vals: Record<string, (number | null)[]>; r: Reading }>();
    if (!bars || bars.length < 30) return m;
    const close = bars[bars.length - 1].close;
    for (const d of INDICATORS) { try { const vals = d.compute(bars, defaults(d)); m.set(d.id, { vals, r: interpret(d, vals, close) }); } catch { /* skip */ } }
    return m;
  }, [bars]);
  const tally = useMemo(() => {
    const t: Record<string, { bull: number; bear: number; neutral: number }> = {};
    for (const d of INDICATORS) { const r = results.get(d.id)?.r; if (!r || r.text.startsWith("Not enough")) continue; for (const g of [d.group, "All"]) { t[g] ??= { bull: 0, bear: 0, neutral: 0 }; t[g][r.tone]++; } }
    return t;
  }, [results]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return INDICATORS.filter((d) => {
      if (s) { const g = GUIDE[d.id]; return `${d.name} ${d.short} ${d.desc} ${g?.origin} ${g?.what} ${g?.best}`.toLowerCase().includes(s); }
      return group === "All" ? true : group === "Start here" ? START.includes(d.id) : d.group === group;
    }).sort((a, b) => (group === "Start here" && !s ? START.indexOf(a.id) - START.indexOf(b.id) : 0));
  }, [q, group]);

  // Scroll to a linked indicator once the live data has rendered (it changes the page height).
  useEffect(() => { if (!jump || bars === null) return; const t = setTimeout(() => { document.getElementById(`ig-${jump}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); setJump(null); }, 120); return () => clearTimeout(t); }, [jump, bars]);
  const toggle = (id: string) => { const next = open === id ? null : id; setOpen(next); const p = new URLSearchParams(params); if (next) p.set("id", next); else p.delete("id"); setParams(p, { replace: true }); };
  const all = tally.All;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Indicator Guide</h1><p className="muted small">{INDICATORS.length} indicators from the USA, Japan, Australia, France and more. Each one in plain words: how to read it, when to buy, when to sell, and the trap to avoid. Live readings use real prices.</p></div>
      </div>

      <Card title="Live on a real stock" sub="Every reading below uses this stock's daily prices.">
        <form className="row" style={{ gap: 8, flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); const v = symIn.trim().toUpperCase(); if (v) { setBars(null); setSym(v); } }}>
          <input className="input" style={{ width: 140 }} value={symIn} onChange={(e) => setSymIn(e.target.value.toUpperCase())} aria-label="Stock symbol" />
          <button className="btn">Use this stock</button>
          <Link className="btn ghost" to={`/terminal/${sym}`}>Open {sym} chart</Link>
        </form>
        {err && <Notice tone="warn">Data unavailable for {sym}: {err}</Notice>}
        {bars && bars.length > 0 && <p className="tiny faint" style={{ margin: "6px 0 0" }}>Last updated: {bars[bars.length - 1].date}, close Rs. {bars[bars.length - 1].close.toLocaleString("en-IN")}</p>}
        {all && (
          <div className="ig-consensus">
            <div className="ig-bar" aria-label="Indicator consensus">
              <span className="up-bg" style={{ flex: all.bull }} /><span className="neutral-bg" style={{ flex: all.neutral }} /><span className="down-bg" style={{ flex: all.bear }} />
            </div>
            <div className="row between small"><span className="up">{all.bull} bullish</span><span className="muted">{all.neutral} neutral</span><span className="down">{all.bear} bearish</span></div>
            <div className="ig-groups">{(["Moving averages", "Trend", "Momentum", "Volatility", "Volume"] as Group[]).map((g) => { const t = tally[g]; if (!t) return null; const lead = t.bull > t.bear ? "bull" : t.bear > t.bull ? "bear" : "neutral"; return <button key={g} className={`chip ${group === g ? "on" : ""}`} onClick={() => { setQ(""); setGroup(g); }}>{g}: <span className={toneCls(lead)}>{t.bull} up / {t.bear} down</span></button>; })}</div>
            <p className="tiny faint" style={{ margin: 0 }}>A headcount of signals, not advice. Many indicators measure the same thing, so agreement is weaker evidence than it looks. Volatility tools are mostly neutral by design.</p>
          </div>
        )}
      </Card>

      <div className="ig-filter">
        <input className="input" placeholder={`Search ${INDICATORS.length} indicators, e.g. RSI, Japan, volume, stop loss`} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips">{GROUPS.map((g) => <button key={g} className={`chip ${!q && group === g ? "on" : ""}`} onClick={() => { setQ(""); setGroup(g); }}>{g}{g === "Start here" ? " (10)" : ""}</button>)}</div>
      </div>
      {group === "Start here" && !q && <p className="small muted" style={{ margin: "0 0 8px" }}>New to indicators? Learn these 10 first, in this order. Together they cover trend, momentum, volatility and volume.</p>}

      <div className="ig-list">
        {list.map((d, i) => {
          const g = GUIDE[d.id]; const res = results.get(d.id); const on = open === d.id;
          return (
            <div key={d.id} id={`ig-${d.id}`} className={`ig-item ${on ? "on" : ""}`}>
              <button className="ig-head" onClick={() => toggle(d.id)} aria-expanded={on}>
                <span className="ig-title">{group === "Start here" && !q && <span className="ig-num">{i + 1}</span>}<strong>{d.name}</strong> <span className="tiny faint">{d.short}</span></span>
                <span className="row" style={{ gap: 6 }}>{res && !res.r.text.startsWith("Not enough") && <span className={`tiny ${toneCls(res.r.tone)}`}>{toneWord(res.r.tone)}</span>}<Badge>{d.group}</Badge><span className="ig-chev">{on ? "▴" : "▾"}</span></span>
              </button>
              {!on && <p className="tiny muted ig-what">{g?.what}</p>}
              {on && g && (
                <div className="ig-body">
                  <p className="ig-what-big">{g.what}</p>
                  {res && bars && (
                    <div className={`ig-live ${toneCls(res.r.tone)}`}>
                      <div className="tiny faint">{sym} now ({bars[bars.length - 1].date})</div>
                      <div>{res.r.text}</div>
                      <Mini def={d} bars={bars} vals={res.vals} />
                    </div>
                  )}
                  <dl className="ig-dl">
                    <dt>How to read</dt><dd>{g.read}</dd>
                    <dt className="up">Buy signal</dt><dd>{g.buy}</dd>
                    <dt className="down">Sell signal</dt><dd>{g.sell}</dd>
                    <dt>Works best for</dt><dd>{g.best}</dd>
                    <dt className="warn-t">Common trap</dt><dd>{g.trap}</dd>
                    <dt>Tip</dt><dd>{g.tip}</dd>
                    {d.params.length > 0 && <><dt>Default settings</dt><dd>{d.params.map((p) => `${p.label} ${p.def}`).join(", ")}</dd></>}
                    <dt>Shown</dt><dd>{d.overlay ? "On the price chart" : "In its own panel under the chart"}</dd>
                    <dt>Origin</dt><dd>{g.origin}</dd>
                  </dl>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <Link className="btn primary" to={`/terminal/${sym}?add=${d.id}`}>Add to {sym} chart</Link>
                    <button className="btn ghost" onClick={() => { const n = list[i + 1]; if (n) toggle(n.id); }} disabled={!list[i + 1]}>Next indicator</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {list.length === 0 && <p className="small muted">No indicator matches '{q}'.</p>}
      </div>
      <p className="tiny faint">Education only, not investment advice. No indicator is right every time; combine trend, momentum and volume, and always use a stop-loss.</p>
    </div>
  );
}
