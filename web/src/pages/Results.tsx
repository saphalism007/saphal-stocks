// Quarterly results: every company's latest quarter, against the same quarter last year.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../lib/api.ts";
import { Card, Loading, ErrorBox, Stat, Empty } from "../components/ui.tsx";
import { compact, pct, tone, nptDate } from "../lib/format.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const rs000 = (v: number | null) => (v == null ? "—" : compact(v * 1000));

export default function Results() {
  const r = useApi<Any>("/market/results");
  const [sector, setSector] = useState("");
  const [q, setQ] = useState("");
  if (r.error) return <ErrorBox error={r.error} onRetry={r.reload} />;
  if (!r.data) return <div className="page"><Loading /></div>;
  const d = r.data;
  if (!d.quarter) return <div className="page"><Empty title="No quarterly results stored yet" /></div>;
  const sectors = [...new Set(d.rows.map((x: Any) => x.sector))].sort() as string[];
  const term = q.trim().toLowerCase();
  const rows = d.rows.filter((x: Any) => (!sector || x.sector === sector) && (!term || x.symbol.toLowerCase().includes(term) || x.name.toLowerCase().includes(term)));
  const byDate = new Map<string, Any[]>();
  for (const x of rows) byDate.set(x.published, [...(byDate.get(x.published) ?? []), x]);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Quarterly Results</h1><p className="small muted">{d.reported} of {d.total} companies have reported {d.quarter}. Net profit against the same quarter last year (Nepali quarterly figures are cumulative for the fiscal year).</p></div></div>
      <div className="grid g4">
        <Stat label="Profit up" value={<span className="up">{d.counts.up}</span>} sub="vs same quarter last year" />
        <Stat label="Profit down" value={<span className="down">{d.counts.down}</span>} sub={`${d.counts.noCompare} with nothing to compare`} />
        <Stat label="Highest profit" value={<span className="stat-text">{d.highest?.symbol ?? "—"}</span>} sub={d.highest ? rs000(d.highest.profit) : ""} />
        <Stat label="Biggest rise / fall" value={<span className="stat-text"><span className="up">{d.biggestRise?.symbol ?? "—"}</span> / <span className="down">{d.biggestFall?.symbol ?? "—"}</span></span>} sub={d.biggestRise ? `${pct(d.biggestRise.yoyPct, 0)} / ${pct(d.biggestFall?.yoyPct, 0)}` : ""} />
      </div>
      <Card title="Results by date" actions={<><input className="input" style={{ width: 150 }} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /><select className="input" value={sector} onChange={(e) => setSector(e.target.value)}><option value="">All sectors</option>{sectors.map((s) => <option key={s}>{s}</option>)}</select></>}>
        {[...byDate.entries()].map(([date, list]) => (
          <div key={date} style={{ marginBottom: 14 }}>
            <div className="row between small" style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}><strong>{nptDate(date)}</strong><span className="faint">{list.length} companies</span></div>
            {list.map((x: Any) => (
              <Link key={x.symbol} to={`/stocks/${x.symbol}?tab=financials`} className="result-row">
                <span style={{ minWidth: 0 }}><span className="sym">{x.symbol}</span> <span className="small">{x.name}</span><span className="tiny faint" style={{ display: "block" }}>{x.sector}{x.topLine != null ? ` · ${x.topLineLabel} ${rs000(x.topLine)}` : ""}</span></span>
                <span className="mono small" style={{ textAlign: "right" }}>{rs000(x.profit)}<span className="tiny faint" style={{ display: "block" }}>{x.lastYearProfit != null ? `was ${rs000(x.lastYearProfit)}` : "no comparison"}</span></span>
                <span className={`mono small ${tone(x.yoyPct)}`} style={{ textAlign: "right", minWidth: 64 }}>{x.yoyPct != null ? pct(x.yoyPct, 1) : "—"}</span>
              </Link>
            ))}
          </div>
        ))}
        {d.note && <p className="tiny faint">{d.note}</p>}
        <p className="tiny faint">Figures from each company's published quarterly report (Rs. '000), via ShareSansar. Last year's figure comes from the stored report or, if not stored, the official result headline of that quarter.</p>
      </Card>
    </div>
  );
}
