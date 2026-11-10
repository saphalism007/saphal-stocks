import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { Card, Loading, ErrorBox, DataTable, Score, Badge, Empty, Notice } from "../components/ui.tsx";
import { num, pct, tone, nptDate } from "../lib/format.ts";
import { I } from "../components/icons.tsx";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Watchlist() {
  const w = useApi<any[]>("/watchlists");
  const [name, setName] = useState("");
  const [add, setAdd] = useState<Record<number, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();
  if (w.loading && !w.data) return <Loading />;
  if (w.error) return <ErrorBox error={w.error} onRetry={w.reload} />;
  const addItem = async (id: number) => {
    const sym = (add[id] || "").trim().toUpperCase();
    if (!sym) return;
    try { await api(`/watchlists/${id}/items`, { body: { symbol: sym } }); setAdd({ ...add, [id]: "" }); setErr(null); w.reload(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Watchlists</h1><p>Track stocks you are researching, with targets, scores, trend and active setups.</p></div>
        <form className="row" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; await api("/watchlists", { body: { name } }); setName(""); w.reload(); }}>
          <input className="input" placeholder="New watchlist name" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn"><I.plus /> Create</button>
        </form>
      </div>
      {err && <Notice tone="warn">{err}</Notice>}
      {w.data?.map((l) => (
        <Card key={l.id} title={l.name} flush actions={<>
          <form className="row" onSubmit={(e) => { e.preventDefault(); void addItem(l.id); }}><input className="input" style={{ width: 130 }} placeholder="Add symbol" value={add[l.id] ?? ""} onChange={(e) => setAdd({ ...add, [l.id]: e.target.value.toUpperCase() })} /><button className="btn sm"><I.plus /></button></form>
          <button className="btn ghost sm danger" onClick={async () => { if (confirm(`Delete watchlist "${l.name}"?`)) { await api(`/watchlists/${l.id}`, { method: "DELETE" }); w.reload(); } }}><I.trash /></button>
        </>}>
          {l.items.length === 0 ? <Empty title="Empty watchlist">Add a symbol above, or use Watch on any stock page.</Empty> : (
            <DataTable rows={l.items} onRow={(i: any) => nav(`/stocks/${i.symbol}`)} cols={[
              { key: "symbol", label: "Stock", render: (i: any) => <><span className="sym">{i.symbol}</span><div className="tiny faint">{i.name}</div></> },
              { key: "close", label: "LTP", num: true, render: (i: any) => num(i.close) },
              { key: "changePct", label: "Chg", num: true, render: (i: any) => <span className={tone(i.changePct)}>{pct(i.changePct)}</span> },
              { key: "target_price", label: "Target", num: true, render: (i: any) => i.target_price ? <>{num(i.target_price)}<div className="tiny faint">{pct(((i.target_price - i.close) / i.close) * 100, 1)}</div></> : "-" },
              { key: "stop_price", label: "Stop", num: true, render: (i: any) => i.stop_price ? <span className={i.close <= i.stop_price ? "down" : ""}>{num(i.stop_price)}</span> : "-" },
              { key: "trend", label: "Trend", render: (i: any) => i.trend ? <Badge tone={i.trend === "uptrend" ? "up" : i.trend === "downtrend" ? "down" : ""}>{i.trend}</Badge> : "-" },
              { key: "rsi", label: "RSI", num: true, render: (i: any) => num(i.rsi, 0) },
              { key: "setup", label: "Setup", render: (i: any) => i.setup ? <Badge tone="up">{i.setup}</Badge> : <span className="faint">-</span> },
              { key: "fundamentalScore", label: "Fund.", num: true, render: (i: any) => <Score value={i.fundamentalScore} /> },
              { key: "technicalScore", label: "Tech.", num: true, render: (i: any) => <Score value={i.technicalScore} /> },
              { key: "note", label: "Note", render: (i: any) => <span className="small muted">{i.note ?? ""}</span> },
              { key: "added_at", label: "Added", render: (i: any) => <span className="tiny faint">{nptDate(i.added_at)}</span> },
              { key: "x", label: "", render: (i: any) => <button className="btn ghost sm" onClick={async (e) => { e.stopPropagation(); await api(`/watchlists/${l.id}/items/${i.symbol}`, { method: "DELETE" }); w.reload(); }}><I.x /></button> },
            ]} />
          )}
        </Card>
      ))}
    </div>
  );
}
