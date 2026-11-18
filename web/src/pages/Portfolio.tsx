import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { downloadFromApi } from "../lib/backend.ts";
import { Card, Stat, Loading, ErrorBox, Notice, Badge, Empty, DataTable, Score, Modal, Fresh, Tabs, NumInput } from "../components/ui.tsx";
import { MultiLineChart, LineChart } from "../components/PriceChart.tsx";
import { useTheme } from "../App.tsx";
import { num, pct, tone, compact, int, nptDate, todayNpt, rs } from "../lib/format.ts";
import { I } from "../components/icons.tsx";
import { buyCost, sellCost, cgtRate, DEFAULT_FEES, type FeeConfig } from "../../../shared/costs.ts";
import { SymbolPicker, useSymbols } from "../components/SymbolPicker.tsx";
import { rebalancePlan, chargesFor } from "../../../shared/portfolio.ts";

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
  const [view, setView] = useState<"holdings" | "performance" | "tax" | "rebalance">("holdings");
  const [edit, setEdit] = useState<Any>(null);
  const nav = useNavigate();
  const feesApi = useApi<Any>("/settings/fees");
  const feeCfg: FeeConfig = feesApi.data?.current ?? DEFAULT_FEES;
  if (d.loading && !d.data) return <Loading />;
  if (d.error) return <ErrorBox error={d.error} onRetry={d.reload} />;
  const { portfolio: p, summary: s, health, sectors, extras, transactions, priceDate, cash, day = {} } = d.data;
  const open = s.holdings.filter((h: Any) => h.quantity > 0);
  // Today's gain: each holding's move since yesterday's close. Shares bought today are left out (their cost is today's price).
  const today = (() => {
    let pnl = 0, base = 0, live = false, date: string | null = null;
    for (const h of open) {
      const q = day[h.symbol]; if (!q || q.prevClose == null) continue;
      date = date && date > q.date ? date : q.date; live = live || q.live;
      for (const lot of h.lots ?? []) { if (lot.date >= q.date) continue; pnl += lot.qty * (q.close - q.prevClose); base += lot.qty * q.prevClose; }
    }
    return { pnl, pctv: base ? (pnl / base) * 100 : null, live, date };
  })();
  const dayOf = (h: Any) => {
    const q = day[h.symbol]; if (!q || q.prevClose == null) return null;
    const qty = (h.lots ?? []).reduce((t: number, l: Any) => t + (l.date < q.date ? l.qty : 0), 0);
    return { chg: (q.close - q.prevClose) * qty, pctv: q.changePct };
  };
  const closed = s.holdings.filter((h: Any) => h.quantity === 0 && (h.realizedPnl || h.dividendsReceived));
  const reload = () => { d.reload(); onChanged(); };
  const del = async () => { if (!confirm(`Delete portfolio "${p.name}" and all its transactions? This cannot be undone.`)) return; await api(`/portfolios/${id}`, { method: "DELETE" }); onChanged(); nav("/portfolio"); };
  return (
    <div className="col">
      <div className="row between">
        <div><h2>{p.name} {p.kind === "paper" && <Badge tone="blue">Paper trading</Badge>}</h2><div className="small muted">{p.strategy ?? ""}, <Fresh date={priceDate} /></div></div>
        <div className="row">
          {p.kind === "paper" ? <button className="btn primary" onClick={() => setAdding("paper")}><I.plus /> Paper order</button> : <button className="btn primary" onClick={() => setAdding("tx")}><I.plus /> Add transaction</button>}
          <button className="btn" onClick={() => setAdding("import")}><I.upload /> Import CSV</button>
          <button className="btn" onClick={() => downloadFromApi(`/api/portfolios/${id}/export/holdings.csv`)}><I.download /> Holdings</button>
          <button className="btn" onClick={() => downloadFromApi(`/api/portfolios/${id}/export/transactions.csv`)}><I.download /> Transactions</button>
          <Link className="btn" to={`/analyst?q=${encodeURIComponent(`Analyze my portfolio "${p.name}" (id ${id}): health, concentration, holdings with deteriorating fundamentals, what to hold, trim or review, and how to rebalance.`)}`}><I.ai /> AI review</Link>
          <button className="btn ghost danger" onClick={del} aria-label="Delete portfolio"><I.trash /></button>
        </div>
      </div>
      {s.missingPrices.length > 0 && <Notice tone="warn">No price available for {s.missingPrices.join(", ")}; valued at cost.</Notice>}
      <div className="grid g6">
        <Stat label="Market value" value={compact(s.marketValue)} sub={`Cost ${compact(s.invested)}`} />
        <Stat label={<>Today {today.live && <Badge tone="up">live</Badge>}</>} value={today.pctv == null ? "-" : compact(today.pnl)} tone={tone(today.pnl)} sub={today.pctv == null ? (open.length ? "Shares bought today count from tomorrow" : "No holdings yet") : `${pct(today.pctv)}${today.date ? `, ${nptDate(today.date)}` : ""}`} />
        <Stat label="Unrealised" value={compact(s.unrealizedPnl)} tone={tone(s.unrealizedPnl)} sub={s.invested ? pct((s.unrealizedPnl / s.invested) * 100) : ""} />
        <Stat label="Realised (after tax)" value={compact(s.realizedPnl)} tone={tone(s.realizedPnl)} />
        <Stat label="Dividends (net)" value={compact(s.dividends)} />
        {p.kind === "paper" ? <Stat label="Paper cash" value={compact(cash)} sub={`Start ${compact(p.paper_cash)}`} /> : <Stat label="Total return" value={pct(s.totalReturnPct)} tone={tone(s.totalReturnPct)} sub={`on ${compact(s.cashIn)} invested`} />}
      </div>
      <Tabs value={view} onChange={setView} tabs={[{ key: "holdings", label: "Holdings & transactions" }, { key: "performance", label: "Performance vs NEPSE" }, { key: "tax", label: "Tax report" }, { key: "rebalance", label: "Rebalance" }]} />
      {view === "performance" && <Performance id={id} />}
      {view === "rebalance" && <Rebalance summary={s} sectors={sectors} extras={extras} />}
      {view === "tax" && <TaxReport id={id} />}
      {view === "holdings" && <>
      <div className="grid g3">
        <Card title={`Holdings (${open.length})`} className="span2" flush>
          <div className="show-phone hold-cards">
            {open.length === 0 ? <Empty title="No open positions" /> : [...open].sort((a: Any, b: Any) => (b.marketValue ?? b.costBasis) - (a.marketValue ?? a.costBasis)).map((h: Any) => { const dd = dayOf(h); return (
              <button key={h.symbol} className="hold-card" onClick={() => nav(`/stocks/${h.symbol}`)}>
                <div className="row between"><span><span className="sym">{h.symbol}</span> <span className="tiny faint">{int(h.quantity)} kitta</span></span><span className="mono">{compact(h.marketValue ?? h.costBasis)}</span></div>
                <div className="row between tiny"><span className="faint">WACC {num(h.wacc)}, LTP {num(h.lastPrice)}</span><span className={tone(h.unrealizedPnl)}>{compact(h.unrealizedPnl)} ({pct(h.unrealizedPct, 1)})</span></div>
                <div className="row between tiny"><span className="faint">{sectors[h.symbol]}</span>{dd && <span className={tone(dd.chg)}>Today {compact(dd.chg)} ({pct(dd.pctv, 2)})</span>}</div>
              </button>
            ); })}
          </div>
          <div className="hide-phone"><DataTable rows={open} onRow={(h: Any) => nav(`/stocks/${h.symbol}`)} empty="No open positions" cols={[
            { key: "symbol", label: "Stock", render: (h: Any) => <><span className="sym">{h.symbol}</span><div className="tiny faint">{sectors[h.symbol]}</div></> },
            { key: "quantity", label: "Qty", num: true, render: (h: Any) => int(h.quantity) },
            { key: "wacc", label: "WACC", num: true, render: (h: Any) => num(h.wacc) },
            { key: "lastPrice", label: "LTP", num: true, render: (h: Any) => num(h.lastPrice) },
            { key: "today", label: "Today", num: true, sort: (h: Any) => dayOf(h)?.pctv ?? 0, render: (h: Any) => { const dd = dayOf(h); return dd ? <span className={tone(dd.chg)}>{compact(dd.chg)}<div className="tiny">{pct(dd.pctv, 2)}</div></span> : "-"; } },
            { key: "marketValue", label: "Value", num: true, render: (h: Any) => compact(h.marketValue) },
            { key: "weight", label: "Weight", num: true, sort: (h: Any) => h.marketValue, render: (h: Any) => `${num(((h.marketValue ?? h.costBasis) / (s.marketValue || 1)) * 100, 1)}%` },
            { key: "unrealizedPnl", label: "P&L", num: true, render: (h: Any) => <span className={tone(h.unrealizedPnl)}>{compact(h.unrealizedPnl)}<div className="tiny">{pct(h.unrealizedPct, 1)}</div></span> },
            { key: "netIfSoldToday", label: "Net if sold", num: true, title: "After sell charges and estimated CGT", render: (h: Any) => compact(h.netIfSoldToday) },
            { key: "f", label: "Fund.", num: true, sort: (h: Any) => extras[h.symbol]?.fundamentalScore, render: (h: Any) => <Score value={extras[h.symbol]?.fundamentalScore} /> },
            { key: "t", label: "Tech.", num: true, sort: (h: Any) => extras[h.symbol]?.technicalScore, render: (h: Any) => <Score value={extras[h.symbol]?.technicalScore} /> },
          ]} /></div>
        </Card>
        <div className="col">
          {open.length > 0 && <Card title="Allocation"><Donut items={open.map((h: Any) => ({ label: h.symbol, value: h.marketValue ?? h.costBasis }))} /></Card>}
          <Card title="Sector exposure">
            {health?.sectorExposure?.length ? health.sectorExposure.map((x: Any) => (
              <div key={x.sector} style={{ marginBottom: 8 }}>
                <div className="row between small"><span>{x.sector}</span><span className="mono">{num(x.weightPct, 1)}%</span></div>
                <div className="bar"><span style={{ width: `${x.weightPct}%`, background: x.weightPct > 40 ? "var(--warn)" : "var(--accent)" }} /></div>
              </div>
            )) : <Empty title="No holdings" />}
          </Card>
          {health && <Card title="Portfolio health" actions={<Score value={health.score} />}>
            {health.issues.map((x: string) => <div key={x} className="small warn" style={{ marginBottom: 4 }}>⚠ {x}</div>)}
            {health.positives.map((x: string) => <div key={x} className="small up" style={{ marginBottom: 4 }}>✓ {x}</div>)}
            <div className="tiny faint" style={{ marginTop: 6 }}>Top holding {health.diversification.topWeightPct}%, top 3 {health.diversification.top3WeightPct}%, concentration (HHI) {health.diversification.hhi}</div>
          </Card>}
        </div>
      </div>
      {closed.length > 0 && <Card title="Closed positions" flush><DataTable rows={closed} cols={[{ key: "symbol", label: "Stock", render: (h: Any) => <span className="sym">{h.symbol}</span> }, { key: "realizedPnl", label: "Realised (net)", num: true, render: (h: Any) => <span className={tone(h.realizedPnl)}>{compact(h.realizedPnl)}</span> }, { key: "dividendsReceived", label: "Dividends", num: true, render: (h: Any) => compact(h.dividendsReceived) }]} /></Card>}
      <Card title={`Transactions (${transactions.length})`} flush>
        <DataTable rows={[...transactions].reverse()} empty="No transactions yet" cols={[
          { key: "date", label: "Date", render: (t: Any) => nptDate(t.date) },
          { key: "symbol", label: "Stock", render: (t: Any) => <span className="sym">{t.symbol}</span> },
          { key: "type", label: "Type", render: (t: Any) => <Badge tone={["buy", "ipo", "right", "bonus", "merger_in"].includes(t.type) ? "up" : t.type === "cash_dividend" ? "blue" : "down"}>{t.type.replace("_", " ")}</Badge> },
          { key: "quantity", label: "Qty", num: true, render: (t: Any) => t.type === "cash_dividend" ? "-" : int(t.quantity) },
          { key: "price", label: "Price / amount", num: true, render: (t: Any) => num(t.price) },
          { key: "charges", label: "Charges", num: true, title: "Broker commission, SEBON fee and DP charge (calculated unless you entered your bill's figures)", render: (t: Any) => { const c = chargesFor(t, feeCfg); return c.total ? <>{num(c.total)}{t.commission == null && t.otherCharges == null && <div className="tiny faint">calculated</div>}</> : "-"; } },
          { key: "total", label: "Total", num: true, title: "Purchases: amount plus charges. Sales: amount less charges (before tax).", render: (t: Any) => { if (!["buy", "sell"].includes(t.type)) return t.type === "cash_dividend" ? num(t.price) : "-"; const c = chargesFor(t, feeCfg); return num(t.quantity * t.price + (t.type === "buy" ? c.total : -c.total)); } },
          { key: "notes", label: "Notes", render: (t: Any) => <span className="small muted">{t.notes ?? ""}</span> },
          { key: "x", label: "", render: (t: Any) => <span className="row" style={{ flexWrap: "nowrap" }}><button className="btn ghost sm" onClick={() => setEdit(t)}>Edit</button><button className="btn ghost sm danger" onClick={async () => { if (confirm("Delete this transaction?")) { await api(`/transactions/${t.id}`, { method: "DELETE" }); reload(); } }}><I.trash /></button></span> },
        ]} />
      </Card>
      </>}
      {(adding === "tx" || edit) && <TxModal portfolioId={id} tx={edit} holdings={s.holdings} onClose={() => { setAdding(null); setEdit(null); }} onDone={() => { setAdding(null); setEdit(null); reload(); }} />}
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
        {f.kind === "paper" && <label className="field">Starting paper cash (Rs.)<NumInput className="input" value={f.paperCash} onChange={(e) => setF({ ...f, paperCash: +e.target.value })} /></label>}
        {err && <Notice tone="warn">{err}</Notice>}
      </div>
    </Modal>
  );
}

const TX_TYPES: { key: string; label: string }[] = [
  { key: "buy", label: "Buy" }, { key: "sell", label: "Sell" }, { key: "ipo", label: "IPO" }, { key: "right", label: "Right" },
  { key: "bonus", label: "Bonus" }, { key: "cash_dividend", label: "Dividend" }, { key: "merger_in", label: "Merger in" }, { key: "merger_out", label: "Merger out" },
];

function TxModal({ portfolioId, tx, holdings, onClose, onDone }: { portfolioId: number; tx?: Any; holdings: Any[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ symbol: tx?.symbol ?? "", type: tx?.type ?? "buy", date: tx?.date ?? todayNpt(), quantity: tx?.quantity ?? "", price: tx?.price ?? "", commission: tx?.commission ?? "", otherCharges: tx?.otherCharges ?? "", tax: tx?.tax ?? "", notes: tx?.notes ?? "" });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const feesApi = useApi<Any>("/settings/fees");
  const cfg: FeeConfig = feesApi.data?.current ?? DEFAULT_FEES;
  const symbols = useSymbols();
  const sym = f.symbol.trim().toUpperCase();
  const co = symbols.find((r) => r.symbol === sym);
  const held = holdings.find((h: Any) => h.symbol === sym && h.quantity > 0);
  const heldSymbols = holdings.filter((h: Any) => h.quantity > 0).map((h: Any) => h.symbol as string);
  const ltp = co ? co.ltp ?? co.close : null;
  const q = +f.quantity, pr = +f.price;
  const isTrade = f.type === "buy" || f.type === "sell";
  const est = q > 0 && pr > 0 ? (f.type === "buy" ? buyCost(q, pr, cfg) : f.type === "sell" ? sellCost(q, pr, cfg) : null) : null;
  // Your own charges (from the broker's bill) replace the calculated ones.
  const commission = f.commission !== "" ? +f.commission : est?.commission ?? 0;
  const other = f.otherCharges !== "" ? +f.otherCharges : est ? est.sebonFee + est.dpCharge : 0;
  const charges = commission + other;
  const amount = q * pr;
  const slab = amount > 0 ? cfg.commissionSlabs.find((x) => x.upTo == null || amount <= x.upTo) : null;
  // Selling: gain against your WACC, holding period from the first purchase still held, and the tax in force on that date.
  const holdDays = held?.lots?.[0]?.date ? Math.max(0, Math.round((Date.parse(f.date) - Date.parse(held.lots[0].date)) / 86_400_000)) : null;
  const sellCalc = f.type === "sell" && held && q > 0 && pr > 0 ? (() => {
    const basis = held.wacc * q, net = amount - charges, gain = net - basis;
    const rate = cgtRate(holdDays ?? 0, "individual", cfg, f.date);
    const tax = f.tax !== "" ? +f.tax : gain > 0 ? gain * rate : 0;
    return { basis, net, gain, rate, tax, after: gain - tax, received: net - tax };
  })() : null;
  const buyCalc = f.type === "buy" && q > 0 && pr > 0 ? (() => {
    const total = amount + charges, perShare = total / q;
    const newQty = (held?.quantity ?? 0) + q, newWacc = ((held?.costBasis ?? 0) + total) / newQty;
    let lo = pr * 0.9, hi = pr * 1.25 + 50; // price at which selling everything gets your money back after charges
    for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (sellCost(q, m, cfg).net < total) lo = m; else hi = m; }
    return { total, perShare, newQty, newWacc, breakeven: hi };
  })() : null;
  const tooMany = f.type === "sell" && held && q > held.quantity;
  const notHeld = f.type === "sell" && sym && !held && !tx;
  const priceLabel = f.type === "cash_dividend" ? "Cash dividend received before tax (Rs.)" : f.type === "bonus" ? "Cost per share (Rs. 100 face value)" : f.type === "ipo" || f.type === "right" ? "Issue price per share (Rs.)" : "Price per share (Rs.)";
  const canSave = !!sym && (f.type === "cash_dividend" ? pr > 0 : q > 0 && pr >= 0) && !tooMany && !saving;
  const save = async () => {
    if (!canSave) return;
    const body = { symbol: sym, type: f.type, date: f.date, quantity: f.type === "cash_dividend" ? 0 : +f.quantity, price: +f.price, commission: f.commission === "" ? null : +f.commission, otherCharges: f.otherCharges === "" ? null : +f.otherCharges, tax: f.tax === "" ? null : +f.tax, notes: f.notes || null };
    setSaving(true);
    try { if (tx) await api(`/transactions/${tx.id}`, { method: "PUT", body }); else await api(`/portfolios/${portfolioId}/transactions`, { body }); onDone(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setSaving(false); }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const line = (label: React.ReactNode, value: React.ReactNode, cls = "") => <div className={`row between small ${cls}`}><span className="muted">{label}</span><span className="mono">{value}</span></div>;
  return (
    <Modal title={tx ? "Edit transaction" : "Add transaction"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!canSave} onClick={save}>{saving ? <span className="spinner" /> : tx ? "Save changes" : f.type === "buy" ? "Add purchase" : f.type === "sell" ? "Add sale" : "Save"}</button></>}>
      <form className="col" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="seg" role="tablist" aria-label="Transaction type">
          {TX_TYPES.map((t) => <button type="button" key={t.key} role="tab" aria-selected={f.type === t.key} className={`seg-btn${f.type === t.key ? " on" : ""}${t.key === "sell" ? " sell" : ""}`}
            onClick={() => setF({ ...f, type: t.key, price: t.key === "bonus" && !f.price ? "100" : f.price })}>{t.label}</button>)}
        </div>
        <div className="grid g2">
          <label className="field">Company
            <SymbolPicker value={f.symbol} autoFocus={!tx} hideName only={f.type === "sell" && heldSymbols.length && !tx ? heldSymbols : undefined}
              placeholder={f.type === "sell" ? "Pick a stock you hold" : "Type a symbol, e.g. N for NABIL"}
              onChange={(v) => setF((x) => ({ ...x, symbol: v }))}
              onPick={(r) => setF((x) => ({ ...x, symbol: r.symbol, price: x.price === "" && isTrade && (r.ltp ?? r.close) ? String(r.ltp ?? r.close) : x.price }))} />
          </label>
          <label className="field">Date<input className="input" type="date" value={f.date} max={todayNpt()} onChange={set("date")} /></label>
        </div>
        {(co || held) && <div className="tx-co">
          <div className="col" style={{ gap: 2, minWidth: 0 }}><strong className="small">{co?.name ?? sym}</strong><span className="tiny faint">{co?.sector ?? ""}{held ? `${co?.sector ? ", " : ""}you hold ${int(held.quantity)} at WACC Rs. ${num(held.wacc)}` : ""}</span></div>
          {ltp != null && <div className="right"><div className="mono">Rs. {num(ltp)}</div>{co?.changePct != null && <div className={`tiny ${tone(co.changePct)}`}>{pct(co.changePct)} {co.date ? nptDate(co.date) : ""}</div>}</div>}
        </div>}
        <div className="grid g2">
          {f.type !== "cash_dividend" && <label className="field">Quantity (kitta)
            <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}><NumInput className="input" value={f.quantity} onChange={set("quantity")} plain />
              {f.type === "sell" && held && <button type="button" className="btn sm" onClick={() => setF({ ...f, quantity: String(held.quantity) })}>All {int(held.quantity)}</button>}</div>
          </label>}
          <label className="field">{priceLabel}
            <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}><NumInput className="input" step="0.01" value={f.price} onChange={set("price")} />
              {isTrade && ltp != null && +f.price !== ltp && <button type="button" className="btn sm" title="Use the latest price" onClick={() => setF({ ...f, price: String(ltp) })}>LTP</button>}</div>
          </label>
        </div>
        {tooMany && <Notice tone="warn">You hold only {int(held.quantity)} {sym}. You cannot sell {int(q)}.</Notice>}
        {notHeld && <Notice tone="warn">{sym} is not in this portfolio. Add its purchase first, or check the symbol.</Notice>}

        {isTrade && est && <div className="tx-bill">
          <div className="tx-bill-head">{f.type === "buy" ? "Purchase bill" : "Sale bill"}<span className="tiny faint">rules checked {nptDate(cfg.verifiedOn?.slice(0, 10)) || cfg.verifiedOn}</span></div>
          {line(`Amount (${int(q)} x Rs. ${num(pr)})`, rs(amount))}
          {line(<>Broker commission{f.commission === "" && slab ? ` (${num(slab.rate * 100, 2)}%${est.commission === cfg.minCommission ? `, min. Rs. ${cfg.minCommission}` : ""})` : " (your figure)"}</>, rs(commission))}
          {f.otherCharges === "" ? <>{line(`SEBON fee (${num(cfg.sebonFeeRate * 100, 3)}%)`, rs(est.sebonFee))}{line("DP charge (CDSC, per company)", rs(est.dpCharge))}</> : line("SEBON + DP (your figure)", rs(other))}
          {line("Total charges", rs(charges), "tx-bill-sub")}
          {buyCalc && <>
            {line(<strong>Total payable</strong>, <strong>{rs(buyCalc.total)}</strong>, "tx-bill-total")}
            {line("Cost per share (with charges)", rs(buyCalc.perShare))}
            {held && line(`New holding: ${int(buyCalc.newQty)} kitta, WACC`, rs(buyCalc.newWacc))}
            {line("Break-even sell price", rs(buyCalc.breakeven), "faint")}
          </>}
          {f.type === "sell" && <>
            {line(<strong>Receivable before tax</strong>, <strong>{rs(amount - charges)}</strong>, "tx-bill-total")}
            {sellCalc && <>
              {line(`Your cost (WACC Rs. ${num(held.wacc)} x ${int(q)})`, rs(sellCalc.basis))}
              {line("Gain before tax", <span className={tone(sellCalc.gain)}>{rs(sellCalc.gain)}</span>)}
              {line(<>Capital gains tax {f.tax === "" ? `(${num(sellCalc.rate * 100, 2)}%, held ${holdDays ?? "?"} days, ${(holdDays ?? 0) > cfg.holdingDaysForLongTerm ? "long term" : "short term"})` : "(your figure)"}</>, rs(sellCalc.tax))}
              {line(<strong>Net profit after tax</strong>, <strong className={tone(sellCalc.after)}>{rs(sellCalc.after)}</strong>, "tx-bill-total")}
              {line("Money you receive", rs(sellCalc.received), "faint")}
              {holdDays != null && holdDays <= cfg.holdingDaysForLongTerm && holdDays > cfg.holdingDaysForLongTerm - 60 && <div className="tiny warn" style={{ marginTop: 4 }}>In {cfg.holdingDaysForLongTerm + 1 - holdDays} days this holding becomes long term ({num(cgtRate(400, "individual", cfg, f.date) * 100, 2)}% tax instead of {num(sellCalc.rate * 100, 2)}%).</div>}
            </>}
          </>}
        </div>}
        {f.type === "cash_dividend" && pr > 0 && <div className="tx-bill">{line("Dividend tax (5%, withheld by the company)", rs(f.tax !== "" ? +f.tax : pr * cfg.dividendTax))}{line(<strong>Net received</strong>, <strong>{rs(pr - (f.tax !== "" ? +f.tax : pr * cfg.dividendTax))}</strong>, "tx-bill-total")}</div>}

        <details><summary className="small muted">Use the figures from your broker's bill instead (optional)</summary>
          <div className="grid g3" style={{ marginTop: 8 }}>
            <label className="field">Broker commission<NumInput className="input" value={f.commission} placeholder={est ? num(est.commission) : "auto"} onChange={set("commission")} /></label>
            <label className="field">SEBON + DP<NumInput className="input" value={f.otherCharges} placeholder={est ? num(est.sebonFee + est.dpCharge) : "auto"} onChange={set("otherCharges")} /></label>
            <label className="field">{f.type === "sell" ? "CGT withheld" : f.type === "cash_dividend" ? "Dividend tax" : "Tax paid"}<NumInput className="input" value={f.tax} placeholder="auto" onChange={set("tax")} /></label>
          </div>
        </details>
        <label className="field">Notes<textarea className="input" value={f.notes} onChange={set("notes")} style={{ minHeight: 44 }} placeholder="Why you bought or sold (optional)" /></label>
        {err && <Notice tone="warn">{err}</Notice>}
        <button type="submit" hidden />
      </form>
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
          <label className="field">Company<SymbolPicker value={f.symbol} autoFocus onChange={(v) => setF((x) => ({ ...x, symbol: v }))} /></label>
          <label className="field">Side<select className="input" value={f.side} onChange={(e) => setF({ ...f, side: e.target.value })}><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
          <label className="field">Quantity<NumInput className="input" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></label>
          <label className="field">Price (blank = last close)<NumInput className="input" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
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
        <button className="btn" onClick={() => downloadFromApi(`/api/portfolios/${id}/export/tax.csv`)}><I.download /> Download tax CSV</button>
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

function Rebalance({ summary, sectors, extras }: { summary: Any; sectors: Record<string, string>; extras: Any }) {
  const fees = useApi<Any>("/settings/fees");
  const open = summary.holdings.filter((h: Any) => h.quantity > 0);
  const total = open.reduce((t: number, h: Any) => t + (h.marketValue ?? h.costBasis), 0);
  const [targets, setTargets] = useState<Record<string, number>>(() => Object.fromEntries(open.map((h: Any) => [h.symbol, Math.round((((h.marketValue ?? h.costBasis) / (total || 1)) * 100) * 10) / 10])));
  const [cash, setCash] = useState(0);
  const [add, setAdd] = useState("");
  const [addPrice, setAddPrice] = useState<Record<string, number>>({});
  const [minTrade, setMinTrade] = useState(5000);
  const prices: Record<string, number | null> = Object.fromEntries(open.map((h: Any) => [h.symbol, h.lastPrice]));
  Object.assign(prices, addPrice);
  const plan = fees.data ? rebalancePlan(summary.holdings, targets, prices, cash, fees.data.current, undefined, minTrade) : null;
  const sumT = Object.values(targets).reduce((a, b) => a + (+b || 0), 0);
  const equal = () => { const keys = Object.keys(targets); setTargets(Object.fromEntries(keys.map((k) => [k, Math.round((100 / keys.length) * 10) / 10]))); };
  const capped = (cap: number) => {
    // Cap each holding at `cap`% and spread the excess over the others proportionally.
    let t = { ...targets };
    for (let k = 0; k < 10; k++) {
      const over = Object.entries(t).filter(([, v]) => v > cap);
      if (!over.length) break;
      const excess = over.reduce((s2, [, v]) => s2 + v - cap, 0);
      const under = Object.entries(t).filter(([, v]) => v < cap);
      const base = under.reduce((s2, [, v]) => s2 + v, 0) || 1;
      t = Object.fromEntries(Object.entries(t).map(([s2, v]) => [s2, v > cap ? cap : v + (excess * v) / base]));
    }
    setTargets(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v * 10) / 10])));
  };
  const addSymbol = async () => {
    const s2 = add.trim().toUpperCase();
    if (!s2 || targets[s2] != null) return;
    const p = await api<Record<string, number | null>>(`/prices/latest?symbols=${s2}`);
    if (!p[s2]) return alert(`No price for ${s2}`);
    setAddPrice({ ...addPrice, [s2]: p[s2] as number });
    setTargets({ ...targets, [s2]: 0 });
    setAdd("");
  };
  if (!open.length) return <Empty title="No holdings to rebalance" />;
  return (
    <div className="grid g3">
      <Card title="Target weights" sub={`Adds up to ${num(sumT, 1)}%`} actions={<><button className="btn sm" onClick={equal}>Equal weight</button><button className="btn sm" onClick={() => capped(20)}>Cap at 20%</button></>}>
        <div className="table-wrap"><table className="t"><thead><tr><th>Stock</th><th className="num">Now</th><th className="num">Target %</th></tr></thead><tbody>
          {Object.keys(targets).map((sym) => { const h = open.find((x: Any) => x.symbol === sym); const now = h ? ((h.marketValue ?? h.costBasis) / (total || 1)) * 100 : 0; return (
            <tr key={sym}><td><span className="sym">{sym}</span><div className="tiny faint">{sectors[sym] ?? "new"} {extras[sym]?.fundamentalScore != null && <>, fund. {extras[sym].fundamentalScore}</>}</div></td><td className="num">{num(now, 1)}%</td>
              <td className="num"><NumInput className="input" step="0.5" style={{ width: 64, padding: "5px 6px" }} value={targets[sym]} onChange={(e) => setTargets({ ...targets, [sym]: +e.target.value })} /></td></tr>
          ); })}
        </tbody></table></div>
        <form className="row" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); void addSymbol(); }}><input className="input" placeholder="Add stock" value={add} onChange={(e) => setAdd(e.target.value.toUpperCase())} style={{ width: 120 }} /><button className="btn sm"><I.plus /></button></form>
        <div className="grid g2" style={{ marginTop: 10 }}>
          <label className="field">New cash to invest (Rs.)<NumInput className="input" value={cash} onChange={(e) => setCash(+e.target.value)} /></label>
          <label className="field">Skip trades under (Rs.)<NumInput className="input" value={minTrade} onChange={(e) => setMinTrade(+e.target.value)} /></label>
        </div>
      </Card>
      <div className="col span2">
        {plan && <>
          <div className="grid g4">
            <Stat label="Trades" value={plan.trades.length} sub={`Turnover ${compact(plan.totals.turnover)}`} />
            <Stat label="Charges" value={rs(plan.totals.charges, 0)} sub="Commission, SEBON, DP" />
            <Stat label="Estimated CGT" value={rs(plan.totals.estCgt, 0)} sub="On sells with gains" />
            <Stat label="Cash left" value={rs(plan.totals.cashLeft, 0)} />
          </div>
          {plan.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
          <Card title="Trades to reach your targets" flush sub={`Prices: latest close. Portfolio value ${compact(plan.portfolioValue)}${cash ? ` + ${compact(cash)} new cash` : ""}.`}>
            <DataTable rows={plan.trades} empty="Already within your targets (or changes are below the minimum trade size)" cols={[
              { key: "side", label: "Action", render: (t: Any) => <Badge tone={t.side === "buy" ? "up" : "down"}>{t.side}</Badge> },
              { key: "symbol", label: "Stock", render: (t: Any) => <span className="sym">{t.symbol}</span> },
              { key: "qty", label: "Shares", num: true, render: (t: Any) => int(t.qty) }, { key: "price", label: "At ~", num: true, render: (t: Any) => num(t.price) },
              { key: "amount", label: "Amount", num: true, render: (t: Any) => rs(t.amount, 0) }, { key: "charges", label: "Charges", num: true, render: (t: Any) => rs(t.charges, 0) },
              { key: "estCgt", label: "Est. CGT", num: true, render: (t: Any) => (t.estCgt ? rs(t.estCgt, 0) : "-") },
              { key: "w", label: "Weight", num: true, render: (t: Any) => `${num(t.fromWeightPct, 1)}% > ${num(t.toWeightPct, 1)}%` },
            ]} />
          </Card>
          <p className="tiny faint">A plan only; nothing is traded. Consider taxes: a holding sold within 365 days pays the short-term capital gains tax (now 5%), after that the long-term rate (now 3.75%). Rebalancing small differences often costs more in charges than it is worth.</p>
        </>}
      </div>
    </div>
  );
}

/** Simple allocation ring: the largest holdings, the rest grouped. */
const RING = ["#34d399", "#60a5fa", "#a78bfa", "#fbbf24", "#fb7185", "#22d3ee", "#f97316", "#94a3b8"];
function Donut({ items }: { items: { label: string; value: number }[] }) {
  const sorted = [...items].filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, 7), rest = sorted.slice(7).reduce((t, x) => t + x.value, 0);
  const parts = rest > 0 ? [...top, { label: `${sorted.length - 7} others`, value: rest }] : top;
  const total = parts.reduce((t, x) => t + x.value, 0) || 1;
  let acc = 0;
  const R = 42, C = 2 * Math.PI * R;
  return (
    <div className="alloc">
      <svg viewBox="0 0 100 100" style={{ width: 112, height: 112 }} role="img" aria-label="Allocation by holding">
        <circle cx="50" cy="50" r={R} fill="none" stroke="var(--border)" strokeWidth="12" />
        {parts.map((x, i) => { const len = (x.value / total) * C; const el = <circle key={x.label} cx="50" cy="50" r={R} fill="none" stroke={RING[i % RING.length]} strokeWidth="12" strokeDasharray={`${Math.max(len - 0.6, 0)} ${C}`} strokeDashoffset={-acc} transform="rotate(-90 50 50)" />; acc += len; return el; })}
        <text x="50" y="47" textAnchor="middle" fontSize="9" fill="var(--text-3)">holdings</text>
        <text x="50" y="60" textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--text)">{items.length}</text>
      </svg>
      <div className="alloc-legend">{parts.map((x, i) => <div key={x.label} className="alloc-item small"><i style={{ background: RING[i % RING.length] }} /><span className="alloc-name">{x.label}</span><span className="mono">{num((x.value / total) * 100, 1)}%</span></div>)}</div>
    </div>
  );
}
