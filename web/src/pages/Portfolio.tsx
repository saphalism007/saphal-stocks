import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { Card, Stat, Loading, ErrorBox, Notice, Badge, Empty, DataTable, Score, Modal, Fresh, Tabs } from "../components/ui.tsx";
import { MultiLineChart, LineChart } from "../components/PriceChart.tsx";
import { useTheme } from "../App.tsx";
import { num, pct, tone, compact, int, nptDate, todayNpt, rs } from "../lib/format.ts";
import { I } from "../components/icons.tsx";
import { buyCost, sellCost } from "../../../shared/costs.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export default function Portfolio() {
  const { id } = useParams();
  const list = useApi<Any[]>("/portfolios");
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  if (list.loading && !list.data) return <Loading />;
  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />;
  const ports = list.data ?? [];
  const current = id ? Number(id) : ports[0]?.id;
  const totals = ports.filter((p) => p.kind === "real").reduce((a, p) => ({ mv: a.mv + p.marketValue, inv: a.inv + p.invested, un: a.un + p.unrealizedPnl, re: a.re + p.realizedPnl, dv: a.dv + p.dividends }), { mv: 0, inv: 0, un: 0, re: 0, dv: 0 });
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Portfolio</h1><p>Multiple baskets, weighted-average cost (WACC) with Nepal broker commission, SEBON fee, DP charge and capital gains tax.</p></div>
        <button className="btn primary" onClick={() => setCreating(true)}><I.plus /> New portfolio</button>
      </div>
      <div className="grid g4">
        <Stat label="Real portfolios: value" value={compact(totals.mv)} sub={`Invested ${compact(totals.inv)}`} />
        <Stat label="Unrealised P&L" value={compact(totals.un)} tone={tone(totals.un)} sub={totals.inv ? pct((totals.un / totals.inv) * 100) : ""} />
        <Stat label="Realised P&L (after tax)" value={compact(totals.re)} tone={tone(totals.re)} />
        <Stat label="Dividends (net)" value={compact(totals.dv)} />
      </div>
      <div className="pill-tabs">
        {ports.map((p) => <button key={p.id} className="chip" style={p.id === current ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined} onClick={() => nav(`/portfolio/${p.id}`)}>{p.name}{p.kind === "paper" && <Badge tone="blue">Paper</Badge>}<span className="mono tiny">{compact(p.marketValue)}</span></button>)}
      </div>
      {current ? <PortfolioDetail key={current} id={current} onChanged={list.reload} /> : <Empty title="No portfolios yet">Create your first portfolio to start tracking.</Empty>}
      {creating && <CreateModal onClose={() => setCreating(false)} onDone={(newId) => { setCreating(false); list.reload(); nav(`/portfolio/${newId}`); }} />}
    </div>
  );
}

function PortfolioDetail({ id, onChanged }: { id: number; onChanged: () => void }) {
  const d = useApi<Any>(`/portfolios/${id}`, [id]);
  const [adding, setAdding] = useState<null | "tx" | "paper" | "import">(null);
  const [view, setView] = useState<"holdings" | "performance" | "tax">("holdings");
  const [edit, setEdit] = useState<Any>(null);
  const nav = useNavigate();
  if (d.loading && !d.data) return <Loading />;
  if (d.error) return <ErrorBox error={d.error} onRetry={d.reload} />;
  const { portfolio: p, summary: s, health, sectors, extras, transactions, priceDate, cash } = d.data;
  const open = s.holdings.filter((h: Any) => h.quantity > 0);
  const closed = s.holdings.filter((h: Any) => h.quantity === 0 && (h.realizedPnl || h.dividendsReceived));
  const reload = () => { d.reload(); onChanged(); };
  const del = async () => { if (!confirm(`Delete portfolio "${p.name}" and all its transactions? This cannot be undone.`)) return; await api(`/portfolios/${id}`, { method: "DELETE" }); onChanged(); nav("/portfolio"); };
  return (
    <div className="col">
      <div className="row between">
        <div><h2>{p.name} {p.kind === "paper" && <Badge tone="blue">Paper trading</Badge>}</h2><div className="small muted">{p.strategy ?? ""} · <Fresh date={priceDate} /></div></div>
        <div className="row">
          {p.kind === "paper" ? <button className="btn primary" onClick={() => setAdding("paper")}><I.plus /> Paper order</button> : <button className="btn primary" onClick={() => setAdding("tx")}><I.plus /> Add transaction</button>}
          <button className="btn" onClick={() => setAdding("import")}><I.upload /> Import CSV</button>
          <a className="btn" href={`/api/portfolios/${id}/export/holdings.csv`}><I.download /> Holdings</a>
          <a className="btn" href={`/api/portfolios/${id}/export/transactions.csv`}><I.download /> Transactions</a>
          <Link className="btn" to={`/analyst?q=${encodeURIComponent(`Analyze my portfolio "${p.name}" (id ${id}): health, concentration, holdings with deteriorating fundamentals, what to hold, trim or review, and how to rebalance.`)}`}><I.ai /> AI review</Link>
          <button className="btn ghost danger" onClick={del} aria-label="Delete portfolio"><I.trash /></button>
        </div>
      </div>
      {s.missingPrices.length > 0 && <Notice tone="warn">No price available for {s.missingPrices.join(", ")}; valued at cost.</Notice>}
      <div className="grid g6">
        <Stat label="Market value" value={compact(s.marketValue)} sub={`Cost ${compact(s.invested)}`} />
        <Stat label="Unrealised" value={compact(s.unrealizedPnl)} tone={tone(s.unrealizedPnl)} sub={s.invested ? pct((s.unrealizedPnl / s.invested) * 100) : ""} />
        <Stat label="Realised (net)" value={compact(s.realizedPnl)} tone={tone(s.realizedPnl)} />
        <Stat label="Dividends (net)" value={compact(s.dividends)} />
        <Stat label="Total return" value={pct(s.totalReturnPct)} tone={tone(s.totalReturnPct)} sub={`on ${compact(s.cashIn)} invested`} />
        {p.kind === "paper" ? <Stat label="Paper cash" value={compact(cash)} sub={`Start ${compact(p.paper_cash)}`} /> : <Stat label="Health score" value={health ? <Score value={health.score} /> : "—"} sub={health ? `${health.diversification.holdings} holdings · ${health.diversification.sectorCount} sectors` : ""} />}
      </div>
      <Tabs value={view} onChange={setView} tabs={[{ key: "holdings", label: "Holdings & transactions" }, { key: "performance", label: "Performance vs NEPSE" }, { key: "tax", label: "Tax report" }]} />
      {view === "performance" && <Performance id={id} />}
      {view === "tax" && <TaxReport id={id} />}
      {view === "holdings" && <>
      <div className="grid g3">
        <Card title="Holdings" className="span2" flush>
          <DataTable rows={open} onRow={(h: Any) => nav(`/stocks/${h.symbol}`)} empty="No open positions" cols={[
            { key: "symbol", label: "Stock", render: (h: Any) => <><span className="sym">{h.symbol}</span><div className="tiny faint">{sectors[h.symbol]}</div></> },
            { key: "quantity", label: "Qty", num: true, render: (h: Any) => int(h.quantity) },
            { key: "wacc", label: "WACC", num: true, render: (h: Any) => num(h.wacc) },
            { key: "lastPrice", label: "LTP", num: true, render: (h: Any) => num(h.lastPrice) },
            { key: "marketValue", label: "Value", num: true, render: (h: Any) => compact(h.marketValue) },
            { key: "weight", label: "Weight", num: true, sort: (h: Any) => h.marketValue, render: (h: Any) => `${num(((h.marketValue ?? h.costBasis) / (s.marketValue || 1)) * 100, 1)}%` },
            { key: "unrealizedPnl", label: "P&L", num: true, render: (h: Any) => <span className={tone(h.unrealizedPnl)}>{compact(h.unrealizedPnl)}<div className="tiny">{pct(h.unrealizedPct, 1)}</div></span> },
            { key: "netIfSoldToday", label: "Net if sold", num: true, title: "After sell charges and estimated CGT", render: (h: Any) => compact(h.netIfSoldToday) },
            { key: "f", label: "Fund.", num: true, sort: (h: Any) => extras[h.symbol]?.fundamentalScore, render: (h: Any) => <Score value={extras[h.symbol]?.fundamentalScore} /> },
            { key: "t", label: "Tech.", num: true, sort: (h: Any) => extras[h.symbol]?.technicalScore, render: (h: Any) => <Score value={extras[h.symbol]?.technicalScore} /> },
          ]} />
        </Card>
        <div className="col">
          <Card title="Sector exposure">
            {health?.sectorExposure?.length ? health.sectorExposure.map((x: Any) => (
              <div key={x.sector} style={{ marginBottom: 8 }}>
                <div className="row between small"><span>{x.sector}</span><span className="mono">{num(x.weightPct, 1)}%</span></div>
                <div className="bar"><span style={{ width: `${x.weightPct}%`, background: x.weightPct > 40 ? "var(--warn)" : "var(--accent)" }} /></div>
              </div>
            )) : <Empty title="No holdings" />}
          </Card>
          {health && <Card title="Portfolio health">
            {health.issues.map((x: string) => <div key={x} className="small warn" style={{ marginBottom: 4 }}>⚠ {x}</div>)}
            {health.positives.map((x: string) => <div key={x} className="small up" style={{ marginBottom: 4 }}>✓ {x}</div>)}
            <div className="tiny faint" style={{ marginTop: 6 }}>Top holding {health.diversification.topWeightPct}% · top 3 {health.diversification.top3WeightPct}% · concentration (HHI) {health.diversification.hhi}</div>
          </Card>}
        </div>
      </div>
      {closed.length > 0 && <Card title="Closed positions" flush><DataTable rows={closed} cols={[{ key: "symbol", label: "Stock", render: (h: Any) => <span className="sym">{h.symbol}</span> }, { key: "realizedPnl", label: "Realised (net)", num: true, render: (h: Any) => <span className={tone(h.realizedPnl)}>{compact(h.realizedPnl)}</span> }, { key: "dividendsReceived", label: "Dividends", num: true, render: (h: Any) => compact(h.dividendsReceived) }]} /></Card>}
      <Card title={`Transactions (${transactions.length})`} flush>
        <DataTable rows={[...transactions].reverse()} empty="No transactions yet" cols={[
          { key: "date", label: "Date", render: (t: Any) => nptDate(t.date) },
          { key: "symbol", label: "Stock", render: (t: Any) => <span className="sym">{t.symbol}</span> },
          { key: "type", label: "Type", render: (t: Any) => <Badge tone={["buy", "ipo", "right", "bonus", "merger_in"].includes(t.type) ? "up" : t.type === "cash_dividend" ? "blue" : "down"}>{t.type.replace("_", " ")}</Badge> },
          { key: "quantity", label: "Qty", num: true, render: (t: Any) => t.type === "cash_dividend" ? "—" : int(t.quantity) },
          { key: "price", label: "Price / amount", num: true, render: (t: Any) => num(t.price) },
          { key: "charges", label: "Charges", num: true, render: (t: Any) => t.commission != null || t.otherCharges != null ? num((t.commission ?? 0) + (t.otherCharges ?? 0)) : <span className="faint">auto</span> },
          { key: "notes", label: "Notes", render: (t: Any) => <span className="small muted">{t.notes ?? ""}</span> },
          { key: "x", label: "", render: (t: Any) => <span className="row" style={{ flexWrap: "nowrap" }}><button className="btn ghost sm" onClick={() => setEdit(t)}>Edit</button><button className="btn ghost sm danger" onClick={async () => { if (confirm("Delete this transaction?")) { await api(`/transactions/${t.id}`, { method: "DELETE" }); reload(); } }}><I.trash /></button></span> },
        ]} />
      </Card>
      </>}
      {(adding === "tx" || edit) && <TxModal portfolioId={id} tx={edit} onClose={() => { setAdding(null); setEdit(null); }} onDone={() => { setAdding(null); setEdit(null); reload(); }} />}
      {adding === "paper" && <PaperModal portfolioId={id} cash={cash} onClose={() => setAdding(null)} onDone={() => { setAdding(null); reload(); }} />}
      {adding === "import" && <ImportModal portfolioId={id} onClose={() => setAdding(null)} onDone={() => { setAdding(null); reload(); }} />}
    </div>
  );
}

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const [f, setF] = useState({ name: "", kind: "real", strategy: "Long-term", paperCash: 1000000 });
  const [err, setErr] = useState<string | null>(null);
  const save = async () => { try { const r = await api<{ id: number }>("/portfolios", { body: { ...f, paperCash: +f.paperCash } }); onDone(r.id); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  return (
    <Modal title="New portfolio" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Create</button></>}>
      <div className="col">
        <label className="field">Name<input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Dividend portfolio" autoFocus /></label>
        <div className="grid g2">
          <label className="field">Type<select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="real">Real money</option><option value="paper">Paper trading (simulated)</option></select></label>
          <label className="field">Strategy<select className="input" value={f.strategy} onChange={(e) => setF({ ...f, strategy: e.target.value })}>{["Long-term", "Swing trading", "Dividend", "Growth", "Value", "Experimental"].map((x) => <option key={x}>{x}</option>)}</select></label>
        </div>
        {f.kind === "paper" && <label className="field">Starting paper cash (Rs.)<input className="input" type="number" value={f.paperCash} onChange={(e) => setF({ ...f, paperCash: +e.target.value })} /></label>}
        {err && <Notice tone="warn">{err}</Notice>}
      </div>
    </Modal>
  );
}

function TxModal({ portfolioId, tx, onClose, onDone }: { portfolioId: number; tx?: Any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ symbol: tx?.symbol ?? "", type: tx?.type ?? "buy", date: tx?.date ?? todayNpt(), quantity: tx?.quantity ?? "", price: tx?.price ?? "", commission: tx?.commission ?? "", otherCharges: tx?.otherCharges ?? "", tax: tx?.tax ?? "", notes: tx?.notes ?? "" });
  const [err, setErr] = useState<string | null>(null);
  const q = +f.quantity, pr = +f.price;
  const est = q > 0 && pr > 0 ? (f.type === "buy" ? buyCost(q, pr) : f.type === "sell" ? sellCost(q, pr) : null) : null;
  const priceLabel = f.type === "cash_dividend" ? "Total cash received before tax (Rs.)" : f.type === "bonus" ? "Cost per share (Rs. 100 face value by default)" : "Price per share (Rs.)";
  const save = async () => {
    const body = { symbol: f.symbol.toUpperCase(), type: f.type, date: f.date, quantity: f.type === "cash_dividend" ? 0 : +f.quantity, price: +f.price, commission: f.commission === "" ? null : +f.commission, otherCharges: f.otherCharges === "" ? null : +f.otherCharges, tax: f.tax === "" ? null : +f.tax, notes: f.notes || null };
    try { if (tx) await api(`/transactions/${tx.id}`, { method: "PUT", body }); else await api(`/portfolios/${portfolioId}/transactions`, { body }); onDone(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={tx ? "Edit transaction" : "Add transaction"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="col">
        <div className="grid g3">
          <label className="field">Symbol<input className="input" value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })} autoFocus /></label>
          <label className="field">Type<select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, price: e.target.value === "bonus" && !f.price ? "100" : f.price })}>
            <option value="buy">Buy</option><option value="sell">Sell</option><option value="ipo">IPO allotment</option><option value="right">Right shares</option><option value="bonus">Bonus shares</option><option value="cash_dividend">Cash dividend</option><option value="merger_in">Merger (shares in)</option><option value="merger_out">Merger (shares out)</option>
          </select></label>
          <label className="field">Date<input className="input" type="date" value={f.date} onChange={set("date")} /></label>
        </div>
        <div className="grid g2">
          {f.type !== "cash_dividend" && <label className="field">Quantity<input className="input" type="number" value={f.quantity} onChange={set("quantity")} /></label>}
          <label className="field">{priceLabel}<input className="input" type="number" step="0.01" value={f.price} onChange={set("price")} /></label>
        </div>
        <details><summary className="small muted">Charges & tax (leave blank to auto-calculate)</summary>
          <div className="grid g3" style={{ marginTop: 8 }}>
            <label className="field">Broker commission<input className="input" type="number" value={f.commission} placeholder={est ? num(est.commission) : "auto"} onChange={set("commission")} /></label>
            <label className="field">SEBON + DP etc.<input className="input" type="number" value={f.otherCharges} placeholder={est ? num(est.sebonFee + est.dpCharge) : "auto"} onChange={set("otherCharges")} /></label>
            <label className="field">{f.type === "sell" ? "CGT withheld" : f.type === "cash_dividend" ? "Dividend tax (5% if blank)" : "Tax paid"}<input className="input" type="number" value={f.tax} placeholder="auto" onChange={set("tax")} /></label>
          </div>
        </details>
        {est && <div className="small muted">Estimated: amount {rs(est.amount)} · commission {rs(est.commission)} · SEBON {rs(est.sebonFee)}{est.dpCharge ? ` · DP ${rs(est.dpCharge)}` : ""} · {f.type === "buy" ? "total cost" : "net proceeds before CGT"} <strong>{rs(est.net)}</strong></div>}
        <label className="field">Notes<textarea className="input" value={f.notes} onChange={set("notes")} style={{ minHeight: 50 }} /></label>
        {err && <Notice tone="warn">{err}</Notice>}
      </div>
    </Modal>
  );
}

function PaperModal({ portfolioId, cash, onClose, onDone }: { portfolioId: number; cash: number; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ symbol: "", side: "buy", quantity: "", price: "" });
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Any>(null);
  const save = async () => { try { setRes(await api(`/portfolios/${portfolioId}/paper-order`, { body: { symbol: f.symbol, side: f.side, quantity: +f.quantity, price: f.price ? +f.price : undefined } })); setTimeout(onDone, 900); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  return (
    <Modal title="Paper order (simulated)" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Place paper order</button></>}>
      <div className="col">
        <Notice>No real money moves. Orders fill at the latest close (or your price) with Nepal fees applied. Paper cash available: {rs(cash)}.</Notice>
        <div className="grid g2">
          <label className="field">Symbol<input className="input" value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })} autoFocus /></label>
          <label className="field">Side<select className="input" value={f.side} onChange={(e) => setF({ ...f, side: e.target.value })}><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
          <label className="field">Quantity<input className="input" type="number" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></label>
          <label className="field">Price (blank = last close)<input className="input" type="number" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
        </div>
        {res && <Notice>Filled at Rs. {num(res.price)} on {nptDate(res.date)}; charges Rs. {num(res.estCharges)}.</Notice>}
        {err && <Notice tone="warn">{err}</Notice>}
      </div>
    </Modal>
  );
}

function ImportModal({ portfolioId, onClose, onDone }: { portfolioId: number; onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState("");
  const [res, setRes] = useState<Any>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => { try { const r = await api<Any>(`/portfolios/${portfolioId}/import-csv`, { body: { csv } }); setRes(r); if (!r.errors.length) setTimeout(onDone, 800); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  return (
    <Modal title="Import transactions (CSV)" onClose={onClose} footer={<><button className="btn" onClick={res ? onDone : onClose}>{res ? "Done" : "Cancel"}</button><button className="btn primary" onClick={go} disabled={!csv.trim()}>Import</button></>}>
      <div className="col">
        <p className="small muted">One transaction per line: <code>date,symbol,type,quantity,price[,commission,other_charges,tax,notes]</code>. Types: buy, sell, ipo, right, bonus, cash_dividend. Blank charges are calculated automatically.</p>
        <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
        <textarea className="input mono" style={{ minHeight: 160, fontSize: 12 }} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"2025-01-15,NABIL,buy,100,505\n2025-06-10,NABIL,bonus,5,100\n2025-12-20,NABIL,cash_dividend,0,1250"} />
        {res && <Notice tone={res.errors.length ? "warn" : "info"}>Imported {res.imported}. {res.errors.slice(0, 8).join(" ")}</Notice>}
        {err && <Notice tone="warn">{err}</Notice>}
      </div>
    </Modal>
  );
}

function Performance({ id }: { id: number }) {
  const h = useApi<Any>(`/portfolios/${id}/history`, [id]);
  const { theme } = useTheme();
  if (h.loading && !h.data) return <Loading label="Rebuilding daily portfolio values" />;
  if (h.error) return <ErrorBox error={h.error} />;
  const st = h.data?.stats;
  if (!st) return <Empty title="No transactions yet">Add transactions to see performance over time.</Empty>;
  const pts = h.data.points as Any[];
  return (
    <div className="col">
      <div className="grid g4">
        <Stat label="Your return (time-weighted)" value={pct(st.twrPct, 1)} tone={tone(st.twrPct)} sub={st.twrAnnualPct != null ? `${pct(st.twrAnnualPct, 1)} per year` : `since ${nptDate(st.from)}`} />
        <Stat label="NEPSE index, same period" value={pct(st.benchmarkPct, 1)} tone={tone(st.benchmarkPct)} sub={st.benchmarkPct != null ? (st.twrPct > st.benchmarkPct ? <span className="up">You beat the index by {num(st.twrPct - st.benchmarkPct, 1)} pts</span> : <span className="down">Index ahead by {num(st.benchmarkPct - st.twrPct, 1)} pts</span>) : ""} />
        <Stat label="Max drawdown" value={`-${num(st.maxDrawdownPct, 1)}%`} tone="down" sub="Largest fall from a peak" />
        <Stat label="Value vs net invested" value={compact(st.value)} sub={`Net invested ${compact(st.netInvested)}`} />
      </div>
      <Card title="Return index vs NEPSE (both start at 100)">
        <MultiLineChart series={[{ name: "Portfolio", data: pts.map((p) => ({ date: p.date, value: p.twrIndex })) }, { name: "NEPSE", data: pts.filter((p) => p.benchmark != null).map((p) => ({ date: p.date, value: p.benchmark })) }]} baseline={100} theme={theme} />
        <div className="legend" style={{ marginTop: 6 }}><span><i style={{ background: "#34d399" }} />Portfolio</span><span><i style={{ background: "#60a5fa" }} />NEPSE index</span></div>
      </Card>
      <Card title="Portfolio value (Rs.)"><LineChart data={pts.map((p) => ({ date: p.date, value: p.value }))} height={220} theme={theme} /></Card>
      <p className="tiny faint">{h.data.method}</p>
    </div>
  );
}

function TaxReport({ id }: { id: number }) {
  const [fyStart, setFyStart] = useState<string | null>(null);
  const t = useApi<Any>(`/portfolios/${id}/tax-report${fyStart ? `?fyStart=${fyStart}` : ""}`, [id, fyStart]);
  if (t.loading && !t.data) return <Loading />;
  if (t.error) return <ErrorBox error={t.error} />;
  const d = t.data;
  return (
    <div className="col">
      <div className="row between">
        <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>Fiscal year starts (MM-DD)<input className="input" style={{ width: 90 }} defaultValue={d.fyStart} onBlur={(e) => /^\d{2}-\d{2}$/.test(e.target.value) && setFyStart(e.target.value)} /></label>
        <a className="btn" href={`/api/portfolios/${id}/export/tax.csv`}><I.download /> Download tax CSV</a>
      </div>
      <Card title="By fiscal year" flush>
        <DataTable rows={d.years} empty="No sales or dividends recorded" cols={[
          { key: "fy", label: "Fiscal year" }, { key: "sells", label: "Sales", num: true },
          { key: "realizedGain", label: "Gains", num: true, render: (r: Any) => <span className="up">{rs(r.realizedGain, 0)}</span> },
          { key: "realizedLoss", label: "Losses", num: true, render: (r: Any) => <span className="down">{rs(r.realizedLoss, 0)}</span> },
          { key: "cgt", label: "Capital gains tax", num: true, render: (r: Any) => <>{rs(r.cgt, 0)}{r.cgtEstimated && <div className="tiny warn">includes estimates</div>}</> },
          { key: "dividendsGross", label: "Cash dividends (gross)", num: true, render: (r: Any) => rs(r.dividendsGross, 0) },
          { key: "dividendTax", label: "Dividend tax", num: true, render: (r: Any) => rs(r.dividendTax, 0) },
        ]} />
      </Card>
      <Card title="Sales" flush>
        <DataTable rows={d.sells} empty="No sales" cols={[
          { key: "date", label: "Date", render: (e: Any) => nptDate(e.date) }, { key: "fy", label: "FY" }, { key: "symbol", label: "Stock", render: (e: Any) => <span className="sym">{e.symbol}</span> },
          { key: "qty", label: "Qty", num: true, render: (e: Any) => int(e.qty) }, { key: "proceeds", label: "Net proceeds", num: true, render: (e: Any) => rs(e.proceeds, 0) },
          { key: "costBasis", label: "WACC cost", num: true, render: (e: Any) => rs(e.costBasis, 0) }, { key: "gain", label: "Gain", num: true, render: (e: Any) => <span className={tone(e.gain)}>{rs(e.gain, 0)}</span> },
          { key: "holdingDays", label: "Held", num: true, render: (e: Any) => <>{e.holdingDays} d <Badge tone={e.longTerm ? "up" : "warn"}>{e.longTerm ? "long" : "short"}</Badge></> },
          { key: "tax", label: "CGT", num: true, render: (e: Any) => <>{rs(e.tax, 0)}{e.taxEstimated && <span className="tiny warn"> est.</span>}</> },
        ]} />
      </Card>
      <ul className="tiny faint" style={{ paddingLeft: 18 }}>{d.notes.map((n: string) => <li key={n}>{n}</li>)}</ul>
    </div>
  );
}
