// Daily income & expense tracker: quick add, entries grouped by date, monthly totals by category,
// a 6-month trend, CSV export and one-tap backup to iCloud Drive / Google Drive.
import { useMemo, useState } from "react";
import { api, useApi } from "../lib/api.ts";
import { downloadFromApi } from "../lib/backend.ts";
import { Card, Stat, Loading, ErrorBox, Empty, Seg, NumInput, Modal } from "../components/ui.tsx";
import { CloudBackup } from "../components/CloudBackup.tsx";
import { I } from "../components/icons.tsx";
import { compact, num, rs, tone } from "../lib/format.ts";
import { ENTRY_CATEGORIES, PAY_METHODS, type Entry } from "../../../shared/money.ts";

type Row = Entry & { id: number };
interface Month { month: string; entries: Row[]; summary: { income: number; spending: number; invested: number; emi: number; net: number; savingsRatePct: number | null; categories: { type: "income" | "expense"; category: string; amount: number }[]; days: { date: string; income: number; expense: number }[] }; previous: { month: string; spending: number; income: number }; trend: { month: string; income: number; spending: number; invested: number }[]; count: number }

const today = () => new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10);
const label = (type: "income" | "expense", key: string) => (ENTRY_CATEGORIES[type] as readonly { key: string; label: string }[]).find((c) => c.key === key)?.label ?? key;
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const shortMonth = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
const dayName = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const shift = (m: string, k: number) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1 + k, 1)).toISOString().slice(0, 7); };

export function Tracker({ onUseAsBudget }: { onUseAsBudget: (avg: { income: number; expenses: { category: string; amount: number }[] }) => void }) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const m = useApi<Month>(`/money/entries?month=${month}`, [month]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const grouped = useMemo(() => {
    const g = new Map<string, Row[]>();
    for (const e of m.data?.entries ?? []) g.set(e.date, [...(g.get(e.date) ?? []), e]);
    return [...g.entries()];
  }, [m.data]);
  if (m.error) return <ErrorBox error={m.error} onRetry={m.reload} />;
  const s = m.data?.summary;
  const spendCats = (s?.categories ?? []).filter((c) => c.type === "expense" && c.category !== "invest");
  const maxTrend = Math.max(1, ...(m.data?.trend ?? []).map((t) => Math.max(t.income, t.spending)));
  const useBudget = async () => {
    const a = await api<{ months: string[]; income: number; expenses: { category: string; amount: number }[] }>("/money/entries/averages");
    if (!a.months.length) { setMsg("Track at least one full month first; the budget uses the average of your last 3 full months."); return; }
    onUseAsBudget(a);
    setMsg(`Budget filled from ${a.months.length} month(s) of tracking (${a.months.map(shortMonth).join(", ")}). Review it under Budget, then Save.`);
  };
  return (
    <div className="col">
      <AddEntry onAdded={() => m.reload()} />
      <div className="row between" style={{ flexWrap: "nowrap" }}>
        <button className="btn ghost" aria-label="Previous month" onClick={() => setMonth(shift(month, -1))}></button>
        <strong style={{ fontSize: 17 }}>{monthName(month)}</strong>
        <button className="btn ghost" aria-label="Next month" disabled={month >= today().slice(0, 7)} onClick={() => setMonth(shift(month, 1))}></button>
      </div>
      {!m.data ? <Loading /> : (
        <>
          <div className="grid g4">
            <Stat label="Income" value={compact(s!.income)} sub={m.data.previous.income ? `${shortMonth(m.data.previous.month)}: ${compact(m.data.previous.income)}` : undefined} />
            <Stat label="Spending" value={compact(s!.spending)} sub={m.data.previous.spending ? <span className={s!.spending > m.data.previous.spending ? "down" : "up"}>{shortMonth(m.data.previous.month)}: {compact(m.data.previous.spending)}</span> : undefined} />
            <Stat label="Left over" value={compact(s!.net)} tone={tone(s!.net)} sub={s!.savingsRatePct != null ? `${num(s!.savingsRatePct, 0)}% of income` : "Add income"} />
            <Stat label="Saved / invested" value={compact(s!.invested)} sub={s!.emi ? `EMIs ${compact(s!.emi)}` : "Category 'Saved / invested'"} />
          </div>
          <div className="grid g2">
            <Card title="Entries" sub={`${m.data.entries.length} this month`} actions={<button className="btn sm" onClick={() => downloadFromApi("/api/money/entries.csv")}><I.download /> CSV</button>}>
              {grouped.length === 0 ? <Empty title="Nothing recorded this month">Add your first income or expense above.</Empty> : grouped.map(([date, rows]) => {
                const day = s!.days.find((d) => d.date === date);
                return (
                  <div key={date} style={{ marginBottom: 10 }}>
                    <div className="row between small" style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                      <strong>{dayName(date)}</strong>
                      <span className="mono">{day?.income ? <span className="up">+{compact(day.income)} </span> : null}{day?.expense ? <span className="down">−{compact(day.expense)}</span> : null}</span>
                    </div>
                    {rows.map((e) => (
                      <button key={e.id} className="entry-row" onClick={() => setEdit(e)}>
                        <span style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                          <span className="small">{label(e.type, e.category)}</span>
                          {(e.note || e.method) && <span className="tiny faint" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[e.note, e.method].filter(Boolean).join(", ")}</span>}
                        </span>
                        <span className={`mono ${e.type === "income" ? "up" : ""}`}>{e.type === "income" ? "+" : "−"}{rs(e.amount, 0)}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </Card>
            <div className="col">
              <Card title="Spending by category">
                {spendCats.length === 0 ? <Empty title="No spending yet" /> : spendCats.map((c) => (
                  <div key={c.category} style={{ marginBottom: 8 }}>
                    <div className="row between small" style={{ flexWrap: "nowrap" }}><span>{label("expense", c.category)}</span><span className="mono">{rs(c.amount, 0)} <span className="faint">{num((c.amount / Math.max(1, s!.spending)) * 100, 0)}%</span></span></div>
                    <div className="bar"><div style={{ width: `${(c.amount / Math.max(1, s!.spending)) * 100}%` }} /></div>
                  </div>
                ))}
              </Card>
              <Card title="Last 6 months">
                <div className="trend">{m.data.trend.map((t) => (
                  <div key={t.month} className="trend-col" title={`${monthName(t.month)}: income ${rs(t.income, 0)}, spending ${rs(t.spending, 0)}`}>
                    <div className="trend-bars"><span className="tb-in" style={{ height: `${(t.income / maxTrend) * 100}%` }} /><span className="tb-out" style={{ height: `${(t.spending / maxTrend) * 100}%` }} /></div>
                    <span className="tiny faint">{shortMonth(t.month)}</span>
                  </div>
                ))}</div>
                <div className="row tiny" style={{ gap: 12 }}><span><span className="dot" style={{ background: "var(--up)" }} /> Income</span><span><span className="dot" style={{ background: "var(--down)" }} /> Spending</span></div>
              </Card>
              <Card title="Turn tracking into a budget">
                <p className="small muted">Fill My Money's monthly budget with your real average spending from the last 3 full months, so the advice uses what you actually spend.</p>
                <button className="btn" onClick={useBudget}>Use my tracked averages</button>
                {msg && <p className="small" style={{ marginTop: 8 }}>{msg}</p>}
              </Card>
            </div>
          </div>
          <CloudBackup compact />
        </>
      )}
      {edit && <EditEntry e={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); m.reload(); }} />}
    </div>
  );
}

function EntryFields({ v, set }: { v: Entry; set: (v: Entry) => void }) {
  const cats = ENTRY_CATEGORIES[v.type];
  return (
    <>
      <Seg value={v.type} onChange={(t) => set({ ...v, type: t, category: t === "income" ? "salary" : "food" })} options={[{ key: "expense", label: "Expense" }, { key: "income", label: "Income" }]} />
      <label className="field">Amount (Rs.)<NumInput value={v.amount || ""} min={0} placeholder="0" onChange={(e) => set({ ...v, amount: Number(e.target.value) || 0 })} /></label>
      <div className="chips">{cats.map((c) => <button key={c.key} type="button" className={`chip ${v.category === c.key ? "on" : ""}`} onClick={() => set({ ...v, category: c.key })}>{c.label}</button>)}</div>
      <div className="form-grid">
        <label className="field">Date<input className="input" type="date" value={v.date} max={today()} onChange={(e) => set({ ...v, date: e.target.value || today() })} /></label>
        <label className="field">Paid with / received in<select className="input" value={v.method ?? ""} onChange={(e) => set({ ...v, method: e.target.value || null })}><option value="">-</option>{PAY_METHODS.map((p) => <option key={p}>{p}</option>)}</select></label>
      </div>
      <label className="field">Note (optional)<input className="input" value={v.note ?? ""} maxLength={300} placeholder="e.g. Bhatbhateni groceries" onChange={(e) => set({ ...v, note: e.target.value })} /></label>
    </>
  );
}

function AddEntry({ onAdded }: { onAdded: () => void }) {
  const blank = (type: "income" | "expense" = "expense"): Entry => ({ date: today(), type, category: type === "income" ? "salary" : "food", amount: 0, note: "", method: null });
  const [v, setV] = useState<Entry>(blank());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const add = async () => {
    if (!(v.amount > 0)) return;
    setBusy(true);
    try {
      await api("/money/entries", { body: { ...v, note: v.note || null } });
      setDone(`${v.type === "income" ? "Income" : "Expense"} of ${rs(v.amount, 0)} saved`);
      setV({ ...blank(v.type), date: v.date, method: v.method, category: v.category });
      onAdded();
      setTimeout(() => setDone(null), 2500);
    } finally { setBusy(false); }
  };
  return (
    <Card title="Add income or expense">
      <div className="col" style={{ gap: 10 }}>
        <EntryFields v={v} set={setV} />
        <div className="row"><button className="btn primary" disabled={busy || !(v.amount > 0)} onClick={add}>{busy ? <span className="spinner" /> : <><I.plus /> Save</>}</button>{done && <span className="small up"><I.check /> {done}</span>}</div>
      </div>
    </Card>
  );
}

function EditEntry({ e, onClose, onSaved }: { e: Row; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Entry>(e);
  const save = async () => { await api(`/money/entries/${e.id}`, { method: "PUT", body: { ...v, note: v.note || null } }); onSaved(); };
  const del = async () => { if (!confirm("Delete this entry?")) return; await api(`/money/entries/${e.id}`, { method: "DELETE" }); onSaved(); };
  return (
    <Modal title="Edit entry" onClose={onClose} footer={<><button className="btn ghost danger" onClick={del}><I.trash /> Delete</button><button className="btn primary" disabled={!(v.amount > 0)} onClick={save}>Save</button></>}>
      <div className="col" style={{ gap: 10 }}><EntryFields v={v} set={setV} /></div>
    </Modal>
  );
}
