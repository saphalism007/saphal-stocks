import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../lib/api.ts";
import { Card, Loading, ErrorBox, DataTable, Score, Fresh, Badge } from "../components/ui.tsx";
import { num, pct, tone, compact } from "../lib/format.ts";

export interface StockRow { symbol: string; name: string | null; sector: string | null; date: string | null; close: number | null; change_pct: number | null; turnover: number | null; marketCap: number | null; fundamentalScore: number | null; technicalScore: number | null; pe: number | null; pb: number | null; roe: number | null; cashYield: number | null; return3m: number | null; return1y: number | null; trend: string | null; rsi: number | null; reports: number; high52: number | null; low52: number | null; avgTurnover20: number | null }

export default function Stocks() {
  const { data, error, loading, reload } = useApi<StockRow[]>("/stocks");
  const [q, setQ] = useState("");
  const [sector, setSector] = useState("");
  const [f, setF] = useState({ maxPe: "", maxPb: "", minRoe: "", minYield: "", trend: "", minFund: "", liquid: false });
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
      <Card title="Screener">
        <div className="form-grid">
          <label className="field">Search<input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Symbol or name" /></label>
          <label className="field">Sector<select className="input" value={sector} onChange={(e) => setSector(e.target.value)}><option value="">All sectors</option>{sectors.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="field">Max P/E<input className="input" type="number" value={f.maxPe} onChange={set("maxPe")} /></label>
          <label className="field">Max P/B<input className="input" type="number" value={f.maxPb} onChange={set("maxPb")} /></label>
          <label className="field">Min ROE %<input className="input" type="number" value={f.minRoe} onChange={set("minRoe")} /></label>
          <label className="field">Min cash yield %<input className="input" type="number" value={f.minYield} onChange={set("minYield")} /></label>
          <label className="field">Min fundamental score<input className="input" type="number" value={f.minFund} onChange={set("minFund")} /></label>
          <label className="field">Trend<select className="input" value={f.trend} onChange={set("trend")}><option value="">Any</option><option value="uptrend">Uptrend</option><option value="sideways">Sideways</option><option value="downtrend">Downtrend</option></select></label>
          <label className="chk" style={{ alignSelf: "end", paddingBottom: 8 }}><input type="checkbox" checked={f.liquid} onChange={set("liquid")} /> Liquid only (≥ Rs. 50 L/day)</label>
        </div>
      </Card>
      <Card title={`${rows.length} results`} flush>
        <DataTable rows={rows} onRow={(r) => nav(`/stocks/${r.symbol}`)} maxHeight={720} initialSort={{ key: "turnover", dir: -1 }} rowKey={(r) => r.symbol} cols={[
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
        ]} />
      </Card>
    </div>
  );
}
