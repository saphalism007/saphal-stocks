// My Money: income, expenses, accounts, investments and loans in one place, with net worth,
// cash flow, savings rate, emergency fund, allocation and specific, rupee-valued suggestions.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { Card, Stat, Loading, ErrorBox, Tabs, Badge, Notice, Empty } from "../components/ui.tsx";
import { I } from "../components/icons.tsx";
import { compact, num, pct, tone, nptDate } from "../lib/format.ts";
import { CLASS, EXPENSE_CATEGORIES, EMPTY_MONEY, summarize, type MoneyData, type MoneySummary, type Advice, type AccountType, type LiabilityType, type MarketRates } from "../../../shared/money.ts";

interface Overview { saved: boolean; data: MoneyData; summary: MoneySummary; advice: Advice[]; rates: MarketRates & { sources: Record<string, string> }; portfolioValue: number; goals: { name: string; amount: number; years: number }[] }
type Tab = "overview" | "cash" | "accounts" | "loans" | "prefs";
const uid = () => Math.random().toString(36).slice(2, 9);
const LIAB: [LiabilityType, string][] = [["home", "Home loan"], ["car", "Car / vehicle loan"], ["personal", "Personal loan"], ["education", "Education loan"], ["credit_card", "Credit card"], ["business", "Business loan"], ["family", "Borrowed from family / friends"], ["other", "Other"]];
const KIND_COLOR: Record<string, string> = { cash: "var(--blue)", guaranteed: "var(--up)", market: "var(--violet)", illiquid: "var(--text-3)" };
const KIND_LABEL: Record<string, string> = { cash: "Cash & savings", guaranteed: "Guaranteed (FD, bonds)", market: "Market-linked", illiquid: "Long-term / illiquid" };

export default function Money() {
  const o = useApi<Overview>("/money");
  const [tab, setTab] = useState<Tab>("overview");
  const [d, setD] = useState<MoneyData>(EMPTY_MONEY);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (o.data) { setD(o.data.data); setDirty(false); } }, [o.data]);
  const live = useMemo(() => summarize(d, { portfolioValue: o.data?.portfolioValue }), [d, o.data?.portfolioValue]);
  if (o.error) return <ErrorBox error={o.error} onRetry={o.reload} />;
  if (!o.data) return <Loading />;
  const set = (next: MoneyData) => { setD(next); setDirty(true); };
  const save = async () => { setSaving(true); try { await api("/money", { method: "PUT", body: d }); await o.reload(); } finally { setSaving(false); } };
  const s = dirty ? live : o.data.summary;
  return (
    <div className="page">
      <div className="page-head row between">
        <div><h1>My Money</h1><p className="muted">Income, spending, savings, investments and loans in NPR. Saved on this device{o.data.saved ? "" : " (nothing saved yet)"}.</p></div>
        <div className="row">
          {dirty && <span className="small warn">Unsaved changes</span>}
          <button className="btn primary" disabled={!dirty || saving} onClick={save}>{saving ? <span className="spinner" /> : "Save"}</button>
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "overview", label: "Overview" }, { key: "cash", label: "Income & expenses" }, { key: "accounts", label: "Savings & investments" }, { key: "loans", label: "Loans" }, { key: "prefs", label: "Risk & goals" }]} />
      {tab === "overview" && <OverviewTab s={s} o={o.data} advice={dirty ? null : o.data.advice} onEdit={setTab} />}
      {tab === "cash" && <CashTab d={d} set={set} s={s} />}
      {tab === "accounts" && <AccountsTab d={d} set={set} portfolioValue={o.data.portfolioValue} />}
      {tab === "loans" && <LoansTab d={d} set={set} />}
      {tab === "prefs" && <PrefsTab d={d} set={set} goals={o.data.goals} />}
    </div>
  );
}

function OverviewTab({ s, o, advice, onEdit }: { s: MoneySummary; o: Overview; advice: Advice[] | null; onEdit: (t: Tab) => void }) {
  const start = (
    <Card title="Start with three numbers">
      <p className="small">Enter your monthly income and spending, what you have saved or invested, and any loans. Everything stays on this device (and in your encrypted sync if you turned it on).</p>
      <div className="row"><button className="btn primary" onClick={() => onEdit("cash")}>Add income & expenses</button><button className="btn" onClick={() => onEdit("accounts")}>Add savings & investments</button><button className="btn" onClick={() => onEdit("loans")}>Add loans</button></div>
    </Card>
  );
  const empty = !s.income && !s.assets && !s.liabilities;
  if (empty) return start;

  const r = o.rates;
  return (
    <div className="col">
      {!s.income && start}
      <div className="grid g4">
        <Stat label="Net worth" value={compact(s.netWorth)} sub={`Assets ${compact(s.assets)} · loans ${compact(s.liabilities)}`} />
        <Stat label="Monthly cash flow" value={compact(s.cashFlow)} tone={tone(s.cashFlow)} sub={`Income ${compact(s.income)} − spending ${compact(s.expenses)} − EMIs ${compact(s.emi)}`} />
        <Stat label="Savings rate" value={s.savingsRatePct != null ? `${num(s.savingsRatePct, 1)}%` : "—"} sub={s.savingsRatePct == null ? "Add income" : s.savingsRatePct >= 30 ? <span className="up">Excellent</span> : s.savingsRatePct >= 20 ? <span className="up">Healthy</span> : <span className="warn">Aim for 20%+</span>} />
        <Stat label="Emergency fund" value={s.emergencyMonthsCovered != null ? `${num(s.emergencyMonthsCovered, 1)} months` : "—"} sub={s.emergencyTarget === 0 ? "Add your monthly spending" : s.emergencyGap > 0 ? <span className="warn">Short by {compact(s.emergencyGap)}</span> : <span className="up">Covered ({compact(s.emergencyTarget)} target)</span>} />
      </div>
      <div className="grid g3">
        <Card title="Where your money is" className="span2" sub="Guaranteed returns are contractual; market-linked returns are not guaranteed">
          <div className="alloc-bar" style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", marginBottom: 12 }}>
            {(["cash", "guaranteed", "market", "illiquid"] as const).filter((k) => s.byKind[k] > 0).map((k) => <div key={k} title={`${KIND_LABEL[k]} ${compact(s.byKind[k])}`} style={{ width: `${(s.byKind[k] / s.assets) * 100}%`, background: KIND_COLOR[k] }} />)}
          </div>
          <div className="row small" style={{ gap: 14, marginBottom: 10 }}>{(["cash", "guaranteed", "market", "illiquid"] as const).map((k) => <span key={k} className="row" style={{ gap: 6 }}><span className="dot" style={{ background: KIND_COLOR[k] }} />{KIND_LABEL[k]} {s.assets ? `${num((s.byKind[k] / s.assets) * 100, 0)}%` : ""}</span>)}</div>
          <table className="t small"><tbody>{s.allocation.map((a) => <tr key={a.type}><td>{a.label}</td><td className="num">{compact(a.value)}</td><td className="num muted">{num(a.pct, 1)}%</td></tr>)}</tbody></table>
          {o.portfolioValue > 0 && <p className="tiny faint">Includes your Portfolio holdings at the latest prices ({compact(o.portfolioValue)}).</p>}
        </Card>
        <div className="col">
          <Stat label="EMIs / income" value={s.debtServicePct != null ? `${num(s.debtServicePct, 1)}%` : "—"} sub={s.debtServicePct == null ? "" : s.debtServicePct > 40 ? <span className="down">High (above 40%)</span> : s.debtServicePct > 30 ? <span className="warn">Moderate</span> : <span className="up">Comfortable</span>} />
          <Stat label="Average loan rate" value={s.weightedDebtRatePct != null ? `${num(s.weightedDebtRatePct, 1)}%` : "No loans"} />
          <Stat label="Shares in investable money" value={s.equityPct != null ? `${num(s.equityPct, 0)}%` : "—"} sub="Cash + guaranteed + market-linked" />
        </div>
      </div>
      <Card title="What to do next" sub="From your numbers and current official rates; each line says how much it is worth" actions={<Link className="btn sm" to="/invest"><I.opportunities /> Where to invest</Link>}>
        {advice == null ? <Notice>Save your changes to refresh the suggestions.</Notice> : advice.length === 0 ? <Empty title="Nothing urgent. Your basics are in place." /> : (
          <div className="list">{advice.map((a, i) => (
            <div key={i} className="list-row" style={{ alignItems: "flex-start" }}>
              <Badge tone={a.priority === 1 ? "down" : a.priority === 2 ? "warn" : "blue"}>{a.priority === 1 ? "First" : a.priority === 2 ? "Next" : "Consider"}</Badge>
              <div style={{ flex: 1 }}><div><strong>{a.title}</strong></div><div className="small muted">{a.detail}</div></div>
              {a.yearlyImpact ? <span className="small mono up" title="Worth per year">+{compact(a.yearlyImpact)}/yr</span> : null}
            </div>
          ))}</div>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <Link className="btn sm" to={`/analyst?q=${encodeURIComponent("Look at my money (income, expenses, savings, investments, loans and goals) and give me a prioritised plan for the next 12 months with specific Nepali options and rupee amounts.")}`}><I.ai /> Ask the AI advisor</Link>
        </div>
      </Card>
      <Card title="Rates used" sub="Sources and dates">
        <dl className="kv small">
          <dt>Fixed deposit</dt><dd>{r.fdPct != null ? `${num(r.fdPct)}% (${num(r.fdPct * (1 - r.interestTaxPct / 100))}% after ${r.interestTaxPct}% tax)` : "Unavailable"} <span className="faint">{r.sources.fd}</span></dd>
          <dt>Savings account</dt><dd>{r.savingPct != null ? `${num(r.savingPct)}%` : "Unavailable"} <span className="faint">{r.sources.saving}</span></dd>
          <dt>Inflation</dt><dd>{r.inflationPct != null ? `${num(r.inflationPct)}%` : "Unavailable"} <span className="faint">{r.sources.inflation}</span></dd>
          <dt>NEPSE long run</dt><dd>{r.equityLongRunPct != null ? `${num(r.equityLongRunPct, 1)}% a year, not guaranteed` : "Unavailable"} <span className="faint">{r.sources.equity}</span></dd>
        </dl>
      </Card>
    </div>
  );
}

function Num({ value, onChange, placeholder, w = 130 }: { value: number | null | undefined; onChange: (v: number) => void; placeholder?: string; w?: number }) {
  return <input className="input num" style={{ width: w }} type="number" inputMode="decimal" value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(Number(e.target.value) || 0)} />;
}

function CashTab({ d, set, s }: { d: MoneyData; set: (d: MoneyData) => void; s: MoneySummary }) {
  const byCat = new Map<string, number>();
  for (const e of d.expenses) byCat.set(e.category || "other", (byCat.get(e.category || "other") ?? 0) + e.amount);
  return (
    <div className="grid g2">
      <Card title="Monthly income (take-home)" actions={<button className="btn sm" onClick={() => set({ ...d, income: [...d.income, { id: uid(), label: "", amount: 0 }] })}><I.plus /> Add</button>}>
        {d.income.length === 0 && <Empty title="Add your salary and any other regular income" />}
        {d.income.map((x, i) => (
          <div key={x.id} className="row" style={{ marginBottom: 6 }}>
            <input className="input" style={{ flex: 1 }} value={x.label} placeholder="e.g. Salary, rent received" onChange={(e) => { const l = [...d.income]; l[i] = { ...x, label: e.target.value }; set({ ...d, income: l }); }} />
            <Num value={x.amount} onChange={(v) => { const l = [...d.income]; l[i] = { ...x, amount: v }; set({ ...d, income: l }); }} />
            <button className="btn ghost sm" aria-label="Remove" onClick={() => set({ ...d, income: d.income.filter((y) => y.id !== x.id) })}><I.trash /></button>
          </div>
        ))}
        <div className="row between small" style={{ marginTop: 8 }}><span>Total income</span><strong className="mono">{compact(s.income)}</strong></div>
      </Card>
      <Card title="Monthly spending" sub="Loan EMIs go under Loans" actions={<button className="btn sm" onClick={() => set({ ...d, expenses: [...d.expenses, { id: uid(), label: "", amount: 0, category: "other", essential: true }] })}><I.plus /> Add</button>}>
        {d.expenses.length === 0 && <Empty title="Add rent, food, transport, school fees, phone, eating out…" />}
        {d.expenses.map((x, i) => {
          const up = (p: Partial<typeof x>) => { const l = [...d.expenses]; l[i] = { ...x, ...p }; set({ ...d, expenses: l }); };
          return (
            <div key={x.id} className="row wrap" style={{ marginBottom: 6 }}>
              <input className="input" style={{ flex: "1 1 140px" }} value={x.label} placeholder="What" onChange={(e) => up({ label: e.target.value })} />
              <select className="input" value={x.category ?? "other"} onChange={(e) => up({ category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
              <Num value={x.amount} onChange={(v) => up({ amount: v })} w={110} />
              <label className="chk small" title="Essential spending counts toward the emergency fund target"><input type="checkbox" checked={x.essential !== false} onChange={(e) => up({ essential: e.target.checked })} />Essential</label>
              <button className="btn ghost sm" aria-label="Remove" onClick={() => set({ ...d, expenses: d.expenses.filter((y) => y.id !== x.id) })}><I.trash /></button>
            </div>
          );
        })}
        <div className="row between small" style={{ marginTop: 8 }}><span>Total spending (essential {compact(s.essential)})</span><strong className="mono">{compact(s.expenses)}</strong></div>
      </Card>
      <Card title="Budget by category" sub="Share of take-home income" className="span2">
        {s.income === 0 || byCat.size === 0 ? <Empty title="Add income and spending to see your budget" /> : (
          <table className="t small"><thead><tr><th>Category</th><th className="num">Monthly</th><th className="num">% of income</th><th className="num">Yearly</th></tr></thead>
            <tbody>{[...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => <tr key={k}><td>{EXPENSE_CATEGORIES.find((c) => c.key === k)?.label ?? k}</td><td className="num">{compact(v)}</td><td className="num">{pct((v / s.income) * 100, 1, false)}</td><td className="num muted">{compact(v * 12)}</td></tr>)}
              <tr><td><strong>Left to save or invest</strong></td><td className={`num ${tone(s.cashFlow)}`}><strong>{compact(s.cashFlow)}</strong></td><td className="num">{s.savingsRatePct != null ? `${num(s.savingsRatePct, 1)}%` : "—"}</td><td className="num muted">{compact(s.cashFlow * 12)}</td></tr>
            </tbody></table>
        )}
      </Card>
    </div>
  );
}

function AccountsTab({ d, set, portfolioValue }: { d: MoneyData; set: (d: MoneyData) => void; portfolioValue: number }) {
  const add = (type: AccountType) => set({ ...d, accounts: [...d.accounts, { id: uid(), name: CLASS[type].label, type, balance: 0 }] });
  return (
    <Card title="Savings, deposits and investments" sub="Current values in NPR" actions={<select className="input" value="" onChange={(e) => e.target.value && add(e.target.value as AccountType)}><option value="">+ Add…</option>{(Object.keys(CLASS) as AccountType[]).map((t) => <option key={t} value={t}>{CLASS[t].label}</option>)}</select>}>
      {portfolioValue > 0 && !d.accounts.some((a) => a.type === "stocks") && <Notice>Your Portfolio holdings ({compact(portfolioValue)} at latest prices) are counted automatically as NEPSE shares.</Notice>}
      {d.accounts.length === 0 && <Empty title="Add bank balances, fixed deposits, shares, mutual funds, PF/CIT/SSF, gold, property…" />}
      {d.accounts.map((a, i) => {
        const up = (p: Partial<typeof a>) => { const l = [...d.accounts]; l[i] = { ...a, ...p }; set({ ...d, accounts: l }); };
        return (
          <div key={a.id} className="row wrap" style={{ marginBottom: 6 }}>
            <select className="input" value={a.type} onChange={(e) => up({ type: e.target.value as AccountType })}>{(Object.keys(CLASS) as AccountType[]).map((t) => <option key={t} value={t}>{CLASS[t].label}</option>)}</select>
            <input className="input" style={{ flex: "1 1 140px" }} value={a.name} placeholder="Name" onChange={(e) => up({ name: e.target.value })} />
            <input className="input" style={{ width: 140 }} value={a.institution ?? ""} placeholder="Bank / provider" onChange={(e) => up({ institution: e.target.value })} />
            <Num value={a.balance} onChange={(v) => up({ balance: v })} placeholder="Value" />
            {["bank", "fd", "bond", "debenture", "pf", "cit"].includes(a.type) && <Num value={a.ratePct ?? null} onChange={(v) => up({ ratePct: v })} placeholder="Rate %" w={80} />}
            {["fd", "bond", "debenture"].includes(a.type) && <input className="input" type="date" style={{ width: 150 }} value={a.maturity ?? ""} onChange={(e) => up({ maturity: e.target.value })} title="Maturity date" />}
            <Badge tone={CLASS[a.type].kind === "guaranteed" ? "up" : CLASS[a.type].kind === "market" ? "warn" : ""}>{KIND_LABEL[CLASS[a.type].kind]}</Badge>
            <button className="btn ghost sm" aria-label="Remove" onClick={() => set({ ...d, accounts: d.accounts.filter((y) => y.id !== a.id) })}><I.trash /></button>
          </div>
        );
      })}
      {d.accounts.some((a) => a.type === "fd" && a.maturity) && (
        <div style={{ marginTop: 12 }}><div className="small muted">Upcoming FD / bond maturities</div>
          {d.accounts.filter((a) => a.maturity).sort((a, b) => String(a.maturity).localeCompare(String(b.maturity))).map((a) => <div key={a.id} className="row between small"><span>{a.name} {a.institution ? `· ${a.institution}` : ""}</span><span className="mono">{nptDate(a.maturity!)} · {compact(a.balance)}</span></div>)}
        </div>
      )}
    </Card>
  );
}

function LoansTab({ d, set }: { d: MoneyData; set: (d: MoneyData) => void }) {
  return (
    <Card title="Loans and other debts" actions={<button className="btn sm" onClick={() => set({ ...d, liabilities: [...d.liabilities, { id: uid(), name: "", type: "personal", balance: 0, ratePct: 0, emi: 0 }] })}><I.plus /> Add</button>}>
      {d.liabilities.length === 0 && <Empty title="No loans entered" />}
      {d.liabilities.map((l, i) => {
        const up = (p: Partial<typeof l>) => { const x = [...d.liabilities]; x[i] = { ...l, ...p }; set({ ...d, liabilities: x }); };
        const yearlyInterest = l.balance * l.ratePct / 100;
        return (
          <div key={l.id} className="row wrap" style={{ marginBottom: 6 }}>
            <select className="input" value={l.type} onChange={(e) => up({ type: e.target.value as LiabilityType })}>{LIAB.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input className="input" style={{ flex: "1 1 140px" }} value={l.name} placeholder="Name / lender" onChange={(e) => up({ name: e.target.value })} />
            <label className="small muted">Outstanding <Num value={l.balance} onChange={(v) => up({ balance: v })} /></label>
            <label className="small muted">Rate % <Num value={l.ratePct} onChange={(v) => up({ ratePct: v })} w={80} /></label>
            <label className="small muted">EMI <Num value={l.emi} onChange={(v) => up({ emi: v })} w={110} /></label>
            {yearlyInterest > 0 && <span className="small down" title="Interest per year at the current balance">{compact(yearlyInterest)}/yr interest</span>}
            <button className="btn ghost sm" aria-label="Remove" onClick={() => set({ ...d, liabilities: d.liabilities.filter((y) => y.id !== l.id) })}><I.trash /></button>
          </div>
        );
      })}
      <p className="tiny faint" style={{ marginTop: 8 }}>Use <Link to="/invest">Where to invest → Prepay or invest?</Link> to compare paying a loan early with investing the money.</p>
    </Card>
  );
}

function PrefsTab({ d, set, goals }: { d: MoneyData; set: (d: MoneyData) => void; goals: { name: string; amount: number; years: number }[] }) {
  return (
    <div className="grid g2">
      <Card title="Risk and time horizon" sub="Used by the allocation advisor">
        <div className="form-grid">
          <label className="field">Risk tolerance<select className="input" value={d.risk} onChange={(e) => set({ ...d, risk: e.target.value as MoneyData["risk"] })}><option value="low">Low: protect capital</option><option value="medium">Medium: balanced</option><option value="high">High: growth, accept big swings</option></select></label>
          <label className="field">Main investment horizon (years)<input className="input" type="number" value={d.horizonYears} onChange={(e) => set({ ...d, horizonYears: Number(e.target.value) || 0 })} /></label>
          <label className="field">Emergency fund (months of essential costs)<input className="input" type="number" min={1} max={24} value={d.emergencyMonths} onChange={(e) => set({ ...d, emergencyMonths: Math.max(1, Number(e.target.value) || 6) })} /></label>
        </div>
      </Card>
      <Card title="Your goals" actions={<Link className="btn sm" to="/planner">Manage goals</Link>}>
        {goals.length === 0 ? <Empty title="No goals yet"><Link to="/planner">Add a goal</Link> (car, house, land, education, retirement…)</Empty> : (
          <table className="t small"><tbody>{goals.map((g, i) => <tr key={i}><td>{g.name}</td><td className="num">{compact(g.amount)}</td><td className="num muted">in {num(g.years, 0)} yr</td></tr>)}</tbody></table>
        )}
        <p className="tiny faint">Goals within 3 years are kept out of shares by the allocation advisor.</p>
      </Card>
    </div>
  );
}
