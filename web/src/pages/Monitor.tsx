// Nepal financial market monitor: NEPSE, NRB rates and macro data, bank rate notices, IPO/FPO and
// fund issues, company reports, dividends and regulatory news, each with what it could mean for you.
import { Link } from "react-router-dom";
import { useApi } from "../lib/api.ts";
import { Card, Stat, Loading, ErrorBox, Badge, Empty } from "../components/ui.tsx";
import { I } from "../components/icons.tsx";
import { compact, num, nptDate, pct, tone } from "../lib/format.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function Row({ a }: { a: Any }) {
  return (
    <div className="list-row" style={{ alignItems: "flex-start" }}>
      <span className="small faint mono" style={{ minWidth: 74 }}>{nptDate(a.published_date ?? a.published)}</span>
      <div style={{ flex: 1 }}>{a.symbol && <Link className="sym" to={`/stocks/${a.symbol}`}>{a.symbol} </Link>}<a href={a.url} target="_blank" rel="noopener noreferrer" className="small">{a.title}</a></div>
    </div>
  );
}

export default function Monitor() {
  const m = useApi<Any>("/monitor");
  if (m.error) return <ErrorBox error={m.error} onRetry={m.reload} />;
  if (!m.data) return <Loading />;
  const d = m.data, mk = d.market, r = d.rates;
  const nepse = mk?.indices?.find?.((i: Any) => i.index_id === 12) ?? mk?.nepse;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Market Monitor</h1><p className="muted">What changed in Nepal's markets, rates and economy, with original sources and dates, and what each could mean for your money.</p></div></div>
      <div className="grid g4">
        <Stat label="NEPSE" value={nepse ? num(nepse.close) : "-"} sub={nepse ? <span className={tone(nepse.change_pct)}>{pct(nepse.change_pct)}, {nptDate(nepse.date)}</span> : ""} />
        <Stat label="Inflation" value={r.inflationPct != null ? `${num(r.inflationPct)}%` : "-"} sub={d.macro ? `NRB, ${nptDate(d.macro.published)}` : ""} />
        <Stat label="Fixed deposit rate used" value={r.fdPct != null ? `${num(r.fdPct)}%` : "-"} sub={<span className="tiny">{r.sources?.fd}</span>} />
        <Stat label="364-day T-bill" value={r.tbillPct != null ? `${num(r.tbillPct)}%` : "-"} sub={r.sources?.tbill} />
      </div>
      <div className="grid g2">
        <Card title="Interest-rate changes (last 4 months)" sub="Nepal Rastra Bank" actions={<Link className="btn sm" to="/invest?tab=rates">All rates</Link>}>
          {d.rateChanges.length === 0 ? <Empty title="No official rate changes recently" /> : <div className="list">{d.rateChanges.map((x: Any) => (
            <div key={x.key} className="list-row" style={{ alignItems: "flex-start" }}>
              <Badge tone={x.change < 0 ? "up" : "down"}>{x.change > 0 ? "+" : ""}{num(x.change)} pts</Badge>
              <div style={{ flex: 1 }}><strong className="small">{x.label}</strong> <span className="small">{num(x.prev_value)}% &gt; {num(x.value)}%</span> <span className="tiny faint">{nptDate(x.as_of)}, <a href={x.source_url} target="_blank" rel="noopener noreferrer">NRB</a></span><div className="small muted">{x.impact}</div></div>
            </div>
          ))}</div>}
        </Card>
        <Card title={d.macro?.title ?? "Economy"} sub={d.macro ? `NRB, published ${nptDate(d.macro.published)}` : ""} actions={d.macro && <a className="btn sm" href={d.macro.pdf_url || d.macro.url} target="_blank" rel="noopener noreferrer"><I.external /> Report</a>}>
          {!d.macro ? <Empty title="Macro report unavailable" /> : <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{d.macro.highlights.slice(0, 8).map((h: string) => <li key={h}>{h}</li>)}</ul>}
        </Card>
      </div>
      <div className="grid g2">
        <Card title="On your holdings and watchlist" sub="Last 14 days">
          {d.mine.length === 0 ? <Empty title="Nothing new on your stocks" /> : <div className="list">{d.mine.map((a: Any) => <Row key={a.url} a={a} />)}</div>}
        </Card>
        <Card title="IPO, FPO, rights and fund issues" sub="Open or coming up" actions={<Link className="btn sm" to="/opportunities">Issue tracker</Link>}>
          {d.issues.length === 0 ? <Empty title="No open or upcoming issues" /> : (
            <table className="t small"><thead><tr><th>Issue</th><th>Type</th><th>Status</th><th>Dates</th></tr></thead>
              <tbody>{d.issues.map((x: Any, i: number) => <tr key={i}><td>{x.symbol ? <Link className="sym" to={`/stocks/${x.symbol}`}>{x.symbol}</Link> : null} {x.company}</td><td>{x.issue_type}</td><td><Badge tone={x.state === "Open now" ? "up" : "blue"}>{x.state}</Badge></td><td className="small muted">{x.opening_date ?? "-"} &gt; {x.final_date ?? x.closing_date ?? "-"}</td></tr>)}</tbody></table>
          )}
          <p className="tiny faint">Apply through Mero Share (ASBA). Units and price: see the issue tracker.</p>
        </Card>
      </div>
      <Card title="Bank and finance company rate notices" sub="Published in the last 5 weeks" actions={<Link className="btn sm" to="/invest?tab=deposits">Compare deposit rates</Link>}>
        {d.notices.length === 0 ? <Empty title="No new rate notices" /> : <div className="row wrap" style={{ gap: 6 }}>{d.notices.map((n: Any) => <a key={n.url} className="badge" href={n.image_url ?? n.url} target="_blank" rel="noopener noreferrer" title={`${n.title} (${n.published})`}>{n.symbol ?? n.institution}, {n.published.slice(5)}</a>)}</div>}
      </Card>
      <div className="grid g2">
        {d.categories.map((c: Any) => (
          <Card key={c.category} title={`${c.category} (${c.count})`} sub={c.impact}>
            <div className="list">{c.items.map((a: Any) => <Row key={a.url} a={a} />)}</div>
            {c.count > c.items.length && <Link className="small" to={`/news?category=${encodeURIComponent(c.category)}`}>All {c.count}</Link>}
          </Card>
        ))}
        {d.regulatory.length > 0 && <Card title="Regulators, tax and policy" sub="SEBON, NRB, NEPSE, CDSC and tax-related notices"><div className="list">{d.regulatory.map((a: Any) => <Row key={a.url} a={a} />)}</div></Card>}
        {d.funds.length > 0 && <Card title="Mutual fund announcements"><div className="list">{d.funds.map((a: Any) => <Row key={a.url} a={a} />)}</div></Card>}
      </div>
      <p className="tiny faint">Market turnover {mk?.totals?.turnover ? compact(mk.totals.turnover) : "-"}. Explanations describe typical effects, not predictions.</p>
    </div>
  );
}
