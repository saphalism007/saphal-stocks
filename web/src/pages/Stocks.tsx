import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { Card, Loading, ErrorBox, DataTable, Score, Fresh, Badge, NumInput, Seg } from "../components/ui.tsx";
import { num, pct, tone, compact } from "../lib/format.ts";

export interface StockRow { symbol: string; name: string | null; sector: string | null; date: string | null; close: number | null; change_pct: number | null; turnover: number | null; marketCap: number | null; fundamentalScore: number | null; technicalScore: number | null; pe: number | null; pb: number | null; roe: number | null; cashYield: number | null; return3m: number | null; return1y: number | null; trend: string | null; rsi: number | null; reports: number; high52: number | null; low52: number | null; avgTurnover20: number | null }

type Filters = { maxPe: string; maxPb: string; minRoe: string; minYield: string; trend: string; minFund: string; liquid: boolean };
const EMPTY: Filters = { maxPe: "", maxPb: "", minRoe: "", minYield: "", trend: "", minFund: "", liquid: false };
const BUILT_IN: { name: string; sector: string; q: string; filters: Partial<Filters> }[] = [
  { name: "Value banks", sector: "Commercial Bank", q: "", filters: { maxPb: "2", minRoe: "12" } },
  { name: "Dividend payers", sector: "", q: "", filters: { minYield: "3", liquid: true } },
  { name: "Quality in uptrend", sector: "", q: "", filters: { minFund: "60", trend: "uptrend", liquid: true } },
  { name: "Cheap hydropower", sector: "Hydropower", q: "", filters: { maxPb: "2.5", minRoe: "5" } },
  { name: "Low P/E, profitable", sector: "", q: "", filters: { maxPe: "15", minRoe: "10", liquid: true } },
];

export default function Stocks() {
  const { data, error, loading, reload } = useApi<StockRow[]>("/stocks");
  const [params] = useSearchParams();
  const [q, setQ] = useState("");
  const [sector, setSector] = useState(params.get("sector") ?? "");
  const [f, setF] = useState<Filters>(EMPTY);
  const [view, setView] = useState<"cards" | "table">(() => (typeof window !== "undefined" && window.innerWidth < 760 ? "cards" : "table"));
  const saved = useApi<{ name: string; sector: string; q: string; filters: Partial<Filters> }[]>("/screens");
  useEffect(() => { const s2 = params.get("sector"); if (s2) setSector(s2); }, [params]);
  const apply = (p: { sector: string; q: string; filters: Partial<Filters> }) => { setSector(p.sector); setQ(p.q); setF({ ...EMPTY, ...p.filters }); };
  const saveScreen = async () => {
    const name = prompt("Name this screen");
    if (!name) return;
    const list = [...(saved.data ?? []).filter((x) => x.name !== name), { name, sector, q, filters: f }];
    await api("/screens", { method: "PUT", body: list }); saved.reload();
  };
  const removeScreen = async (name: string) => { await api("/screens", { method: "PUT", body: (saved.data ?? []).filter((x) => x.name !== name) }); saved.reload(); };
  const nav = useNavigate();
  const sectors = useMemo(() => [...new Set((data || []).map((r) => r.sector).filter(Boolean))].sort() as string[], [data]);
  const rows = useMemo(() => (data || []).filter((r) => {
    if (q && !(`${r.symbol} ${r.name}`.toLowerCase().includes(q.toLowerCase()))) return false;
    if (sector && r.sector !== sector) return false;
    if (f.maxPe && !(r.pe != null && r.pe <= +f.maxPe)) return false;
    if (f.maxPb && !(r.pb != null && r.pb <= +f.maxPb)) return false;
    if (f.minRoe && !(r.roe != null && r.roe >= +f.minRoe)) return false;
    if (f.minYield && !(r.cashYield != null && r.cashYield >= +f.minYield)) return false;
    if (f.minFund && !(r.fundamentalScore != null && r.fundamentalScore >= +f.minFund)) return false;
    if (f.trend && r.trend !== f.trend) return false;
    if (f.liquid && (r.avgTurnover20 ?? 0) < 5_000_000) return false;
    return true;
  }), [data, q, sector, f]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const asOf = data?.find((r) => r.date)?.date;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Stocks</h1><p>All {data?.length ?? 0} active NEPSE securities with prices, valuation and scores. Click a row for the full research page. <Fresh date={asOf} /></p></div>
      </div>
      <Card title="Screener" actions={<><button className="btn sm" onClick={() => apply({ sector: "", q: "", filters: {} })}>Clear</button><button className="btn sm" onClick={saveScreen}>Save screen</button></>}>
        <div className="row" style={{ marginBottom: 10 }}>
          <span className="tiny faint">Presets:</span>
          {BUILT_IN.map((p) => <button key={p.name} className="chip" onClick={() => apply(p)}>{p.name}</button>)}
          {(saved.data ?? []).map((p) => <span key={p.name} className="chip" style={{ borderColor: "var(--accent)" }}><button className="btn ghost sm" style={{ padding: 0 }} onClick={() => apply(p)}>★ {p.name}</button><button className="btn ghost sm" style={{ padding: 0 }} onClick={() => removeScreen(p.name)} aria-label={`Delete ${p.name}`}>×</button></span>)}
        </div>
        <div className="form-grid">
          <label className="field">Search<input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Symbol or name" /></label>
          <label className="field">Sector<select className="input" value={sector} onChange={(e) => setSector(e.target.value)}><option value="">All sectors</option>{sectors.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="field">Max P/E<NumInput className="input" value={f.maxPe} onChange={set("maxPe")} /></label>
          <label className="field">Max P/B<NumInput className="input" value={f.maxPb} onChange={set("maxPb")} /></label>
          <label className="field">Min ROE %<NumInput className="input" value={f.minRoe} onChange={set("minRoe")} /></label>
          <label className="field">Min cash yield %<NumInput className="input" value={f.minYield} onChange={set("minYield")} /></label>
          <label className="field">Min fundamental score<NumInput className="input" value={f.minFund} onChange={set("minFund")} /></label>
          <label className="field">Trend<select className="input" value={f.trend} onChange={set("trend")}><option value="">Any</option><option value="uptrend">Uptrend</option><option value="sideways">Sideways</option><option value="downtrend">Downtrend</option></select></label>
          <label className="chk" style={{ alignSelf: "end", paddingBottom: 8 }}><input type="checkbox" checked={f.liquid} onChange={set("liquid")} /> Liquid only (≥ Rs. 50 L/day)</label>
        </div>
      </Card>
      <div className="chip-row">{["", ...[...new Set((data || []).map((r) => r.sector).filter(Boolean))].sort()].map((x) => <button key={x || "all"} className={`chip ${sector === x ? "on" : ""}`} onClick={() => setSector(x as string)}>{x || "All stocks"}</button>)}</div>
      <Card title={`${rows.length} results`} flush actions={<Seg value={view} onChange={setView} options={[{ key: "cards", label: "Cards" }, { key: "table", label: "Table" }]} />}>
        {view === "cards" ? (
          <div className="co-grid">{[...rows].sort((a, b) => a.symbol.localeCompare(b.symbol)).map((r) => (
            <Link key={r.symbol} to={`/stocks/${r.symbol}`} className="co-card">
              <span className="co-badge">{r.symbol.slice(0, 2)}</span>
              <span style={{ minWidth: 0, flex: 1 }}><strong className="sym">{r.symbol}</strong><span className="tiny faint" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.sector}</span><span className="small mono">Rs. {num(r.close)}</span></span>
              <span className={`small ${tone(r.change_pct)}`}>{r.change_pct != null ? `${r.change_pct > 0 ? "▲" : r.change_pct < 0 ? "▼" : ""} ${num(Math.abs(r.change_pct))}%` : "—"}</span>
            </Link>
          ))}</div>
        ) : <DataTable rows={rows} onRow={(r) => nav(`/stocks/${r.symbol}`)} maxHeight={720} initialSort={{ key: "turnover", dir: -1 }} rowKey={(r) => r.symbol} cols={[
          { key: "symbol", label: "Symbol", render: (r) => <span className="sym">{r.symbol}</span> },
          { key: "name", label: "Company", render: (r) => <span className="small">{r.name ?? "—"}<div className="tiny faint">{r.sector ?? "Sector unknown"}</div></span> },
          { key: "close", label: "LTP", num: true, render: (r) => num(r.close) },
          { key: "change_pct", label: "Chg %", num: true, render: (r) => <span className={tone(r.change_pct)}>{pct(r.change_pct)}</span> },
          { key: "turnover", label: "Turnover", num: true, render: (r) => compact(r.turnover) },
          { key: "marketCap", label: "Mkt cap", num: true, render: (r) => compact(r.marketCap) },
          { key: "pe", label: "P/E", num: true, render: (r) => num(r.pe, 1) },
          { key: "pb", label: "P/B", num: true, render: (r) => num(r.pb, 2) },
          { key: "roe", label: "ROE %", num: true, render: (r) => num(r.roe, 1) },
          { key: "cashYield", label: "Yield %", num: true, render: (r) => num(r.cashYield, 1) },
          { key: "return1y", label: "1Y %", num: true, render: (r) => <span className={tone(r.return1y)}>{pct(r.return1y, 1)}</span> },
          { key: "trend", label: "Trend", render: (r) => r.trend ? <Badge tone={r.trend === "uptrend" ? "up" : r.trend === "downtrend" ? "down" : ""}>{r.trend}</Badge> : "—" },
          { key: "fundamentalScore", label: "Fund.", num: true, render: (r) => <Score value={r.fundamentalScore} title={r.reports ? undefined : "No statements stored yet"} /> },
          { key: "technicalScore", label: "Tech.", num: true, render: (r) => <Score value={r.technicalScore} /> },
        ]} />}
      </Card>
    </div>
  );
}
