// Discover: the NEPSE Market Mood (fear & greed gauge) and ready-made stock baskets.
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { Card, Tabs, Badge, Loading, ErrorBox, Notice } from "../components/ui.tsx";
import { num, nptDate, pct, tone } from "../lib/format.ts";
import { moodLabel, moodAdvice } from "../../../shared/discover.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export default function Discover() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as "mood" | "baskets") || "mood";
  return (
    <div className="page">
      <div className="page-head"><div><h1>Discover</h1><p className="muted">How the whole market feels today, and ready-made baskets of stocks built from clear rules.</p></div></div>
      <Tabs value={tab} onChange={(t) => setSp({ tab: t })} tabs={[{ key: "mood", label: "Market mood" }, { key: "baskets", label: "Stock baskets" }]} />
      {tab === "mood" ? <Mood /> : <Baskets />}
    </div>
  );
}

export function MoodGauge({ score, size = 220 }: { score: number; size?: number }) {
  const r = size * 0.4, cx = size / 2, cy = size * 0.52, a = Math.PI * (1 - score / 100);
  const arc = (from: number, to: number) => { const p = (t: number) => [cx + r * Math.cos(Math.PI * (1 - t / 100)), cy - r * Math.sin(Math.PI * (1 - t / 100))]; const [x1, y1] = p(from), [x2, y2] = p(to); return `M${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2}`; };
  const segs: [number, number, string][] = [[0, 25, "#dc2626"], [25, 45, "#f97316"], [45, 55, "#a3a3a3"], [55, 75, "#84cc16"], [75, 100, "#16a34a"]];
  return (
    <svg viewBox={`0 0 ${size} ${size * 0.62}`} width="100%" style={{ maxWidth: size }} role="img" aria-label={`Market mood ${score}: ${moodLabel(score)}`}>
      {segs.map(([f, t, c]) => <path key={f} d={arc(f + 0.6, t - 0.6)} stroke={c} strokeWidth={size * 0.07} fill="none" strokeLinecap="butt" />)}
      <line x1={cx} y1={cy} x2={cx + r * 0.92 * Math.cos(a)} y2={cy - r * 0.92 * Math.sin(a)} stroke="var(--text)" strokeWidth={3} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={5} fill="var(--text)" />
      <text x={cx} y={cy + size * 0.09} textAnchor="middle" fontSize={size * 0.11} fontWeight={800} fill="var(--text)">{score}</text>
    </svg>
  );
}

function Mood() {
  const m = useApi<Any>("/market/mood");
  if (m.error) return <ErrorBox error={m.error} onRetry={m.reload} />;
  if (m.data === null && !m.loading) return <Notice>Not enough price history to measure the market mood.</Notice>;
  if (!m.data) return <Loading label="Reading the market" />;
  const d = m.data, h: [string, number][] = d.history;
  const W = 600, H = 120, pts = h.map(([, s], i) => `${(i / Math.max(1, h.length - 1)) * W},${H - (s / 100) * H}`).join(" ");
  return (
    <div className="col">
      <div className="grid g2">
        <Card title="NEPSE Market Mood" sub={`Fear & greed, 0-100, close of ${nptDate(d.asOf)}`}>
          <div className="mood-top">
            <MoodGauge score={d.score} />
            <div className="mood-txt">
              <b className={`mood-l s${d.score < 25 ? 0 : d.score < 45 ? 1 : d.score <= 55 ? 2 : d.score <= 75 ? 3 : 4}`}>{moodLabel(d.score)}</b>
              <span className="small muted">A week ago: <b>{d.weekAgo ?? "-"}</b>, a month ago: <b>{d.monthAgo ?? "-"}</b></span>
              <p className="small" style={{ margin: "6px 0 0" }}>{moodAdvice(d.score)}</p>
            </div>
          </div>
        </Card>
        <Card title="What the mood is made of" sub="Each reading scaled 0 (fear) to 100 (greed)">
          {d.parts.map((p: Any) => (
            <div key={p.key} className="mood-part">
              <div className="row between small" style={{ flexWrap: "nowrap" }}><span>{p.label}</span><b>{p.value == null ? "-" : p.key === "volume" ? `${num(p.value, 2)}x` : p.key === "momentum" ? pct(p.value) : p.key === "rsi" ? num(p.value, 1) : `${num(p.value, 0)}%`}</b></div>
              <div className="mood-bar"><i style={{ width: `${p.score ?? 0}%`, background: (p.score ?? 50) < 45 ? "#f97316" : (p.score ?? 50) > 55 ? "#16a34a" : "#a3a3a3" }} /></div>
            </div>
          ))}
        </Card>
      </div>
      <Card title="Mood over the last months">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }}>
          <rect x={0} y={0} width={W} height={H * 0.25} fill="#16a34a" opacity={0.08} /><rect x={0} y={H * 0.75} width={W} height={H * 0.25} fill="#dc2626" opacity={0.08} />
          <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="var(--border)" strokeDasharray="4 4" />
          <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="row between tiny faint"><span>{h[0] ? nptDate(h[0][0]) : ""}</span><span>green band = greed, red band = fear</span><span>{h.length ? nptDate(h[h.length - 1][0]) : ""}</span></div>
      </Card>
      <p className="tiny faint">Built from all listed company shares (no mutual funds or debentures) and the NEPSE index: share of rising stocks over 10 days, stocks above their 50-day average, new 52-week highs vs lows, NEPSE against its 125-day average, turnover against its 3-month average, and NEPSE's RSI. A guide to crowd emotion, not a prediction.</p>
    </div>
  );
}

function Baskets() {
  const b = useApi<Any>("/baskets");
  const wl = useApi<Any[]>("/watchlists");
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (b.error) return <ErrorBox error={b.error} onRetry={b.reload} />;
  if (!b.data) return <Loading label="Building baskets" />;
  const d = b.data;
  const addAll = async (bk: Any) => {
    const list = (wl.data ?? [])[0]; if (!list) { setMsg("Create a watchlist first (Watchlist page)."); return; }
    for (const m of bk.members) { try { await api(`/watchlists/${list.id}/items`, { body: { symbol: m.symbol } }); } catch { /* already there */ } }
    setMsg(`Added ${bk.members.length} stocks from "${bk.name}" to ${list.name}.`); wl.reload?.();
  };
  return (
    <div className="col">
      <p className="small muted" style={{ margin: 0 }}>Each basket is a rule applied to every liquid NEPSE stock (Rs. 10 lakh+ daily turnover, few red flags). Members update with each day's data. NEPSE: {pct(d.nepse.m3)} in 3 months, {pct(d.nepse.y1)} in a year.</p>
      {msg && <Notice>{msg}</Notice>}
      <div className="bk-grid">{d.baskets.filter((x: Any) => x.members.length).map((bk: Any) => (
        <div key={bk.key} className="bk">
          <div className="row between" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}><b>{bk.name}</b><Badge tone={bk.risk === "Low" ? "up" : bk.risk === "High" ? "down" : "warn"}>{bk.risk} risk</Badge></div>
          <p className="small muted" style={{ margin: 0 }}>{bk.idea}</p>
          <div className="bk-kv"><span>3 months <b className={tone(bk.m3)}>{pct(bk.m3)}</b></span><span>1 year <b className={tone(bk.y1)}>{pct(bk.y1)}</b></span><span>vs NEPSE <b className={tone(bk.y1 != null && d.nepse.y1 != null ? bk.y1 - d.nepse.y1 : null)}>{bk.y1 != null && d.nepse.y1 != null ? pct(bk.y1 - d.nepse.y1) : "-"}</b></span><span>Stocks <b>{bk.members.length}</b></span></div>
          <div className="tiny faint">For: {bk.who}</div>
          <div className="bk-chips">{bk.members.map((m: Any) => <Link key={m.symbol} to={`/terminal/${m.symbol}`} className="chip">{m.symbol}</Link>)}</div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => setOpen(open === bk.key ? null : bk.key)}>{open === bk.key ? "Hide details" : "Details"}</button>
            <button className="btn sm ghost" onClick={() => addAll(bk)}>Add all to watchlist</button>
          </div>
          {open === bk.key && <div className="table-scroll"><table className="t small"><thead><tr><th>Stock</th><th className="num">Price</th><th className="num">P/E</th><th className="num">Div. yield</th><th className="num">Fund.</th><th className="num">Tech.</th><th className="num">1 yr</th></tr></thead>
            <tbody>{bk.members.map((m: Any) => <tr key={m.symbol}><td><Link className="mono" to={`/stocks/${m.symbol}`}>{m.symbol}</Link><div className="tiny faint">{m.sector}</div></td><td className="num">{num(m.price)}</td><td className="num">{m.pe != null ? num(m.pe, 1) : "-"}</td><td className="num">{m.cashYield != null ? `${num(m.cashYield, 1)}%` : "-"}</td><td className="num">{m.fundamentalScore ?? "-"}</td><td className="num">{m.technicalScore ?? "-"}</td><td className={`num ${tone(m.return1y)}`}>{pct(m.return1y)}</td></tr>)}</tbody></table></div>}
        </div>
      ))}</div>
      <p className="tiny faint">Past returns use today's members held equally over the period (price only, no dividends). Because members are chosen with today's data, past returns look better than a real basket would have done. Use baskets as a shortlist, then check each stock's signal.</p>
    </div>
  );
}
