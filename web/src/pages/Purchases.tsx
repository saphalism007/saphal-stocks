// Purchase Planner: a separate pot for each thing you plan to buy (or a bundle like TV + PS5),
// so the money is set aside, protected and tracked until the day you buy.
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { Card, Stat, Badge, Empty, Loading, ErrorBox, NumInput, Notice, Modal } from "../components/ui.tsx";
import { compact, num, nptDate, rs, todayNpt } from "../lib/format.ts";
import { potStatus, affordability, emiVsSave, POT_TEMPLATES, type Pot } from "../../../shared/purchase.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Row { id: number; data: Pot }
const addMonths = (d: string, m: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + m); return x.toISOString().slice(0, 10); };
const ST: Record<string, { label: string; tone: "up" | "down" | "warn" | "" }> = { ahead: { label: "Ahead", tone: "up" }, "on-track": { label: "On track", tone: "up" }, behind: { label: "Behind", tone: "warn" }, overdue: { label: "Past date", tone: "down" }, ready: { label: "Ready to buy", tone: "up" }, bought: { label: "Bought", tone: "" } };

export default function Purchases() {
  const v = useApi<Row[]>("/vault/purchase");
  const money = useApi<Any>("/money");
  const [edit, setEdit] = useState<Row | "new" | null>(null);
  const [tpl, setTpl] = useState<string | null>(null);
  const today = todayNpt();
  if (v.error) return <div className="page"><ErrorBox error={v.error} onRetry={v.reload} /></div>;
  const rows = (v.data ?? []).map((r) => ({ ...r, s: potStatus(r.data, today) }));
  const active = rows.filter((r) => !r.data.bought);
  const monthlyAll = active.reduce((s, r) => s + r.s.monthly, 0), savedAll = active.reduce((s, r) => s + r.s.saved, 0), totalAll = active.reduce((s, r) => s + r.s.total, 0);
  const m = money.data?.saved ? money.data.summary : null;
  const fit = affordability(monthlyAll, m ? { income: m.income, cashFlow: m.cashFlow, emergencyGap: m.emergencyGap } : null, active.every((r) => r.data.kind === "need") ? "need" : "want");
  const save = async (id: number | null, data: Pot) => { if (id) await api(`/vault/purchase/${id}`, { method: "PUT", body: data }); else await api("/vault/purchase", { body: data }); v.reload(); };
  const del = async (id: number) => { if (!confirm("Delete this plan?")) return; await api(`/vault/purchase/${id}`, { method: "DELETE" }); v.reload(); };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Purchase Planner</h1><p className="muted">Planning to buy something — a TV and PS5, a bike, a wedding, festival shopping? Give it its own pot, set aside a fixed amount every month, keep it away from your spending money, and buy with cash, not debt.</p></div>
        <button className="btn primary" onClick={() => { setTpl(null); setEdit("new"); }}>+ New plan</button></div>
      {!v.data ? <Loading /> : (
        <>
          {rows.length > 0 && <div className="grid g4">
            <Stat label="Set aside each month" value={rs(monthlyAll, 0)} sub={`for ${active.length} active plan${active.length === 1 ? "" : "s"}`} />
            <Stat label="Saved so far" value={compact(savedAll)} sub={`of ${compact(totalAll)}`} />
            <Stat label="Fits your budget?" value={fit.level === "yes" ? "Yes" : fit.level === "tight" ? "Tight" : fit.level === "no" ? "No" : "—"} tone={fit.level === "yes" ? "up" : fit.level === "no" ? "down" : ""} sub={fit.level === "unknown" ? "fill in My Money" : undefined} />
            <Stat label="Ready to buy" value={rows.filter((r) => r.s.status === "ready").length} />
          </div>}
          {rows.length > 0 && <Notice tone={fit.level === "no" ? "warn" : "info"}>{fit.text} {fit.level === "unknown" && <Link to="/money">Open My Money</Link>}</Notice>}
          {rows.length === 0 && (
            <Empty title="No purchase plans yet">Start one below, or tap a template.</Empty>
          )}
          <div className="pp-templates">{POT_TEMPLATES.map((t) => <button key={t.key} className="chip" onClick={() => { setTpl(t.key); setEdit("new"); }}>{t.name}</button>)}</div>
          <div className="pp-list">{rows.map((r) => <PotCard key={r.id} r={r} today={today} onSave={(d) => save(r.id, d)} onEdit={() => setEdit(r)} onDelete={() => del(r.id)} />)}</div>
          <EmiCheck />
          <Card title="Protect this money: 6 rules">
            <ol className="small" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
              <li><b>Separate account.</b> Open a savings account or recurring deposit in a different bank, not linked to your debit card, eSewa/Khalti or mobile banking you use daily.</li>
              <li><b>Pay it first.</b> Set an automatic transfer on salary day for the monthly amount, before any spending.</li>
              <li><b>Name it.</b> Call it "TV + PS5 fund" (or similar) in your bank app and here. Named money is spent less.</li>
              <li><b>Not your emergency fund.</b> Never take from the emergency fund or borrow for a want. If money runs short, move the date, don't break the pot.</li>
              <li><b>No shares for short-term money.</b> Anything you'll spend within 2–3 years stays in deposits.</li>
              <li><b>Wait 30 days before buying a want over Rs. 50,000.</b> If you still want it, compare 3 shops, festival offers and warranty, and keep the bill.</li>
            </ol>
          </Card>
        </>
      )}
      {edit && <PotEditor row={edit === "new" ? null : edit} template={tpl} onClose={() => setEdit(null)} onSave={async (d) => { await save(edit === "new" ? null : edit.id, d); setEdit(null); }} />}
    </div>
  );
}

function PotCard({ r, today, onSave, onEdit, onDelete }: { r: Row & { s: ReturnType<typeof potStatus> }; today: string; onSave: (d: Pot) => void; onEdit: () => void; onDelete: () => void }) {
  const [amt, setAmt] = useState<number | "">(r.s.monthly || "");
  const [log, setLog] = useState(false);
  const p = r.data, s = r.s, st = ST[s.status];
  const add = (sign: 1 | -1) => { const a = Number(amt) || 0; if (a <= 0) return; const e = { date: today, amount: a }; onSave(sign > 0 ? { ...p, deposits: [...p.deposits, e] } : { ...p, withdrawals: [...(p.withdrawals ?? []), e] }); setAmt(""); };
  return (
    <div className={`pp-card pp-${s.status}`}>
      <div className="row between" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}><b>{p.name}</b> <Badge tone={p.kind === "need" ? "accent" : ""}>{p.kind}</Badge><div className="tiny faint">{p.items.map((i) => `${i.name} ${compact(i.price)}`).join(" + ")}</div></div>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <div className="pp-prog"><i style={{ width: `${s.pct}%` }} /><span style={{ left: `${Math.min(100, (s.expectedByNow / Math.max(1, s.total)) * 100)}%` }} title="Where you should be by now" /></div>
      <div className="pp-kv">
        <span>Saved <b>{rs(s.saved, 0)}</b></span><span>Goal <b>{rs(s.total, 0)}</b></span>
        <span>Each month <b className="up">{s.monthly ? rs(s.monthly, 0) : "—"}</b></span><span>Buy by <b>{nptDate(p.target)}</b> <em>{s.monthsLeft} mo</em></span>
      </div>
      {s.status !== "bought" && s.status !== "ready" && <div className="tiny"><b>Keep it in:</b> {s.park.place}. <span className="faint">{s.park.why}</span></div>}
      {s.status === "behind" && <div className="tiny warn">You should have about {rs(s.expectedByNow, 0)} by now. Add {rs(s.expectedByNow - s.saved, 0)} or move the date.</div>}
      {s.status === "ready" && <div className="tiny up">You have the full amount. Before buying: wait 30 days if it's a want, compare 3 shops and festival offers, check warranty, keep the bill, then mark it bought.</div>}
      {!p.bought && <div className="row" style={{ gap: 6 }}>
        <NumInput className="input" value={amt} placeholder="Amount" style={{ width: 120 }} onChange={(e) => setAmt(e.target.value === "" ? "" : Number(e.target.value))} />
        <button className="btn sm primary" onClick={() => add(1)}>+ Saved</button>
        <button className="btn sm ghost" onClick={() => add(-1)} title="Record money taken out">− Took out</button>
        {s.status === "ready" && <button className="btn sm" onClick={() => onSave({ ...p, bought: true })}>Mark bought</button>}
      </div>}
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm ghost" onClick={() => setLog(!log)}>{log ? "Hide" : "History"} ({p.deposits.length + (p.withdrawals?.length ?? 0)})</button>
        <button className="btn sm ghost" onClick={onEdit}>Edit</button>
        <button className="btn sm ghost" onClick={onDelete}>Delete</button>
      </div>
      {log && <table className="t small"><tbody>{[...p.deposits.map((d) => ({ ...d, sign: 1 })), ...(p.withdrawals ?? []).map((d) => ({ ...d, sign: -1 }))].sort((a, b) => b.date.localeCompare(a.date)).map((d, i) => <tr key={i}><td>{nptDate(d.date)}</td><td className={`num ${d.sign > 0 ? "up" : "down"}`}>{d.sign > 0 ? "+" : "−"}{rs(d.amount, 0)}</td></tr>)}</tbody></table>}
    </div>
  );
}

function PotEditor({ row, template, onClose, onSave }: { row: Row | null; template: string | null; onClose: () => void; onSave: (d: Pot) => void }) {
  const t = POT_TEMPLATES.find((x) => x.key === template);
  const today = todayNpt();
  const [p, setP] = useState<Pot>(row?.data ?? { name: t?.name ?? "", items: t?.items ?? [{ name: "", price: 0 }], kind: t?.kind ?? "want", start: today, target: addMonths(today, t?.months ?? 6), deposits: [], template: t?.key });
  const [have, setHave] = useState<number | "">("");
  const total = p.items.reduce((s, i) => s + (i.price || 0), 0);
  const ok = p.name.trim() && total > 0 && p.target > today;
  return (
    <Modal title={row ? "Edit plan" : "New purchase plan"} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok} onClick={() => onSave({ ...p, deposits: !row && Number(have) > 0 ? [{ date: today, amount: Number(have), note: "Already saved" }] : p.deposits })}>Save plan</button></>}>
      {t && <Notice>{t.tip}</Notice>}
      <div className="col" style={{ gap: 10 }}>
        <label className="field">Plan name<input className="input" value={p.name} placeholder="e.g. TV + PS5 Pro" onChange={(e) => setP({ ...p, name: e.target.value })} /></label>
        <div className="small"><b>What you'll buy</b> <span className="faint">(add every item, plus delivery/installation)</span></div>
        {p.items.map((it, i) => (
          <div key={i} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
            <input className="input" style={{ flex: 1, minWidth: 0 }} placeholder="Item" value={it.name} onChange={(e) => setP({ ...p, items: p.items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <NumInput className="input" style={{ width: 120 }} placeholder="Price" value={it.price || ""} onChange={(e) => setP({ ...p, items: p.items.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) || 0 } : x)) })} />
            {p.items.length > 1 && <button className="btn sm ghost" onClick={() => setP({ ...p, items: p.items.filter((_, j) => j !== i) })}>✕</button>}
          </div>
        ))}
        <button className="btn sm ghost" style={{ alignSelf: "flex-start" }} onClick={() => setP({ ...p, items: [...p.items, { name: "", price: 0 }] })}>+ Add item</button>
        <div className="form-grid">
          <label className="field">Need or want?<select className="input" value={p.kind} onChange={(e) => setP({ ...p, kind: e.target.value as Pot["kind"] })}><option value="want">Want (nice to have)</option><option value="need">Need (must pay)</option></select></label>
          <label className="field">Buy by<input type="date" className="input" value={p.target} min={today} onChange={(e) => setP({ ...p, target: e.target.value })} /></label>
          {!row && <label className="field">Already saved for it (Rs.)<NumInput className="input" value={have} onChange={(e) => setHave(e.target.value === "" ? "" : Number(e.target.value))} /></label>}
        </div>
        <div className="small">Total <b>{rs(total, 0)}</b>{ok ? <> · about <b>{rs(potStatus({ ...p, deposits: Number(have) > 0 ? [{ date: today, amount: Number(have) }] : p.deposits }, today).monthly, 0)}</b> a month</> : null}</div>
      </div>
    </Modal>
  );
}

function EmiCheck() {
  const [price, setPrice] = useState<number | "">(300000);
  const [rate, setRate] = useState<number | "">(18);
  const [months, setMonths] = useState<number | "">(12);
  const [fee, setFee] = useState<number | "">(2000);
  const e = emiVsSave(Number(price) || 0, Number(rate) || 0, Math.max(1, Number(months) || 1), Number(fee) || 0, 5);
  return (
    <Card title="Buy on EMI or save first?" sub="Shops and cards offer EMIs; this shows what it really costs">
      <div className="form-grid">
        <label className="field">Price (Rs.)<NumInput className="input" value={price} onChange={(x) => setPrice(x.target.value === "" ? "" : Number(x.target.value))} /></label>
        <label className="field">EMI interest (% a year)<NumInput className="input" value={rate} onChange={(x) => setRate(x.target.value === "" ? "" : Number(x.target.value))} /></label>
        <label className="field">Months<NumInput className="input" value={months} onChange={(x) => setMonths(x.target.value === "" ? "" : Number(x.target.value))} /></label>
        <label className="field">Processing fee (Rs.)<NumInput className="input" value={fee} onChange={(x) => setFee(x.target.value === "" ? "" : Number(x.target.value))} /></label>
      </div>
      <dl className="kv text small" style={{ marginTop: 10 }}>
        <dt>Monthly EMI</dt><dd style={{ textAlign: "right" }}><b>{rs(e.emi, 0)}</b></dd>
        <dt>Total you pay with EMI</dt><dd style={{ textAlign: "right" }}><b>{rs(e.totalWithEmi, 0)}</b></dd>
        <dt>Extra cost of the EMI</dt><dd style={{ textAlign: "right" }}><b className="down">{rs(e.extraCost, 0)}</b></dd>
        <dt>Saving the same amount monthly instead</dt><dd style={{ textAlign: "right" }}><b className="up">buy in {e.monthsToSave} months, cash</b></dd>
      </dl>
      <p className="tiny faint" style={{ margin: "6px 0 0" }}>"0% EMI" offers usually hide the interest in a higher price or fees — compare with the cash price. Saving assumes 5% a year in a recurring deposit. EMIs are fine for needs; for wants, saving first costs less and avoids debt.</p>
    </Card>
  );
}
