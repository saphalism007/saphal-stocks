// Floorsheet: each session's trades summarised by stock (trades, shares, average price, buyers and
// sellers) and by broker (bought, sold, net), with each stock's broker breakdown.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../lib/api.ts";
import { Card, Loading, Empty, Stat, Seg, DataTable, Modal } from "../components/ui.tsx";
import { compact, int, num, nptDate, tone } from "../lib/format.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export default function Floorsheet() {
  const [date, setDate] = useState<string | undefined>(undefined);
  const f = useApi<Any>(`/market/floorsheet${date ? `?date=${date}` : ""}`, [date]);
  const [view, setView] = useState<"stocks" | "brokers">("stocks");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  if (!f.data && !f.error) return <div className="page"><Loading /></div>;
  if (!f.data) return <div className="page"><Empty title="Floorsheet not available yet">It is collected after each trading day by the data refresh.</Empty></div>;
  const d = f.data;
  const term = q.trim().toLowerCase();
  const rows = d.rows.filter((r: Any) => !term || r.symbol.toLowerCase().includes(term) || (r.name ?? "").toLowerCase().includes(term));
  const brokers = d.brokers.filter((b: Any) => !term || String(b.broker) === term);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Floorsheet</h1><p className="small muted">Every trade on NEPSE, summarised by stock and by broker. Session {nptDate(d.date)}. Source: ShareSansar floorsheet.</p></div>
        <select className="input" value={d.date} onChange={(e) => setDate(e.target.value)}>{d.dates.map((x: string) => <option key={x} value={x}>{nptDate(x)}</option>)}</select>
      </div>
      <div className="grid g3">
        <Stat label="Total trades" value={int(d.totals?.trades)} />
        <Stat label="Shares traded" value={int(d.totals?.qty)} />
        <Stat label="Turnover" value={compact(d.totals?.amount)} />
      </div>
      <Card title={view === "stocks" ? `By stock (${rows.length})` : `By broker (${brokers.length})`} actions={<><input className="input" style={{ width: 160 }} placeholder={view === "stocks" ? "Stock" : "Broker number"} value={q} onChange={(e) => setQ(e.target.value)} /><Seg value={view} onChange={setView} options={[{ key: "stocks", label: "Stocks" }, { key: "brokers", label: "Brokers" }]} /></>}>
        {view === "stocks" ? (
          <DataTable rows={rows} rowKey={(r: Any) => r.symbol} onRow={(r: Any) => setOpen(r.symbol)} maxHeight={600} initialSort={{ key: "amount", dir: -1 }} cols={[
            { key: "symbol", label: "Stock", render: (r: Any) => <span><span className="sym">{r.symbol}</span><span className="tiny faint" style={{ display: "block" }}>{r.buyers} buyers, {r.sellers} sellers</span></span> },
            { key: "trades", label: "Trades", num: true, render: (r: Any) => int(r.trades) },
            { key: "qty", label: "Shares", num: true, render: (r: Any) => int(r.qty) },
            { key: "wacc", label: "Avg price", num: true, render: (r: Any) => num(r.wacc) },
            { key: "low", label: "Range", num: true, render: (r: Any) => `${num(r.low)}-${num(r.high)}` },
            { key: "amount", label: "Turnover", num: true, render: (r: Any) => compact(r.amount) },
          ]} />
        ) : (
          <DataTable rows={brokers} rowKey={(b: Any) => b.broker} maxHeight={600} initialSort={{ key: "buy", dir: -1 }} cols={[
            { key: "broker", label: "Broker", render: (b: Any) => <span className="sym">#{b.broker}</span> },
            { key: "buy", label: "Bought", num: true, render: (b: Any) => compact(b.buy) },
            { key: "sell", label: "Sold", num: true, render: (b: Any) => compact(b.sell) },
            { key: "net", label: "Net", num: true, render: (b: Any) => <span className={tone(b.net)}>{compact(b.net)}</span> },
            { key: "stocks", label: "Stocks", num: true },
          ]} />
        )}
        <p className="tiny faint" style={{ marginTop: 8 }}>Tap a stock to see which brokers bought and sold it. Brokers are shown by NEPSE broker number (list: <a href="https://www.nepalstock.com/members" target="_blank" rel="noopener noreferrer">nepalstock.com/members</a>).</p>
      </Card>
      {open && <Modal title={`${open}, broker activity`} onClose={() => setOpen(null)}><BrokerActivity symbol={open} /></Modal>}
    </div>
  );
}

export function BrokerActivity({ symbol }: { symbol: string }) {
  const b = useApi<Any>(`/stocks/${symbol}/brokers`, [symbol]);
  if (!b.data && !b.error) return <Loading />;
  if (!b.data) return <Empty title="No floorsheet stored for this stock" />;
  const d = b.data;
  const T = ({ rows, buy }: { rows: Any[]; buy: boolean }) => (
    <table className="t small"><thead><tr><th>Broker</th><th className="num">Net shares</th><th className="num">{buy ? "Avg buy" : "Avg sell"}</th></tr></thead>
      <tbody>{rows.filter((r) => (buy ? r.netQty > 0 : r.netQty < 0)).map((r: Any) => <tr key={r.broker}><td>#{r.broker}</td><td className={`num ${buy ? "up" : "down"}`}>{int(r.netQty)}</td><td className="num">{num(buy ? r.buyWacc : r.sellWacc)}</td></tr>)}</tbody></table>
  );
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="small muted">{d.sessions} session{d.sessions > 1 ? "s" : ""}: {nptDate(d.from)} - {nptDate(d.to)}</div>
      <div className="grid g2"><div><h4 className="small up">Top net buyers</h4><T rows={d.topBuyers} buy /></div><div><h4 className="small down">Top net sellers</h4><T rows={d.topSellers} buy={false} /></div></div>
      <table className="t small"><thead><tr><th>Session</th><th className="num">Trades</th><th className="num">Shares</th><th className="num">Avg price</th><th className="num">Buyers / sellers</th></tr></thead>
        <tbody>{d.days.map((x: Any) => <tr key={x.date}><td>{nptDate(x.date)}</td><td className="num">{int(x.trades)}</td><td className="num">{int(x.qty)}</td><td className="num">{num(x.wacc)}</td><td className="num">{x.buyers} / {x.sellers}</td></tr>)}</tbody></table>
      <p className="tiny faint">{d.note} <Link to={`/stocks/${symbol}`}>Open {symbol}</Link></p>
    </div>
  );
}
