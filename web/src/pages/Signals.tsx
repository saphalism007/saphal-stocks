// Technical signal board: breadth against the 20/50/200-day averages, how many stocks fired each
// signal (RSI, MACD, moving-average crosses, VWAP, breakouts, volume, circuit), and every stock's signals.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../lib/api.ts";
import { Card, Loading, ErrorBox, Seg, Empty } from "../components/ui.tsx";
import { num, pct, tone, nptDate } from "../lib/format.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export default function Signals() {
  const b = useApi<Any>("/market/signals");
  const [sig, setSig] = useState<string | null>(null);
  const [lean, setLean] = useState<"both" | "bull" | "bear">("both");
  const [sort, setSort] = useState<"weight" | "move" | "symbol">("weight");
  const [q, setQ] = useState("");
  const groups = useMemo(() => { const g = new Map<string, Any[]>(); for (const d of b.data?.defs ?? []) g.set(d.group, [...(g.get(d.group) ?? []), d]); return [...g.entries()]; }, [b.data]);
  if (b.error) return <ErrorBox error={b.error} onRetry={b.reload} />;
  if (!b.data) return <div className="page"><Loading label="Scanning every stock" /></div>;
  const d = b.data, br = d.breadth;
  const term = q.trim().toLowerCase();
  let rows = d.rows.filter((r: Any) => (!sig || r.signals.some((s: Any) => s.key === sig)) && (lean === "both" || (lean === "bull" ? r.net > 0 : r.net < 0)) && (!term || r.symbol.toLowerCase().includes(term) || r.name.toLowerCase().includes(term)));
  rows = [...rows].sort((a: Any, c: Any) => sort === "move" ? (c.changePct ?? 0) - (a.changePct ?? 0) : sort === "symbol" ? a.symbol.localeCompare(c.symbol) : c.net - a.net || c.signals.length - a.signals.length);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Technical Signals</h1><p className="small muted">RSI, MACD, the 20/50/200-day moving averages, VWAP, breakouts, volume and the 10% circuit across every stock with enough history. Session {d.asOf ? nptDate(d.asOf) : "—"}. Crosses count if they happened in the last 15 sessions.</p></div></div>
      <Card title="Breadth" sub={`Where ${br.counted} stocks sit against their 20, 50 and 200-day averages`}>
        <div className="breadth-bar"><span className="down" style={{ width: `${(br.below / br.counted) * 100}%` }} /><span className="mid" style={{ width: `${(br.between / br.counted) * 100}%` }} /><span className="up" style={{ width: `${(br.above / br.counted) * 100}%` }} /></div>
        <div className="row between small"><span className="down">{br.below} below all three</span><span className="faint">{br.between} in between</span><span className="up">{br.above} above all three</span></div>
        <div className="grid g4" style={{ marginTop: 10 }}>
          {[["oversold", "oversold"], ["overbought", "overbought"], ["vol2x", "traded 2× usual volume"], ["circuit_up", "hit a circuit"]].map(([k, l]) => <button key={k} className="card stat" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => setSig(k)}><div className="value">{d.counts[k] + (k === "circuit_up" ? d.counts.circuit_dn : 0)}</div><div className="sub">{l}</div></button>)}
        </div>
      </Card>
      <div className="signals-layout">
        <Card title="Signals" sub="Tap to filter">
          <button className={`sig-item ${!sig ? "on" : ""}`} onClick={() => setSig(null)}><span>All</span><span>{d.rows.length}</span></button>
          {groups.map(([g, defs]) => (
            <div key={g}><div className="tiny faint" style={{ margin: "10px 0 4px", textTransform: "uppercase", letterSpacing: ".05em" }}>{g}</div>
              {defs.map((x: Any) => <button key={x.key} className={`sig-item ${sig === x.key ? "on" : ""}`} onClick={() => setSig(x.key)}><span className={x.dir > 0 ? "up" : x.dir < 0 ? "down" : ""}>{x.label}</span><span>{d.counts[x.key]}</span></button>)}
            </div>
          ))}
        </Card>
        <Card title={sig ? d.defs.find((x: Any) => x.key === sig)?.label : "Every stock that fired a signal"} sub={`${rows.length} stocks · sorted by ${sort === "weight" ? "how many signals fired and which way they lean" : sort === "move" ? "today's move" : "symbol"}`} actions={<>
          <input className="input" style={{ width: 140 }} placeholder="Find a stock" value={q} onChange={(e) => setQ(e.target.value)} />
          <Seg value={lean} onChange={setLean} options={[{ key: "both", label: "Both" }, { key: "bull", label: "Bullish" }, { key: "bear", label: "Bearish" }]} />
          <Seg value={sort} onChange={setSort} options={[{ key: "weight", label: "Weight" }, { key: "move", label: "Move" }, { key: "symbol", label: "A–Z" }]} />
        </>}>
          {rows.length === 0 ? <Empty title="No stock matches" /> : (
            <div className="table-scroll"><table className="t small">
              <thead><tr><th>Stock</th><th className="num">Last</th><th className="num">Day</th><th>Signals fired</th><th className="num">Net</th></tr></thead>
              <tbody>{rows.slice(0, 300).map((r: Any) => (
                <tr key={r.symbol}>
                  <td><Link className="sym" to={`/stocks/${r.symbol}`}>{r.symbol}</Link><span className="tiny faint" style={{ display: "block", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span></td>
                  <td className="num">{num(r.close)}</td><td className={`num ${tone(r.changePct)}`}>{pct(r.changePct, 1)}</td>
                  <td><div className="chips-wrap">{r.signals.slice(0, 5).map((s: Any) => <span key={s.key} className={`sig-chip ${s.dir > 0 ? "up" : s.dir < 0 ? "down" : ""}`}>{s.label.replace(/ \(.*\)/, "")}</span>)}{r.signals.length > 5 && <span className="sig-chip">+{r.signals.length - 5}</span>}</div></td>
                  <td className={`num ${tone(r.net)}`}><strong>{r.net > 0 ? "+" : ""}{r.net}</strong></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="tiny faint" style={{ marginTop: 8 }}>Signals describe what the chart did; they are not buy or sell advice. For complete trade plans see <Link to="/trading">Trading Opportunities</Link>.</p>
        </Card>
      </div>
    </div>
  );
}
