// Split Expenses: people in a group pay bills that are shared by some or all of them; the app works out each
// person's share and the fewest payments that settle everyone up. Saved with your personal data and synced.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, useApi } from "../lib/api.ts";
import { Card, Loading, ErrorBox, Notice, Empty, Modal, NumInput } from "../components/ui.tsx";
import { I } from "../components/icons.tsx";
import { num, rs, todayNpt, nptDate } from "../lib/format.ts";
import { settle, summaryText, type SplitGroup, type SplitExpense } from "../../../shared/split.ts";
import type { ExportKind } from "../lib/splitExport.ts";

const uid = () => Math.random().toString(36).slice(2, 10);
const money = (x: number) => rs(x, 2);

export default function Split() {
  const r = useApi<SplitGroup[]>("/splits");
  const [groups, setGroups] = useState<SplitGroup[] | null>(null);
  const [cur, setCur] = useState<string | null>(null);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (r.data && groups == null) { setGroups(r.data); setCur(r.data[0]?.id ?? null); } }, [r.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // Every change saves itself a moment later.
  const update = (next: SplitGroup[]) => {
    setGroups(next); setSaved("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { api("/splits", { method: "PUT", body: next }).then(() => setSaved("saved")).catch(() => setSaved("error")); }, 500);
  };
  if (r.error) return <ErrorBox error={r.error} onRetry={r.reload} />;
  if (!groups) return <div className="page"><Loading /></div>;
  const g = groups.find((x) => x.id === cur) ?? null;
  const setG = (ng: SplitGroup) => update(groups.map((x) => (x.id === ng.id ? { ...ng, updatedAt: new Date().toISOString() } : x)));
  const newGroup = () => {
    const ng: SplitGroup = { id: uid(), name: `Group ${groups.length + 1}`, people: [], expenses: [], updatedAt: new Date().toISOString() };
    update([ng, ...groups]); setCur(ng.id);
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Split Expenses</h1><p>Who paid what, who it was for, and the fewest payments to settle up. Exact to the paisa.</p></div>
        <div className="row">
          <span className="tiny faint">{saved === "saving" ? "Saving..." : saved === "saved" ? "Saved" : saved === "error" ? "Not saved, check connection" : ""}</span>
          <button className="btn primary" onClick={newGroup}><I.plus /> New group</button>
        </div>
      </div>
      {groups.length > 0 && <div className="pill-tabs">{groups.map((x) => <button key={x.id} className={`chip${x.id === cur ? " on" : ""}`} onClick={() => setCur(x.id)}>{x.name}<span className="tiny faint">{x.people.length}</span></button>)}</div>}
      {!g ? <Empty title="No groups yet">Create a group for a trip, a dinner or a shared flat, add the people, then add each bill.<div style={{ marginTop: 10 }}><button className="btn primary" onClick={newGroup}><I.plus /> New group</button></div></Empty>
        : <GroupView key={g.id} g={g} setG={setG} onDelete={() => { if (confirm(`Delete "${g.name}" and all its expenses?`)) { const next = groups.filter((x) => x.id !== g.id); update(next); setCur(next[0]?.id ?? null); } }} />}
    </div>
  );
}

function GroupView({ g, setG, onDelete }: { g: SplitGroup; setG: (g: SplitGroup) => void; onDelete: () => void }) {
  const [name, setName] = useState("");
  const [edit, setEdit] = useState<SplitExpense | "new" | null>(null);
  const [copied, setCopied] = useState(false);
  const [exp, setExp] = useState<{ kind: ExportKind; file: File | null; busy: boolean; msg: string | null } | null>(null);
  const make = async (kind: ExportKind) => {
    setExp({ kind, file: null, busy: true, msg: null });
    try { const m = await import("../lib/splitExport.ts"); setExp({ kind, file: await m.buildSettlementFile(g, kind), busy: false, msg: null }); }
    catch (e) { setExp({ kind, file: null, busy: false, msg: e instanceof Error ? e.message : String(e) }); }
  };
  const send = async () => {
    if (!exp?.file) return;
    const { deliver } = await import("../lib/fileOut.ts");
    const r = await deliver(exp.file);
    setExp({ ...exp, msg: r === "shared" ? "Sent." : r === "downloaded" ? "Saved to your Downloads." : null });
  };
  const res = useMemo(() => settle(g), [g]);
  const pname = (id: string) => g.people.find((p) => p.id === id)?.name ?? "?";
  const addPeople = () => {
    // Several names at once: "Saphal, Ujin, Alin".
    const names = name.split(/[,\n]/).map((x) => x.trim()).filter(Boolean).filter((n) => !g.people.some((p) => p.name.toLowerCase() === n.toLowerCase()));
    if (!names.length) return;
    setG({ ...g, people: [...g.people, ...names.map((n) => ({ id: uid(), name: n }))] }); setName("");
  };
  const removePerson = (id: string) => {
    if (g.expenses.some((e) => e.among.includes(id) || e.payers.some((x) => x.personId === id))) return alert(`${pname(id)} is part of some expenses. Remove them from those expenses first.`);
    setG({ ...g, people: g.people.filter((p) => p.id !== id) });
  };
  const share = async () => {
    const text = summaryText(g, res);
    try { if (navigator.share) { await navigator.share({ title: g.name, text }); return; } } catch { /* cancelled */ }
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { prompt("Copy this:", text); }
  };
  return (
    <div className="col">
      <Card title="Group" sub={`${g.people.length} people`} actions={<button className="btn sm ghost danger" onClick={onDelete} aria-label="Delete group"><I.trash /></button>}>
        <label className="field">Group name<input className="input" value={g.name} maxLength={120} onChange={(e) => setG({ ...g, name: e.target.value })} placeholder="e.g. Pokhara trip" /></label>
        <div className="field" style={{ marginTop: 10 }}>People</div>
        <div className="split-people">
          {g.people.map((p) => <span key={p.id} className="chip split-person">{p.name}<button aria-label={`Remove ${p.name}`} onClick={() => removePerson(p.id)}>×</button></span>)}
        </div>
        <form className="row" style={{ marginTop: 10, flexWrap: "nowrap" }} onSubmit={(e) => { e.preventDefault(); addPeople(); }}>
          <input className="input" style={{ flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Add names, e.g. Saphal, Ujin, Alin" autoCapitalize="words" />
          <button className="btn" disabled={!name.trim()}><I.plus /> Add</button>
        </form>
      </Card>

      <Card title={`Expenses (${g.expenses.length})`} sub={`Total ${money(res.total)}`} actions={<button className="btn primary sm" disabled={g.people.length < 2} onClick={() => setEdit("new")}><I.plus /> Add expense</button>} flush>
        {g.people.length < 2 ? <div className="card-body tiny muted">Add at least two people first.</div> : g.expenses.length === 0 ? <Empty title="No expenses yet">Tap Add expense: what it was, how much, who paid and who it is for.</Empty> : (
          <div className="split-list">{g.expenses.map((e) => (
            <button key={e.id} className="split-exp" onClick={() => setEdit(e)}>
              <div className="row between"><strong>{e.title || "Expense"}</strong><span className="mono">{money(e.amount)}</span></div>
              <div className="tiny muted">Paid by {e.payers.map((x) => `${pname(x.personId)}${e.payers.length > 1 ? ` ${money(x.amount)}` : ""}`).join(", ")}{e.date ? `, ${nptDate(e.date)}` : ""}</div>
              <div className="tiny faint">For {e.among.length === g.people.length ? `everyone (${e.among.length})` : e.among.map(pname).join(", ")}{e.mode === "shares" ? ", by shares" : e.mode === "exact" ? ", exact amounts" : `, ${Math.round((e.amount || 0) * 100) % Math.max(1, e.among.length) ? "about " : ""}${money((e.amount || 0) / Math.max(1, e.among.length))} each`}</div>
            </button>
          ))}</div>
        )}
      </Card>

      {res.issues.map((x) => <Notice key={x} tone="warn">{x}</Notice>)}

      {g.expenses.length > 0 && <>
        <Card title="Settle up" sub={res.transfers.length ? `${res.transfers.length} payment${res.transfers.length > 1 ? "s" : ""} clears everything` : "Everyone is even"} actions={<button className="btn sm" onClick={share}>{copied ? "Copied" : "Share"}</button>}>
          {res.transfers.length === 0 ? <div className="small muted">Nobody owes anything.</div> : <div className="split-transfers">{res.transfers.map((t, i) => (
            <div key={i} className="split-transfer"><span className="split-name">{t.fromName}</span><span className="split-arrow">pays</span><span className="split-name">{t.toName}</span><strong className="mono">{money(t.amount)}</strong></div>
          ))}</div>}
        </Card>
        <Card title="Download or send the sheet" sub="For the group chat, email or your files">
          <div className="split-export">
            {([["pdf", "PDF", "Ready to print or send"], ["png", "Image", "Best for WhatsApp / Viber"], ["xlsx", "Excel", "Opens in Excel and Numbers"], ["csv", "CSV", "Any spreadsheet app"], ["txt", "Text", "Plain text message"]] as [ExportKind, string, string][]).map(([k, l, d]) => (
              <button key={k} className="split-export-btn" onClick={() => void make(k)}><strong>{l}</strong><span className="tiny faint">{d}</span></button>
            ))}
          </div>
        </Card>
        <Card title="Each person" flush>
          <div className="table-wrap"><table className="t"><thead><tr><th>Person</th><th className="num">Paid</th><th className="num">Share</th><th className="num">Balance</th></tr></thead><tbody>
            {res.people.map((p) => <tr key={p.id}><td>{p.name}</td><td className="num">{num(p.paid)}</td><td className="num">{num(p.share)}</td><td className={`num ${p.balance > 0 ? "up" : p.balance < 0 ? "down" : ""}`}>{p.balance > 0 ? `gets ${num(p.balance)}` : p.balance < 0 ? `owes ${num(-p.balance)}` : "even"}</td></tr>)}
          </tbody></table></div>
          <p className="tiny faint" style={{ padding: "8px 14px" }}>Shares are worked out in whole paisa; when a bill does not divide evenly, the extra paisa go to the first people in the list, so everything adds up exactly.</p>
        </Card>
      </>}

      {exp && <Modal title={`${{ pdf: "PDF", png: "Image", xlsx: "Excel", csv: "CSV", txt: "Text" }[exp.kind]} file`} onClose={() => setExp(null)} footer={<><button className="btn" onClick={() => setExp(null)}>Close</button><button className="btn primary" disabled={!exp.file} onClick={() => void send()}>Send or save</button></>}>
        {exp.busy ? <div className="row"><span className="spinner" /> <span className="small muted">Making the file...</span></div>
          : exp.file ? <div className="col"><div className="small"><strong>{exp.file.name}</strong> <span className="faint">({Math.max(1, Math.round(exp.file.size / 1024))} KB)</span></div>
            <div className="tiny muted">Tap Send or save to open the share sheet: WhatsApp, Viber, Messages, Mail, AirDrop or Save to Files. On a Mac without sharing, it saves to Downloads.</div>
            {exp.msg && <Notice>{exp.msg}</Notice>}</div>
          : <Notice tone="warn">Could not make the file: {exp.msg}</Notice>}
      </Modal>}
      {edit && <ExpenseModal g={g} exp={edit === "new" ? null : edit} onClose={() => setEdit(null)}
        onSave={(e) => { setG({ ...g, expenses: edit === "new" ? [...g.expenses, e] : g.expenses.map((x) => (x.id === e.id ? e : x)) }); setEdit(null); }}
        onDelete={edit !== "new" ? () => { setG({ ...g, expenses: g.expenses.filter((x) => x.id !== (edit as SplitExpense).id) }); setEdit(null); } : undefined} />}
    </div>
  );
}

function ExpenseModal({ g, exp, onClose, onSave, onDelete }: { g: SplitGroup; exp: SplitExpense | null; onClose: () => void; onSave: (e: SplitExpense) => void; onDelete?: () => void }) {
  const all = g.people.map((p) => p.id);
  const [title, setTitle] = useState(exp?.title ?? "");
  const [amount, setAmount] = useState<string>(exp ? String(exp.amount) : "");
  const [date, setDate] = useState(exp?.date ?? todayNpt());
  const [multi, setMulti] = useState((exp?.payers.length ?? 1) > 1);
  const [payer, setPayer] = useState(exp?.payers[0]?.personId ?? all[0]);
  const [payAmts, setPayAmts] = useState<Record<string, string>>(() => Object.fromEntries((exp?.payers ?? []).map((x) => [x.personId, String(x.amount)])));
  const [among, setAmong] = useState<string[]>(exp?.among ?? all);
  const [mode, setMode] = useState<SplitExpense["mode"]>(exp?.mode ?? "equal");
  const [shares, setShares] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(exp?.shares ?? {}).map(([k, v]) => [k, String(v)])));
  const A = Number(amount) || 0;
  const draft: SplitExpense = {
    id: exp?.id ?? uid(), title: title.trim(), date, amount: A, mode, among: all.filter((id) => among.includes(id)),
    payers: multi ? all.filter((id) => Number(payAmts[id]) > 0).map((id) => ({ personId: id, amount: Number(payAmts[id]) })) : [{ personId: payer, amount: A }],
    shares: mode === "equal" ? undefined : Object.fromEntries(all.filter((id) => among.includes(id)).map((id) => [id, Number(shares[id] ?? (mode === "shares" ? 1 : 0)) || 0])),
  };
  const preview = settle({ ...g, expenses: [draft] });
  const each = preview.perExpense[0]?.shares ?? {};
  const payTotal = draft.payers.reduce((t, x) => t + x.amount, 0);
  const exactTotal = mode === "exact" ? Object.values(draft.shares ?? {}).reduce((t, x) => t + x, 0) : A;
  const ok = A > 0 && draft.among.length > 0 && draft.payers.length > 0 && (!multi || Math.round(payTotal * 100) === Math.round(A * 100)) && (mode !== "exact" || Math.round(exactTotal * 100) === Math.round(A * 100));
  const toggle = (id: string) => setAmong((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  return (
    <Modal title={exp ? "Edit expense" : "Add expense"} onClose={onClose} footer={<>{onDelete && <button className="btn ghost danger" onClick={() => confirm("Delete this expense?") && onDelete()} style={{ marginRight: "auto" }}><I.trash /> Delete</button>}<button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok} onClick={() => onSave(draft)}>Save</button></>}>
      <form className="col" onSubmit={(e) => { e.preventDefault(); if (ok) onSave(draft); }}>
        <div className="grid g2">
          <label className="field">What for<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Dinner, hotel, taxi..." autoFocus={!exp} /></label>
          <label className="field">Amount (Rs.)<NumInput className="input" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        </div>
        <div className="grid g2">
          <label className="field">Paid by
            {!multi ? <select className="input" value={payer} onChange={(e) => setPayer(e.target.value)}>{g.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              : <span className="tiny muted">Enter each payer's amount below</span>}
          </label>
          <label className="field">Date<input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} /> More than one person paid</label>
        {multi && <div className="split-grid">{g.people.map((p) => <label key={p.id} className="split-row"><span>{p.name}</span><NumInput className="input" step="0.01" value={payAmts[p.id] ?? ""} placeholder="0" onChange={(e) => setPayAmts({ ...payAmts, [p.id]: e.target.value })} /></label>)}
          <div className={`tiny ${Math.round(payTotal * 100) === Math.round(A * 100) ? "faint" : "warn"}`}>Payers total {money(payTotal)} of {money(A)}</div></div>}

        <div className="field">For whom
          <div className="row" style={{ gap: 6, marginTop: 4 }}>
            <button type="button" className="btn sm" onClick={() => setAmong(all)}>Everyone</button>
            <button type="button" className="btn sm ghost" onClick={() => setAmong([])}>Clear</button>
          </div>
          <div className="split-people" style={{ marginTop: 8 }}>{g.people.map((p) => <button type="button" key={p.id} className={`chip split-pick${among.includes(p.id) ? " on" : ""}`} onClick={() => toggle(p.id)}>{among.includes(p.id) ? "✓ " : ""}{p.name}</button>)}</div>
        </div>
        <div className="seg" role="tablist">
          {([["equal", "Equally"], ["shares", "By shares"], ["exact", "Exact amounts"]] as const).map(([k, l]) => <button type="button" key={k} className={`seg-btn${mode === k ? " on" : ""}`} onClick={() => setMode(k)}>{l}</button>)}
        </div>
        {mode !== "equal" && <div className="split-grid">{g.people.filter((p) => among.includes(p.id)).map((p) => <label key={p.id} className="split-row"><span>{p.name}</span><NumInput className="input" step={mode === "shares" ? "0.5" : "0.01"} value={shares[p.id] ?? (mode === "shares" ? "1" : "")} placeholder={mode === "shares" ? "1" : "0"} onChange={(e) => setShares({ ...shares, [p.id]: e.target.value })} /></label>)}
          {mode === "exact" && <div className={`tiny ${Math.round(exactTotal * 100) === Math.round(A * 100) ? "faint" : "warn"}`}>Amounts total {money(exactTotal)} of {money(A)}</div>}
          {mode === "shares" && <div className="tiny faint">2 means twice as much as 1. Use 0 to leave someone out.</div>}</div>}
        {A > 0 && draft.among.length > 0 && <div className="tx-bill">
          <div className="tx-bill-head">Each person's share</div>
          {g.people.filter((p) => among.includes(p.id)).map((p) => <div key={p.id} className="row between small"><span className="muted">{p.name}</span><span className="mono">{money(each[p.id] ?? 0)}</span></div>)}
        </div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

