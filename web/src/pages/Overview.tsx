import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApi } from "../lib/api.ts";
import { Card, Stat, Loading, ErrorBox, Notice, Badge, Empty, Fresh, Score } from "../components/ui.tsx";
import { num, pct, tone, compact, nptDate, int } from "../lib/format.ts";
import { I } from "../components/icons.tsx";

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
  rates?: { changes: { label: string; value: number; prev: number | null; asOf: string; url: string }[]; noticeCount: number; notices: { symbol: string | null; institution: string; published: string; url: string; image_url: string | null }[]; bestDeposit: { institution: string; ratePct: number; netAnnualPct: number; method?: string | null; sourceUrl?: string | null } | null; inflationPct: number | null; fdPct: number | null; fdSource?: string };
  openIssues?: { company: string; symbol: string | null; issue_type: string; final_date: string | null; closing_date: string | null }[];
  money?: { saved: boolean; netWorth: number; cashFlow: number; savingsRatePct: number | null; emergencyGap: number; advice: { priority: number; title: string; detail: string; yearlyImpact?: number }[] };
  action?: { title: string; detail: string; link: string };
}
interface Mover { symbol: string; name: string; changePct: number; close: number }
interface SetupRow { symbol: string; name?: string; type: string; side: string; price: number; entryLow: number; entryHigh: number; stopLoss: number; targets: number[]; riskReward: number; quality: number }

const SECTION_LABELS: Record<string, string> = { pillars: "NEPSE Intelligence and My Financial Life shortcuts", today: "8 · Smartest action today", stats: "Key numbers (index, breadth, turnover, trend)", market: "What happened in NEPSE + my portfolio", attention: "Stocks that deserve attention + setups", reports: "Reports, news on my stocks, opportunities", money: "Bank rates, opportunities and my money" };
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
    pillars: (
      <div className="pillars">
        <div className="pillar">
          <h2>NEPSE Intelligence</h2><div className="small muted">Market, charts, analysis, AI trading assistant and your portfolio</div>
          <div className="pillar-links">
            <Link to="/market"><I.market />Market overview</Link><Link to="/technical"><I.technical />Charts & setups</Link><Link to="/stocks"><I.stocks />Stock analysis</Link>
            <Link to={`/analyst?q=${encodeURIComponent("Which NEPSE stocks have strong technical and fundamental setups right now? Separate short-term trades from long-term investments, with entry zone, stop-loss, targets, risk/reward and data date for each.")}`}><I.ai />AI trading assistant</Link><Link to="/portfolio"><I.portfolio />Portfolio</Link>
          </div>
        </div>
        <div className="pillar">
          <h2>My Financial Life</h2><div className="small muted">{b.money?.saved ? <>Net worth <strong>{compact(b.money.netWorth)}</strong> · saving <strong className={tone(b.money.cashFlow)}>{compact(b.money.cashFlow)}</strong>/month{b.money.savingsRatePct != null ? ` (${num(b.money.savingsRatePct, 0)}%)` : ""}</> : "Money dashboard, savings, investment comparison, AI advisor and goals"}</div>
          <div className="pillar-links">
            <Link to="/money"><I.money />Money dashboard</Link><Link to="/money"><I.planner />Savings & expenses</Link><Link to="/invest?tab=deposits"><I.invest />Compare investments</Link>
            <Link to={`/analyst?q=${encodeURIComponent("Look at my money, goals and current rates. Where should I put my savings in Nepal, and what is the most useful thing I can do this month?")}`}><I.ai />AI financial advisor</Link><Link to="/planner"><I.opportunities />Financial goals</Link>
          </div>
        </div>
      </div>
    ),
    today: b.action ? (
      <Card title="8 · Smartest action to consider today" actions={<Link className="btn sm" to={b.action.link}>Open</Link>}>
        <div><strong>{b.action.title}</strong></div><div className="small muted">{b.action.detail}</div>
      </Card>
    ) : null,
    money: b.rates ? (
      <div className="grid g3">
        <Card title="5 · Interest rates" sub={b.rates.inflationPct != null ? `Inflation ${num(b.rates.inflationPct)}% (NRB)` : undefined} actions={<Link className="small" to="/invest?tab=rates">Rates</Link>}>
          {b.rates.changes.length === 0 ? <div className="small muted">No official NRB rate changes in the last 30 days.</div> : b.rates.changes.map((c) => <div key={c.label + c.asOf} className="row between small"><span>{c.label}</span><span className="mono">{c.prev != null ? `${num(c.prev)} → ` : ""}{num(c.value)}% <span className="faint">{nptDate(c.asOf)}</span></span></div>)}
          <div className="small" style={{ marginTop: 8 }}>{b.rates.noticeCount} bank / finance rate notice{b.rates.noticeCount === 1 ? "" : "s"} in 30 days · <Link to="/invest?tab=deposits">compare</Link></div>
        </Card>
        <Card title="6 · Attractive opportunities" actions={<Link className="small" to="/invest">Where to invest</Link>}>
          {b.rates.bestDeposit ? <div className="small">Best tracked 1-year deposit: <strong>{b.rates.bestDeposit.institution} {num(b.rates.bestDeposit.ratePct)}%</strong> ({num(b.rates.bestDeposit.netAnnualPct)}% after tax){b.rates.bestDeposit.method === "ai" ? " · AI-read, check the notice" : ""}</div> : <div className="small muted">Deposit rates used: {b.rates.fdPct != null ? `${num(b.rates.fdPct)}%` : "—"} ({b.rates.fdSource}). Read bank notices under Deposit rates to compare institutions.</div>}
          {(b.openIssues ?? []).map((x) => <div key={x.company + x.issue_type} className="small">Open: <strong>{x.company}</strong> {x.issue_type} until {x.final_date ?? x.closing_date}</div>)}
        </Card>
        <Card title="7 · My money" actions={<Link className="small" to="/money">Open</Link>}>
          {!b.money?.saved ? <Empty title="Not set up yet"><Link to="/money">Add income, savings and loans</Link></Empty> : b.money.advice.length === 0 ? <div className="small up">Basics in place: emergency fund, debt and savings rate look fine.</div> : b.money.advice.map((a) => <div key={a.title} className="small" style={{ marginBottom: 4 }}>• {a.title}{a.yearlyImpact ? <span className="up"> (+{compact(a.yearlyImpact)}/yr)</span> : null}</div>)}
        </Card>
      </div>
    ) : null,
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
          <h1>Good {greeting()}. Here is your daily briefing.</h1>
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
