import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApi } from "../lib/api.ts";
import { Card, Stat, Loading, ErrorBox, Notice, Badge, Empty, Fresh, Score } from "../components/ui.tsx";
import { num, pct, tone, compact, nptDate, int } from "../lib/format.ts";

interface Briefing {
  date: string | null;
  market: { nepse: { close: number; change: number; changePct: number } | null; breadth: { advancers: number; decliners: number; unchanged: number; traded: number }; turnover: number; trend: { label: string; notes: string[] } | null; sentiment: { label: string; breadthRatio: number; method: string } | null; topSectors: { sector: string; avgChange: number }[]; weakSectors: { sector: string; avgChange: number }[]; gainers: Mover[]; losers: Mover[] };
  attention: { symbol: string; changePct: number; close: number; held: boolean }[];
  mySetups: SetupRow[]; topSetups: SetupRow[]; warnings: SetupRow[];
  reports: { symbol: string; title: string; url: string; published_date: string }[];
  myNews: { symbol: string; title: string; url: string; published_date: string; category: string }[];
  portfolios: { id: number; name: string; kind: string; marketValue: number; dayChange: number; movers: { symbol: string; changePct: number; impact: number }[]; healthScore: number | null; issues: string[] }[];
  opportunities: { title: string; url: string; published_date: string; category: string }[];
  unreadAlerts: number;
}
interface Mover { symbol: string; name: string; changePct: number; close: number }
interface SetupRow { symbol: string; name?: string; type: string; side: string; price: number; entryLow: number; entryHigh: number; stopLoss: number; targets: number[]; riskReward: number; quality: number }

const SECTION_LABELS: Record<string, string> = { stats: "Key numbers (index, breadth, turnover, trend)", market: "What happened in NEPSE + my portfolio", attention: "Stocks that deserve attention + setups", reports: "Reports, news on my stocks, opportunities" };
const DEFAULT_LAYOUT = Object.keys(SECTION_LABELS).map((key) => ({ key, on: true }));

function loadLayout() {
  try {
    const l = JSON.parse(localStorage.getItem("ss-overview-layout") || "null") as { key: string; on: boolean }[] | null;
    if (l && l.length === DEFAULT_LAYOUT.length && l.every((x) => SECTION_LABELS[x.key])) return l;
  } catch { /* ignore */ }
  return DEFAULT_LAYOUT;
}

export default function Overview() {
  const { data: b, error, loading, reload } = useApi<Briefing>("/briefing");
  const [layout, setLayout] = useState(loadLayout);
  const [editing, setEditing] = useState(false);
  const save = (l: { key: string; on: boolean }[]) => { setLayout(l); try { localStorage.setItem("ss-overview-layout", JSON.stringify(l)); } catch { /* ignore */ } };
  const status = useApi<{ freshness: { dataset: string; as_of: string; last_success_at: string }[]; jobs: { name: string; status: string; message: string }[]; counts: { priceRows: number } }>("/data/status");
  const nav = useNavigate();
  if (loading && !b) return <Loading label="Preparing your briefing" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!b) return null;
  const running = status.data?.jobs.filter((j) => j.status === "running" || j.status === "queued") ?? [];
  const latest = status.data?.freshness.find((f) => f.dataset === "prices_latest");
  const m = b.market;
  const sections: Record<string, React.ReactNode> = {
    stats: (
      <>
      <div className="grid g4">
        <Stat label="NEPSE Index" value={num(m.nepse?.close)} sub={<span className={tone(m.nepse?.changePct)}>{num(m.nepse?.change)} ({pct(m.nepse?.changePct)})</span>} />
        <Stat label="Breadth" value={<><span className="up">{m.breadth.advancers}</span> / <span className="down">{m.breadth.decliners}</span></>} sub={m.sentiment ? `${m.sentiment.label} · ${m.breadth.unchanged} unchanged` : "—"} />
        <Stat label="Turnover" value={compact(m.turnover)} sub={`${int(m.breadth.traded)} scrips traded`} />
        <Stat label="Market trend" value={<span style={{ fontSize: 17 }}>{m.trend?.label ?? "—"}</span>} sub={m.trend?.notes[0] ?? "Needs index history"} />
      </div>
      </>
    ),
    market: (
      <>
      <div className="grid g3">
        <Card title="1 · What happened in NEPSE" className="span2">
          <div className="grid g2">
            <div>
              <div className="small faint" style={{ marginBottom: 6 }}>Top gainers</div>
              {m.gainers.map((g) => <MoverRow key={g.symbol} m={g} />)}
            </div>
            <div>
              <div className="small faint" style={{ marginBottom: 6 }}>Top losers</div>
              {m.losers.map((g) => <MoverRow key={g.symbol} m={g} />)}
            </div>
          </div>
          <div className="sep" />
          <div className="row small">
            <span className="faint">Strongest sectors:</span>{m.topSectors.map((s) => <Badge key={s.sector} tone="up">{s.sector} {pct(s.avgChange)}</Badge>)}
            <span className="faint" style={{ marginLeft: 8 }}>Weakest:</span>{m.weakSectors.map((s) => <Badge key={s.sector} tone="down">{s.sector} {pct(s.avgChange)}</Badge>)}
          </div>
          {m.trend && <p className="small muted" style={{ marginTop: 8 }}>{m.trend.notes.join(" ")}</p>}
        </Card>
        <Card title="5 · What changed in my portfolio" actions={<Link to="/portfolio" className="small">Open</Link>}>
          {b.portfolios.length === 0 ? <Empty title="No portfolios yet"><Link to="/portfolio">Create one</Link></Empty> : b.portfolios.map((p) => (
            <div key={p.id} style={{ marginBottom: 12 }}>
              <div className="row between"><strong>{p.name}</strong>{p.kind === "paper" && <Badge tone="blue">Paper</Badge>}</div>
              <div className="row between small"><span className="muted">Value {compact(p.marketValue)}</span><span className={tone(p.dayChange)}>Today {p.dayChange >= 0 ? "+" : ""}{compact(p.dayChange)}</span></div>
              {p.movers.length > 0 && <div className="tiny muted">{p.movers.map((x) => `${x.symbol} ${pct(x.changePct, 1)}`).join(" · ")}</div>}
              {p.issues.length > 0 && <div className="tiny warn" style={{ marginTop: 4 }}>⚠ {p.issues[0]}</div>}
            </div>
          ))}
        </Card>
      </div>
      </>
    ),
    attention: (
      <>
      <div className="grid g2">
        <Card title="2 · Stocks that deserve attention" sub="Your watchlist and holdings with the biggest moves">
          {b.attention.length === 0 ? <Empty title="Nothing to flag">Add stocks to your <Link to="/watchlist">watchlist</Link> to see them here.</Empty> : (
            <table className="t"><tbody>{b.attention.map((a) => (
              <tr key={a.symbol} className="click" onClick={() => nav(`/stocks/${a.symbol}`)}>
                <td className="sym">{a.symbol} {a.held && <Badge tone="accent">Held</Badge>}</td><td className="num">{num(a.close)}</td><td className={`num ${tone(a.changePct)}`}>{pct(a.changePct)}</td>
              </tr>))}</tbody></table>
          )}
          {b.warnings.length > 0 && <div style={{ marginTop: 10 }}>{b.warnings.map((w) => <Notice key={w.symbol} tone="warn"><Link to={`/stocks/${w.symbol}`}>{w.symbol}</Link> (held): {w.type}</Notice>)}</div>}
        </Card>
        <Card title="3 · Technical setups developing" actions={<Link to="/technical" className="small">All setups</Link>} sub="Rule-based; check each before acting">
          <SetupTable rows={[...b.mySetups, ...b.topSetups.filter((s) => !b.mySetups.some((x) => x.symbol === s.symbol))].slice(0, 8)} />
        </Card>
      </div>
      </>
    ),
    reports: (
      <>
      <div className="grid g3">
        <Card title="4 · Companies that published reports" sub="Last 3 days">
          {b.reports.length === 0 ? <Empty title="No new quarterly reports" /> : <div className="list">{b.reports.map((r) => <NewsRow key={r.url} r={r} />)}</div>}
        </Card>
        <Card title="News on your stocks">
          {b.myNews.length === 0 ? <Empty title="No recent announcements" /> : <div className="list">{b.myNews.map((r) => <NewsRow key={r.url} r={r} />)}</div>}
        </Card>
        <Card title="6 · Opportunities to investigate" actions={<Link to="/opportunities" className="small">Directory</Link>}>
          {b.opportunities.length === 0 ? <Empty title="No new IPO/FPO/debenture notices in 10 days" /> : <div className="list">{b.opportunities.map((r) => <NewsRow key={r.url} r={r} />)}</div>}
        </Card>
      </div>
      </>
    ),
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Good {greeting()}. Here is your market briefing.</h1>
          <p>{b.date ? <>NEPSE data for <strong>{nptDate(b.date)}</strong>.</> : "No market data yet."} <Fresh date={latest?.as_of} fetched={latest?.last_success_at} source="ShareSansar / nepse-data" /></p>
        </div>
        <div className="row"><button className="btn" onClick={() => setEditing(!editing)}>Customize</button><Link className="btn" to="/analyst">Ask the AI analyst</Link></div>
      </div>
      {running.length > 0 && <Notice>Data refresh in progress: {running.map((j) => `${j.name} (${j.message})`).join(" · ")}. Pages fill in as data arrives.</Notice>}
      {!b.date && <Notice tone="warn">No market data has been loaded yet. Go to <Link to="/settings">Settings → Data</Link> and run a refresh.</Notice>}

      {editing && (
        <Card title="Customize dashboard" actions={<button className="btn sm primary" onClick={() => setEditing(false)}>Done</button>}>
          {layout.map((x, i) => (
            <div key={x.key} className="row" style={{ padding: "4px 0" }}>
              <label className="chk" style={{ flex: 1 }}><input type="checkbox" checked={x.on} onChange={(e) => save(layout.map((y) => (y.key === x.key ? { ...y, on: e.target.checked } : y)))} />{SECTION_LABELS[x.key]}</label>
              <button className="btn ghost sm" disabled={i === 0} onClick={() => { const l = [...layout]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; save(l); }} aria-label="Move up">↑</button>
              <button className="btn ghost sm" disabled={i === layout.length - 1} onClick={() => { const l = [...layout]; [l[i + 1], l[i]] = [l[i], l[i + 1]]; save(l); }} aria-label="Move down">↓</button>
            </div>
          ))}
          <button className="btn sm" onClick={() => save(DEFAULT_LAYOUT)}>Reset</button>
        </Card>
      )}
      {layout.filter((x) => x.on).map((x) => <div key={x.key} style={{ display: "contents" }}>{sections[x.key]}</div>)}
      {b.unreadAlerts > 0 && <Notice><Link to="/alerts">{b.unreadAlerts} unread alert{b.unreadAlerts > 1 ? "s" : ""}</Link></Notice>}
    </div>
  );
}

function greeting() {
  const h = Number(new Date().toLocaleString("en-GB", { timeZone: "Asia/Kathmandu", hour: "2-digit", hour12: false }));
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

function MoverRow({ m }: { m: Mover }) {
  return (
    <Link to={`/stocks/${m.symbol}`} className="row between" style={{ padding: "4px 0", color: "inherit", textDecoration: "none" }}>
      <span className="mono" style={{ fontWeight: 600 }}>{m.symbol}</span>
      <span className="row"><span className="mono small muted">{num(m.close)}</span><span className={`mono small ${tone(m.changePct)}`} style={{ minWidth: 64, textAlign: "right" }}>{pct(m.changePct)}</span></span>
    </Link>
  );
}

export function SetupTable({ rows, onSelect }: { rows: SetupRow[]; onSelect?: (s: SetupRow) => void }) {
  const nav = useNavigate();
  if (!rows.length) return <Empty title="No active setups">Setups appear when rules (breakout, pullback, momentum…) trigger on liquid stocks.</Empty>;
  return (
    <div className="table-wrap"><table className="t">
      <thead><tr><th>Stock</th><th>Setup</th><th className="num">Entry</th><th className="num">Stop</th><th className="num">T1</th><th className="num">R:R</th><th className="num">Quality</th></tr></thead>
      <tbody>{rows.map((s, i) => (
        <tr key={s.symbol + s.type + i} className="click" onClick={() => (onSelect ? onSelect(s) : nav(`/stocks/${s.symbol}`))}>
          <td className="sym">{s.symbol}</td><td><Badge tone={s.side === "buy" ? "up" : "down"}>{s.type}</Badge></td>
          <td className="num">{num(s.entryLow)}–{num(s.entryHigh)}</td><td className="num">{num(s.stopLoss)}</td><td className="num">{num(s.targets[0])}</td>
          <td className="num">{s.side === "buy" ? num(s.riskReward) : "—"}</td><td className="num"><Score value={s.quality} /></td>
        </tr>))}</tbody>
    </table></div>
  );
}

export function NewsRow({ r }: { r: { symbol?: string | null; title: string; url: string; published_date: string; category?: string } }) {
  return (
    <div className="list-item" style={{ padding: "8px 0" }}>
      <div style={{ flex: 1 }}>
        <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text)" }}>{r.title}</a>
        <div className="tiny faint">{r.symbol && <Link to={`/stocks/${r.symbol}`}>{r.symbol}</Link>} {r.category && `· ${r.category}`} · {nptDate(r.published_date)}</div>
      </div>
    </div>
  );
}
