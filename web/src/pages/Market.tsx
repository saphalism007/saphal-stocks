import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../lib/api.ts";
import { Card, Stat, Loading, ErrorBox, DataTable, Fresh, Seg, Badge, Notice } from "../components/ui.tsx";
import { LineChart } from "../components/PriceChart.tsx";
import { num, pct, tone, compact, int } from "../lib/format.ts";
import { useTheme } from "../App.tsx";

interface Summary {
  date: string;
  counts: { traded: number; advancers: number; decliners: number; unchanged: number };
  totals: { turnover: number; volume: number; trades: number };
  gainers: Row[]; losers: Row[]; turnover: Row[]; volume: Row[];
  sectors: { sector: string; n: number; adv: number; dec: number; turnover: number; avgChange: number }[];
  highs52: Row[]; lows52: Row[]; highs52Count: number; lows52Count: number;
  indices: { index_id: number; name: string; date: string; close: number; change: number; change_pct: number; turnover: number }[];
  trend: { label: string; notes: string[] } | null;
  sentiment: { label: string; breadthRatio: number; method: string } | null;
}
interface Row { symbol: string; name: string; sector: string; close: number; changePct: number; turnover: number; volume: number }

export default function Market() {
  const { data: m, error, loading, reload } = useApi<Summary>("/market/summary");
  const [indexId, setIndexId] = useState(12);
  const [range, setRange] = useState<"3m" | "1y" | "5y" | "max">("1y");
  const from = useMemo(() => { const d = new Date(); if (range === "3m") d.setMonth(d.getMonth() - 3); else if (range === "1y") d.setFullYear(d.getFullYear() - 1); else if (range === "5y") d.setFullYear(d.getFullYear() - 5); else return "1900-01-01"; return d.toISOString().slice(0, 10); }, [range]);
  const hist = useApi<{ date: string; close: number }[]>(`/market/index/${indexId}?from=${from}`, [indexId, from]);
  const breadth = useApi<{ date: string; adv: number; dec: number; turnover: number }[]>("/market/breadth-history");
  const [list, setList] = useState<"gainers" | "losers" | "turnover" | "volume" | "highs52" | "lows52">("gainers");
  const nav = useNavigate();
  const { theme } = useTheme();
  if (loading && !m) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!m) return null;
  const main = m.indices.filter((i) => [12, 16, 4, 15].includes(i.index_id));
  const subs = m.indices.filter((i) => ![12, 16, 4, 15].includes(i.index_id));
  const rows = m[list];
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>NEPSE Market</h1><p>Indices, breadth, turnover and sector performance. <Fresh date={m.date} source="ShareSansar" /></p></div>
      </div>
      <div className="grid g4">
        {main.map((i) => (
          <button key={i.index_id} className="card stat" style={{ textAlign: "left", cursor: "pointer", outline: indexId === i.index_id ? "2px solid var(--accent)" : undefined }} onClick={() => setIndexId(i.index_id)}>
            <div className="label">{i.name}</div><div className="value">{num(i.close)}</div>
            <div className={`sub ${tone(i.change_pct)}`}>{num(i.change)} ({pct(i.change_pct)})</div>
          </button>
        ))}
      </div>
      <div className="grid g3">
        <Card title={m.indices.find((i) => i.index_id === indexId)?.name ?? "Index"} className="span2" actions={<Seg value={range} onChange={setRange} options={[{ key: "3m", label: "3M" }, { key: "1y", label: "1Y" }, { key: "5y", label: "5Y" }, { key: "max", label: "Max" }]} />}>
          {hist.loading && !hist.data ? <Loading /> : <LineChart data={(hist.data || []).map((d) => ({ date: d.date, value: d.close }))} height={300} theme={theme} />}
          {m.trend && indexId === 12 && <p className="small muted" style={{ marginTop: 8 }}><Badge tone={m.trend.label === "Uptrend" ? "up" : m.trend.label === "Downtrend" ? "down" : "warn"}>{m.trend.label}</Badge> {m.trend.notes.join(" ")}</p>}
        </Card>
        <div className="col">
          <Stat label="Turnover" value={compact(m.totals.turnover)} sub={`${int(m.totals.volume)} shares · ${int(m.totals.trades)} transactions`} />
          <Stat label="Advancers / decliners" value={<><span className="up">{m.counts.advancers}</span> / <span className="down">{m.counts.decliners}</span></>} sub={`${m.counts.unchanged} unchanged · ${m.counts.traded} traded`} />
          <Stat label="Sentiment (breadth)" value={<span style={{ fontSize: 17 }}>{m.sentiment?.label ?? "—"}</span>} sub={m.sentiment ? `${Math.round(m.sentiment.breadthRatio * 100)}% of movers advanced` : ""} />
          <Stat label="52-week highs / lows" value={<><span className="up">{m.highs52Count}</span> / <span className="down">{m.lows52Count}</span></>} sub="Stocks closing at their 52-week extreme" />
        </div>
      </div>
      <div className="grid g2">
        <Card title="Movers" flush actions={<Seg value={list} onChange={setList} options={[{ key: "gainers", label: "Gainers" }, { key: "losers", label: "Losers" }, { key: "turnover", label: "Turnover" }, { key: "volume", label: "Volume" }, { key: "highs52", label: "52W high" }, { key: "lows52", label: "52W low" }]} />}>
          <DataTable rows={rows} onRow={(r) => nav(`/stocks/${r.symbol}`)} maxHeight={420} cols={[
            { key: "symbol", label: "Symbol", render: (r) => <span className="sym">{r.symbol}</span> },
            { key: "name", label: "Company", render: (r) => <span className="small muted">{r.name}</span> },
            { key: "close", label: "Close", num: true, render: (r) => num(r.close) },
            { key: "changePct", label: "Chg %", num: true, render: (r) => <span className={tone(r.changePct)}>{pct(r.changePct)}</span> },
            { key: "turnover", label: "Turnover", num: true, render: (r) => compact(r.turnover) },
          ]} />
        </Card>
        <Card title="Sector performance" flush sub="Equal-weighted average change today">
          <DataTable rows={m.sectors} initialSort={{ key: "turnover", dir: -1 }} cols={[
            { key: "sector", label: "Sector" },
            { key: "avgChange", label: "Avg chg", num: true, render: (r) => <span className={tone(r.avgChange)}>{pct(r.avgChange)}</span> },
            { key: "adv", label: "Adv/Dec", num: true, render: (r) => <><span className="up">{r.adv}</span>/<span className="down">{r.dec}</span></> },
            { key: "turnover", label: "Turnover", num: true, render: (r) => compact(r.turnover) },
          ]} />
        </Card>
      </div>
      <Card title="Sector indices">
        <div className="heat">
          {subs.map((i) => {
            const c = i.change_pct ?? 0;
            const a = Math.min(1, Math.abs(c) / 3);
            return (
              <div key={i.index_id} style={{ background: c >= 0 ? `rgba(34,197,94,${0.08 + a * 0.35})` : `rgba(244,63,94,${0.08 + a * 0.35})`, cursor: "pointer" }} onClick={() => setIndexId(i.index_id)}>
                <div style={{ fontWeight: 600, fontSize: 12 }}>{i.name}</div>
                <div className="mono">{num(i.close)}</div>
                <div className="mono">{pct(i.change_pct)}</div>
              </div>
            );
          })}
        </div>
      </Card>
      <Card title="Market breadth history" sub="Advancing minus declining stocks per session (from stored prices)">
        {breadth.data?.length ? <LineChart data={breadth.data.map((d) => ({ date: d.date, value: d.adv - d.dec }))} height={200} baseline={0} theme={theme} area={false} color="#60a5fa" /> : <Notice>Breadth history needs price history to be loaded.</Notice>}
      </Card>
    </div>
  );
}
