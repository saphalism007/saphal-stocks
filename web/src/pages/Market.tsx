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
  marketCap: number | null; marketCapNote: string;
}
interface Row { symbol: string; name: string; sector: string; close: number; changePct: number; turnover: number; volume: number }

export default function Market() {
  const { data: m, error, loading, reload } = useApi<Summary>("/market/summary");
  const [indexId, setIndexId] = useState(12);
  const [range, setRange] = useState<"3m" | "1y" | "5y" | "max">("1y");
  const from = useMemo(() => { const d = new Date(); if (range === "3m") d.setMonth(d.getMonth() - 3); else if (range === "1y") d.setFullYear(d.getFullYear() - 1); else if (range === "5y") d.setFullYear(d.getFullYear() - 5); else return "1900-01-01"; return d.toISOString().slice(0, 10); }, [range]);
  const hist = useApi<{ date: string; close: number }[]>(`/market/index/${indexId}?from=${from}`, [indexId, from]);
  const breadth = useApi<{ date: string; adv: number; dec: number; turnover: number }[]>("/market/breadth-history");
  const fx = useApi<{ latest: string | null; rows: { currency: string; unit: number; buy: number; sell: number; change1m: number | null; change1y: number | null }[]; usd: { date: string; sell: number }[]; source: string; note: string }>("/economy/forex");
  const rotation = useApi<{ nepse: Record<string, number | null>; rows: { indexId: number; name: string; last: number | null; w1: number | null; m1: number | null; m3: number | null; m6: number | null; y1: number | null; fromHigh: number | null; relative3m: number | null }[]; note: string }>("/market/sector-rotation");
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
          <Stat label="Market capitalisation" value={compact(m.marketCap)} sub={<span title={m.marketCapNote}>Listed equities (approx.)</span>} />
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
      <Card title="Sector rotation" flush sub={rotation.data ? `${rotation.data.note} NEPSE: 1M ${pct(rotation.data.nepse.m1, 1)}, 3M ${pct(rotation.data.nepse.m3, 1)}, 1Y ${pct(rotation.data.nepse.y1, 1)}.` : undefined}>
        {rotation.data ? <DataTable rows={rotation.data.rows} onRow={(r) => setIndexId(r.indexId)} initialSort={{ key: "relative3m", dir: -1 }} cols={[
          { key: "name", label: "Sector index" }, { key: "last", label: "Last", num: true, render: (r) => num(r.last) },
          ...(["w1", "m1", "m3", "m6", "y1"] as const).map((k) => ({ key: k, label: { w1: "1W", m1: "1M", m3: "3M", m6: "6M", y1: "1Y" }[k], num: true, render: (r: typeof rotation.data.rows[number]) => <span className={tone(r[k])}>{pct(r[k], 1)}</span> })),
          { key: "relative3m", label: "vs NEPSE (3M)", num: true, render: (r) => <span className={tone(r.relative3m)} style={{ fontWeight: 600 }}>{r.relative3m == null ? "—" : `${r.relative3m > 0 ? "+" : ""}${num(r.relative3m, 1)} pts`}</span> },
          { key: "fromHigh", label: "From 52W high", num: true, render: (r) => pct(r.fromHigh, 1) },
        ]} /> : <Loading />}
      </Card>
      <div className="grid g3">
        <Card title="USD / NPR (NRB selling rate, 1 year)" className="span2" sub={fx.data ? `${fx.data.source}. ${fx.data.note}` : undefined}>
          {fx.data?.usd.length ? <LineChart data={fx.data.usd.map((d) => ({ date: d.date, value: d.sell }))} height={220} theme={theme} color="#f59e0b" /> : <Loading />}
        </Card>
        <Card title="Exchange rates" flush sub={fx.data?.latest ? `NRB, ${fx.data.latest}` : undefined}>
          {fx.data && <DataTable rows={fx.data.rows} cols={[
            { key: "currency", label: "Currency", render: (r) => <><strong>{r.currency}</strong>{r.unit !== 1 && <span className="tiny faint"> ×{r.unit}</span>}</> },
            { key: "sell", label: "Sell (Rs.)", num: true, render: (r) => num(r.sell) },
            { key: "change1m", label: "1M", num: true, render: (r) => pct(r.change1m, 1) },
            { key: "change1y", label: "1Y", num: true, render: (r) => pct(r.change1y, 1) },
          ]} />}
        </Card>
      </div>
      <Card title="Market breadth history" sub="Advancing minus declining stocks per session (from stored prices)">
        {breadth.data?.length ? <LineChart data={breadth.data.map((d) => ({ date: d.date, value: d.adv - d.dec }))} height={200} baseline={0} theme={theme} area={false} color="#60a5fa" /> : <Notice>Breadth history needs price history to be loaded.</Notice>}
      </Card>
    </div>
  );
}
