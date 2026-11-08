import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../lib/api.ts";
import { Card, Loading, ErrorBox, DataTable, Score, Badge, Fresh } from "./ui.tsx";
import { num } from "../lib/format.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Strategy { key: string; name: string; horizon: string; kind: string; description: string; weights: { factor: string; weight: number; label: string; higherIsBetter: boolean; lo: number; hi: number }[]; filters: string[] }

export function RankingPanel({ kinds, defaultKey }: { kinds: string[]; defaultKey: string }) {
  const strategies = useApi<Strategy[]>("/rank/strategies");
  const [key, setKey] = useState(defaultKey);
  const [sector, setSector] = useState("");
  const [weights, setWeights] = useState<Record<string, number>>({});
  const strat = strategies.data?.find((s) => s.key === key);
  useEffect(() => {
    try { const saved = localStorage.getItem(`ss-weights-${key}`); setWeights(saved ? JSON.parse(saved) : {}); } catch { setWeights({}); }
  }, [key]);
  const wParam = Object.keys(weights).length ? `&weights=${encodeURIComponent(JSON.stringify(weights))}` : "";
  const r = useApi<any>(`/rank/${key}?limit=60${sector ? `&sector=${encodeURIComponent(sector)}` : ""}${wParam}`, [key, sector, wParam]);
  const sectors = useApi<{ sector: string }[]>("/sectors");
  const nav = useNavigate();
  const list = useMemo(() => strategies.data?.filter((s) => kinds.includes(s.kind)) ?? [], [strategies.data, kinds]);
  const setW = (f: string, v: number) => {
    const next = { ...weights, [f]: v };
    setWeights(next);
    try { localStorage.setItem(`ss-weights-${key}`, JSON.stringify(next)); } catch { /* ignore */ }
  };
  if (strategies.loading) return <Loading />;
  return (
    <div className="col">
      <div className="pill-tabs">{list.map((s) => <button key={s.key} className={`chip`} style={key === s.key ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined} onClick={() => setKey(s.key)}>{s.name}</button>)}</div>
      {strat && (
        <div className="grid g3">
          <Card title={`${strat.name} model`} sub={`Horizon: ${strat.horizon}`}>
            <p className="small muted">{strat.description}</p>
            <div className="small" style={{ fontWeight: 600, margin: "8px 0 4px" }}>Weights (adjustable, saved on this device)</div>
            {strat.weights.map((w) => (
              <div key={w.factor} className="col" style={{ gap: 2, marginBottom: 6 }}>
                <div className="row between small"><span>{w.label} {w.higherIsBetter ? "↑" : "↓"}</span><span className="mono">{num(weights[w.factor] ?? w.weight, 2)}</span></div>
                <input type="range" min={0} max={1} step={0.05} value={weights[w.factor] ?? w.weight} onChange={(e) => setW(w.factor, +e.target.value)} />
                <div className="tiny faint">Scaled {w.lo} → {w.hi}{w.higherIsBetter ? "" : " (lower is better)"}</div>
              </div>
            ))}
            {Object.keys(weights).length > 0 && <button className="btn sm" onClick={() => { setWeights({}); try { localStorage.removeItem(`ss-weights-${key}`); } catch { /* ignore */ } }}>Reset to defaults</button>}
            <div className="small" style={{ fontWeight: 600, margin: "10px 0 4px" }}>Eligibility filters</div>
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>{strat.filters.length ? strat.filters.map((f) => <li key={f}>{f}</li>) : <li>None</li>}</ul>
            <label className="field" style={{ marginTop: 10 }}>Sector<select className="input" value={sector} onChange={(e) => setSector(e.target.value)}><option value="">All sectors</option>{sectors.data?.map((s) => <option key={s.sector}>{s.sector}</option>)}</select></label>
          </Card>
          <Card title="Ranking" className="span2" flush sub={r.data ? <><Fresh date={r.data.asOf} /> · {r.data.ranked.length} ranked of {r.data.universe}; {r.data.excluded} excluded by filters or missing data</> : undefined}>
            {r.loading && !r.data ? <Loading /> : r.error ? <ErrorBox error={r.error} /> : (
              <DataTable rows={r.data?.ranked ?? []} onRow={(x: any) => nav(`/stocks/${x.symbol}`)} maxHeight={620} empty="No stocks pass this model's filters with enough data yet" cols={[
                { key: "rank", label: "#", num: true },
                { key: "symbol", label: "Stock", render: (x: any) => <><span className="sym">{x.symbol}</span><div className="tiny faint">{x.name}</div></> },
                { key: "sector", label: "Sector", render: (x: any) => <span className="small muted">{x.sector}</span> },
                { key: "score", label: "Score", num: true, render: (x: any) => <Score value={x.score} /> },
                { key: "drivers", label: "Contributions", render: (x: any) => <span className="tiny">{x.contributions.map((c: any) => <span key={c.label} style={{ marginRight: 8 }} title={`raw ${c.raw ?? "n/a"}`}>{c.label.split(" (")[0]}: <b className="mono">{c.raw == null ? "n/a" : num(c.points, 1)}</b></span>)}</span> },
                { key: "coverage", label: "Data", num: true, render: (x: any) => <Badge tone={x.coverage === 100 ? "accent" : "warn"}>{x.coverage}%</Badge> },
              ]} />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
