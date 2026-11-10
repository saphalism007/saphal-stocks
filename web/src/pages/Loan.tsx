// Loan & EMI planner: a full, bank-style amortisation schedule with every option, grouped by Nepali fiscal
// year (or calendar year), plus "pay cash or take the loan and invest the rest?" and an affordability check.
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, Stat, Notice, NumInput } from "../components/ui.tsx";
import { compact, num, nptDate, rs } from "../lib/format.ts";
import { amortise, buyOrFinance, PER_YEAR, type Freq, type LoanInput, type Method, type Row } from "../../../shared/loan.ts";
import { toBS, fiscalYearOf, bsLabel, bsAvailable } from "../lib/bs.ts";

type N = number | "";
interface Form {
  mode: "amount" | "price"; principal: N; price: N; down: N; downIsPct: boolean; rate: N; years: N; months: N; installment: N;
  freq: Freq; method: Method; basis: "periodic" | "actual365"; balloon: N; roundTo: N; start: string;
  grace: N; capGrace: boolean; extraEach: N; extraFrom: N; lumps: { at: N; amount: N }[]; prepayMode: "shorten" | "reduce";
  rateChanges: { at: N; rate: N }[]; feePct: N; feeFixed: N; cash: N; invRet: N; invTax: N; income: N;
}
const today = new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10);
const DEF: Form = { mode: "amount", principal: 1_000_000, price: "", down: 20, downIsPct: true, rate: 11, years: 5, months: "", installment: "", freq: "monthly", method: "emi", basis: "periodic", balloon: "", roundTo: "", start: today, grace: "", capGrace: false, extraEach: "", extraFrom: "", lumps: [], prepayMode: "shorten", rateChanges: [], feePct: "", feeFixed: "", cash: "", invRet: "", invTax: 6, income: "" };
const KEY = "ss-loan-form";
const v = (x: N) => (x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
const FREQ_LABEL: Record<Freq, string> = { daily: "Daily", weekly: "Weekly", fortnightly: "Every 2 weeks", monthly: "Monthly", quarterly: "Quarterly", "half-yearly": "Half-yearly", yearly: "Yearly" };
const PAGE = 120;

export default function Loan() {
  const [f, setF] = useState<Form>(() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return DEF; } });
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* ignore */ } }, [f]);
  const set = <K extends keyof Form>(k: K, x: Form[K]) => setF((o) => ({ ...o, [k]: x }));

  const input: LoanInput = useMemo(() => ({
    principal: f.mode === "amount" ? v(f.principal) : null, price: f.mode === "price" ? v(f.price) : null,
    downPayment: f.mode === "price" && !f.downIsPct ? v(f.down) : null, downPaymentPct: f.mode === "price" && f.downIsPct ? v(f.down) : null,
    ratePct: v(f.rate), years: v(f.years), months: v(f.months), installment: v(f.installment),
    freq: f.freq, method: f.method, basis: f.basis, balloonPct: v(f.balloon), roundTo: v(f.roundTo), start: f.start || today,
    graceInstallments: v(f.grace), capitaliseGrace: f.capGrace, extraEach: v(f.extraEach), extraFrom: v(f.extraFrom),
    lumps: f.lumps.filter((l) => v(l.at) && v(l.amount)).map((l) => ({ at: v(l.at)!, amount: v(l.amount)! })), prepayMode: f.prepayMode,
    rateChanges: f.rateChanges.filter((c) => v(c.at) && v(c.rate) != null).map((c) => ({ at: v(c.at)!, ratePct: v(c.rate)! })),
    feePct: v(f.feePct), feeFixed: v(f.feeFixed),
  }), [f]);
  // If only years is blank but months is given (or vice versa) that's fine; if both blank, tenure is solved from the instalment.
  const res = useMemo(() => amortise({ ...input, years: input.years ?? (input.months != null ? 0 : null) }), [input]);

  const price = f.mode === "price" ? v(f.price) : res.ok ? res.principal : null;
  const downRs = f.mode === "price" && price ? (f.downIsPct ? (price * (v(f.down) ?? 0)) / 100 : v(f.down) ?? 0) : 0;
  const decide = res.ok && v(f.cash) != null && v(f.invRet) != null && price ? buyOrFinance({ price, cash: v(f.cash)!, downPayment: downRs, loan: res, investReturnPct: v(f.invRet)!, taxOnReturnPct: v(f.invTax) ?? 0, freq: res.freq }) : null;
  const monthlyEq = res.ok ? (res.installment * PER_YEAR[res.freq]) / 12 : null;
  const dti = res.ok && v(f.income) ? ((monthlyEq ?? 0) / v(f.income)!) * 100 : null;

  return (
    <div className="page">
      <div className="page-head"><div><h1>Loan & EMI Planner</h1><p className="muted">Bank-style amortisation with every option: payments from daily to yearly, EMI or equal principal, grace period, prepayments, floating rates and fees. Leave one of amount, rate, tenure or instalment empty and it is worked out. Then see whether paying cash or taking the loan and investing the rest leaves you richer.</p></div></div>
      <div className="ln-grid">
        <div className="ln-in">
          <Sec title="1. Loan">
            <div className="seg-row"><button className={`chip ${f.mode === "amount" ? "on" : ""}`} onClick={() => set("mode", "amount")}>Loan amount</button><button className={`chip ${f.mode === "price" ? "on" : ""}`} onClick={() => set("mode", "price")}>Asset price − down payment</button></div>
            {f.mode === "amount" ? <F label="Loan amount (principal) Rs."><NumInput className="input" value={f.principal} placeholder="leave empty to calculate" onChange={(e) => set("principal", e.target.value === "" ? "" : Number(e.target.value))} /></F> : <>
              <F label="Asset price Rs."><NumInput className="input" value={f.price} onChange={(e) => set("price", e.target.value === "" ? "" : Number(e.target.value))} /></F>
              <F label={`Down payment ${f.downIsPct ? "%" : "Rs."}`}><div className="row" style={{ gap: 6, flexWrap: "nowrap" }}><NumInput className="input" value={f.down} onChange={(e) => set("down", e.target.value === "" ? "" : Number(e.target.value))} /><button className="btn sm ghost" onClick={() => set("downIsPct", !f.downIsPct)}>{f.downIsPct ? "use Rs." : "use %"}</button></div></F>
            </>}
            <F label="Interest rate (% a year)"><NumInput className="input" value={f.rate} step={0.05} placeholder="leave empty to calculate" onChange={(e) => set("rate", e.target.value === "" ? "" : Number(e.target.value))} /></F>
            <div className="ln-two"><F label="Tenure: years"><NumInput className="input" value={f.years} onChange={(e) => set("years", e.target.value === "" ? "" : Number(e.target.value))} /></F><F label="+ months"><NumInput className="input" value={f.months} onChange={(e) => set("months", e.target.value === "" ? "" : Number(e.target.value))} /></F></div>
            <F label="Instalment Rs. (optional)"><NumInput className="input" value={f.installment} placeholder="calculated if empty" onChange={(e) => set("installment", e.target.value === "" ? "" : Number(e.target.value))} /></F>
          </Sec>
          <Sec title="2. Repayment">
            <F label="Pay every"><select className="input" value={f.freq} onChange={(e) => set("freq", e.target.value as Freq)}>{(Object.keys(FREQ_LABEL) as Freq[]).map((k) => <option key={k} value={k}>{FREQ_LABEL[k]}</option>)}</select></F>
            <F label="Method"><select className="input" value={f.method} onChange={(e) => set("method", e.target.value as Method)}><option value="emi">Equal instalments (EMI)</option><option value="equal-principal">Equal principal (falling instalments)</option><option value="interest-only">Interest only, principal at the end</option><option value="balloon">EMI with a balloon at the end</option></select></F>
            {f.method === "balloon" && <F label="Balloon (% of loan paid at the end)"><NumInput className="input" value={f.balloon} onChange={(e) => set("balloon", e.target.value === "" ? "" : Number(e.target.value))} /></F>}
            <F label="Interest calculated"><select className="input" value={f.basis} onChange={(e) => set("basis", e.target.value as Form["basis"])}><option value="periodic">Per instalment (rate ÷ payments a year)</option><option value="actual365">Daily on actual days, 365-day year (bank style)</option></select></F>
            <F label="Round instalment up to"><select className="input" value={String(f.roundTo)} onChange={(e) => set("roundTo", e.target.value === "" ? "" : Number(e.target.value))}><option value="">No rounding</option><option value="1">Rs. 1</option><option value="10">Rs. 10</option><option value="100">Rs. 100</option></select></F>
            <F label="Loan start (disbursement) date"><input type="date" className="input" value={f.start} onChange={(e) => set("start", e.target.value)} /></F>
          </Sec>
          <Sec title="3. Grace period" closed>
            <F label="Interest-only instalments at the start"><NumInput className="input" value={f.grace} onChange={(e) => set("grace", e.target.value === "" ? "" : Number(e.target.value))} /></F>
            <label className="cl-bool"><input type="checkbox" checked={f.capGrace} onChange={(e) => set("capGrace", e.target.checked)} /> Pay nothing in the grace period (interest added to the loan)</label>
          </Sec>
          <Sec title="4. Prepayments" closed>
            <div className="ln-two"><F label="Extra with every instalment Rs."><NumInput className="input" value={f.extraEach} onChange={(e) => set("extraEach", e.target.value === "" ? "" : Number(e.target.value))} /></F><F label="Starting at instalment #"><NumInput className="input" value={f.extraFrom} placeholder="1" onChange={(e) => set("extraFrom", e.target.value === "" ? "" : Number(e.target.value))} /></F></div>
            {f.lumps.map((l, i) => <div key={i} className="ln-two"><F label="Lump sum after instalment #"><NumInput className="input" value={l.at} onChange={(e) => set("lumps", f.lumps.map((x, j) => (j === i ? { ...x, at: e.target.value === "" ? "" : Number(e.target.value) } : x)))} /></F><F label="Amount Rs."><div className="row" style={{ gap: 4, flexWrap: "nowrap" }}><NumInput className="input" value={l.amount} onChange={(e) => set("lumps", f.lumps.map((x, j) => (j === i ? { ...x, amount: e.target.value === "" ? "" : Number(e.target.value) } : x)))} /><button className="btn sm ghost" onClick={() => set("lumps", f.lumps.filter((_, j) => j !== i))}>✕</button></div></F></div>)}
            <button className="btn sm ghost" onClick={() => set("lumps", [...f.lumps, { at: "", amount: "" }])}>+ Lump-sum prepayment</button>
            <F label="After a prepayment"><select className="input" value={f.prepayMode} onChange={(e) => set("prepayMode", e.target.value as Form["prepayMode"])}><option value="shorten">Keep the instalment, finish sooner</option><option value="reduce">Keep the end date, lower the instalment</option></select></F>
          </Sec>
          <Sec title="5. Floating rate changes" closed>
            {f.rateChanges.map((c, i) => <div key={i} className="ln-two"><F label="From instalment #"><NumInput className="input" value={c.at} onChange={(e) => set("rateChanges", f.rateChanges.map((x, j) => (j === i ? { ...x, at: e.target.value === "" ? "" : Number(e.target.value) } : x)))} /></F><F label="New rate %"><div className="row" style={{ gap: 4, flexWrap: "nowrap" }}><NumInput className="input" value={c.rate} step={0.05} onChange={(e) => set("rateChanges", f.rateChanges.map((x, j) => (j === i ? { ...x, rate: e.target.value === "" ? "" : Number(e.target.value) } : x)))} /><button className="btn sm ghost" onClick={() => set("rateChanges", f.rateChanges.filter((_, j) => j !== i))}>✕</button></div></F></div>)}
            <button className="btn sm ghost" onClick={() => set("rateChanges", [...f.rateChanges, { at: "", rate: "" }])}>+ Rate change</button>
            <p className="tiny faint" style={{ margin: 0 }}>Nepali bank loans usually float with the bank's base rate plus a premium; the instalment is recalculated when the rate changes.</p>
          </Sec>
          <Sec title="6. Fees" closed>
            <div className="ln-two"><F label="Processing fee %"><NumInput className="input" value={f.feePct} step={0.1} onChange={(e) => set("feePct", e.target.value === "" ? "" : Number(e.target.value))} /></F><F label="Other one-off charges Rs."><NumInput className="input" value={f.feeFixed} onChange={(e) => set("feeFixed", e.target.value === "" ? "" : Number(e.target.value))} /></F></div>
          </Sec>
          <Sec title="7. Should I pay cash or take the loan?">
            <F label="Cash you have for this Rs."><NumInput className="input" value={f.cash} placeholder="e.g. the full price" onChange={(e) => set("cash", e.target.value === "" ? "" : Number(e.target.value))} /></F>
            <div className="ln-two"><F label="Return if you invest it (% a year)"><NumInput className="input" value={f.invRet} step={0.25} placeholder="e.g. FD 5" onChange={(e) => set("invRet", e.target.value === "" ? "" : Number(e.target.value))} /></F><F label="Tax on that return %"><NumInput className="input" value={f.invTax} onChange={(e) => set("invTax", e.target.value === "" ? "" : Number(e.target.value))} /></F></div>
            <F label="Your monthly income Rs. (for affordability)"><NumInput className="input" value={f.income} onChange={(e) => set("income", e.target.value === "" ? "" : Number(e.target.value))} /></F>
          </Sec>
          <button className="btn sm ghost" onClick={() => setF(DEF)}>Reset all inputs</button>
        </div>

        <div className="ln-out">
          {!res.ok ? <Notice tone="warn">{res.error}</Notice> : <Results res={res} decide={decide} dti={dti} monthlyEq={monthlyEq} cash={v(f.cash)} price={price} />}
        </div>
      </div>
    </div>
  );
}

function Sec({ title, children, closed }: { title: string; children: React.ReactNode; closed?: boolean }) {
  const [open, setOpen] = useState(!closed);
  return <section className="ln-sec"><button className="ln-sec-h" onClick={() => setOpen(!open)}><b>{title}</b><span>{open ? "−" : "+"}</span></button>{open && <div className="ln-sec-b">{children}</div>}</section>;
}
function F({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field">{label}{children}</label>; }

function Results({ res, decide, dti, monthlyEq, cash, price }: { res: Extract<ReturnType<typeof amortise>, { ok: true }>; decide: ReturnType<typeof buyOrFinance> | null; dti: number | null; monthlyEq: number | null; cash: number | null; price: number | null }) {
  // Group by Nepali fiscal year when the calendar is available, otherwise by calendar year.
  const groups = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of res.rows) { const b = toBS(r.date); const k = b ? fiscalYearOf(b) : r.date.slice(0, 4); const a = m.get(k); if (a) a.push(r); else m.set(k, [r]); }
    return [...m.entries()].map(([k, rows]) => ({ k, rows, interest: rows.reduce((a, x) => a + x.interest, 0), principal: rows.reduce((a, x) => a + x.principal + x.extra, 0), paid: rows.reduce((a, x) => a + x.payment + x.extra, 0), closing: rows[rows.length - 1].closing }));
  }, [res]);
  const [open, setOpen] = useState<Record<string, number>>({});
  const [jump, setJump] = useState<N>("");
  const maxPaid = Math.max(...groups.map((g) => g.paid), 1);
  const csv = () => {
    const head = ["No", "Date (AD)", ...(bsAvailable ? ["Date (BS)", "Fiscal year"] : []), "Opening balance", "Rate %", "Instalment", "Interest", "Principal", "Extra", "Closing balance"];
    const lines = res.rows.map((r) => { const b = toBS(r.date); return [r.n, r.date, ...(bsAvailable && b ? [bsLabel(b), fiscalYearOf(b)] : []), r.opening, r.rate, r.payment, r.interest, r.principal, r.extra, r.closing].join(","); });
    const url = URL.createObjectURL(new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `loan-schedule-${res.principal}-${res.ratePct}pct.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const goTo = () => { const n = v(jump); if (!n) return; const g = groups.find((x) => x.rows.some((r) => r.n === n)); if (!g) return; const idx = g.rows.findIndex((r) => r.n === n); setOpen((o) => ({ ...o, [g.k]: Math.max(o[g.k] ?? 0, idx + 20) })); setTimeout(() => document.getElementById(`ln-r${n}`)?.scrollIntoView({ block: "center" }), 100); };
  return (
    <div className="col">
      <div className="grid g4 ln-stats">
        <Stat label={`${FREQ_LABEL[res.freq]} instalment`} value={rs(res.installment, 0)} sub={res.freq !== "monthly" && monthlyEq ? `≈ ${rs(monthlyEq, 0)} a month` : `${res.installments} instalments`} />
        <Stat label="Total interest" value={compact(res.totalInterest)} sub={`${num(res.interestToPrincipalPct, 1)}% of the loan`} tone="down" />
        <Stat label="Total you pay" value={compact(res.totalPaid + res.fees)} sub={res.fees ? `incl. fees ${rs(res.fees, 0)}` : `on a ${compact(res.principal)} loan`} />
        <Stat label="Loan ends" value={nptDate(res.payoffDate)} sub={`${res.installments} × ${FREQ_LABEL[res.freq].toLowerCase()}`} />
      </div>
      <div className="ln-facts small">
        <span>Loan <b>{rs(res.principal, 0)}</b></span><span>Rate <b>{num(res.ratePct, 3)}%</b></span><span>Effective yearly <b>{num(res.effectiveAnnualPct, 2)}%</b></span>
        {res.aprWithFeesPct != null && <span>True cost with fees <b>{num(res.aprWithFeesPct, 2)}%</b></span>}
        {res.savedByExtras && <span className="up">Prepayments save <b>{compact(res.savedByExtras.interest)}</b> interest and <b>{res.savedByExtras.installments}</b> instalments</span>}
      </div>
      {res.notes.map((n) => <div key={n} className="tiny faint">{n}</div>)}

      {(decide || dti != null) && <Card title="Pay cash or take the loan?">
        {dti != null && <p className={`small ${dti > 50 ? "down" : dti > 35 ? "warn" : "up"}`} style={{ marginTop: 0 }}>Instalment is <b>{num(dti, 1)}%</b> of your monthly income. {dti > 50 ? "Above the ~50% limit banks use: too heavy." : dti > 35 ? "Manageable but tight; keep total EMIs under about 35%." : "Comfortable."}</p>}
        {decide && <>
          <p className="small" style={{ margin: "0 0 6px" }}>At the end of the loan ({nptDate(res.payoffDate)}):</p>
          <dl className="kv text small">
            <dt>Pay in full, invest what's left</dt><dd style={{ textAlign: "right" }}><b>{decide.canAfford ? rs(decide.cashLeftIfFull, 0) : "can't — not enough cash"}</b></dd>
            <dt>Take the loan, invest your cash, pay instalments from it</dt><dd style={{ textAlign: "right" }}><b className={decide.investmentLeftIfLoan < 0 ? "down" : ""}>{rs(decide.investmentLeftIfLoan, 0)}</b></dd>
          </dl>
          <div className={`notice ${decide.better === "loan" ? "info" : ""}`}><div>{decide.better === "loan"
            ? `Taking the loan and investing leaves you about ${rs(decide.difference, 0)} richer — but only if the investment really earns that return every year. Loan interest is certain; investment returns are not. Use safe, steady investments (FD, bonds) for this, not shares, and keep an emergency fund.`
            : `Paying cash leaves you about ${rs(decide.difference, 0)} better off: the loan costs more than your investment would earn after tax.${decide.ranOut ? ` Your invested cash would also run out around ${nptDate(decide.ranOut)}.` : ""}`}</div></div>
        </>}
        <div className="tiny faint" style={{ marginTop: 6 }}>The rule: borrowing to keep your money invested only pays when the after-tax return is reliably higher than the loan's true cost (here {num(res.aprWithFeesPct ?? res.effectiveAnnualPct, 2)}% a year). For things that lose value (phones, TVs, cars), saving first is usually cheaper — see the <Link to="/purchases">Purchase Planner</Link>.</div>
      </Card>}

      <Card title={bsAvailable ? "By Nepali fiscal year" : "By year"} sub="Interest and principal paid each year, and what you still owe" flush>
        <div className="table-scroll" style={{ maxHeight: 340 }}><table className="t small">
          <thead><tr><th>{bsAvailable ? "Fiscal year" : "Year"}</th><th className="num">Paid</th><th className="num">Interest</th><th className="num">Principal</th><th className="num">Balance</th><th style={{ width: 90 }}></th></tr></thead>
          <tbody>{groups.map((g) => <tr key={g.k}><td>{g.k}</td><td className="num">{num(g.paid, 0)}</td><td className="num down">{num(g.interest, 0)}</td><td className="num">{num(g.principal, 0)}</td><td className="num">{num(g.closing, 0)}</td><td><div className="ln-bar"><i className="i" style={{ width: `${(g.interest / maxPaid) * 100}%` }} /><i className="p" style={{ width: `${(g.principal / maxPaid) * 100}%` }} /></div></td></tr>)}</tbody>
        </table></div>
      </Card>

      <Card title="Full schedule" sub={`${res.rows.length.toLocaleString()} instalments · tap a year to open it`} actions={<button className="btn sm" onClick={csv}>Download CSV</button>}>
        <div className="row" style={{ gap: 6, marginBottom: 8 }}><NumInput className="input" value={jump} placeholder="Instalment #" style={{ width: 130 }} onChange={(e) => setJump(e.target.value === "" ? "" : Number(e.target.value))} /><button className="btn sm ghost" onClick={goTo}>Go</button>
          <button className="btn sm ghost" onClick={() => setOpen(Object.fromEntries(groups.map((g) => [g.k, PAGE])))}>Open all years</button><button className="btn sm ghost" onClick={() => setOpen({})}>Close all</button></div>
        <div className="ln-sched">{groups.map((g) => { const shown = open[g.k] ?? 0; return (
          <div key={g.k} className="ln-group">
            <button className="ln-gh" onClick={() => setOpen((o) => ({ ...o, [g.k]: shown ? 0 : PAGE }))}><b>{bsAvailable ? `FY ${g.k}` : g.k}</b><span>{g.rows.length} instalment{g.rows.length === 1 ? "" : "s"} · interest {compact(g.interest)} · balance {compact(g.closing)}</span><span>{shown ? "−" : "+"}</span></button>
            {shown > 0 && <div className="table-scroll"><table className="t small ln-t">
              <thead><tr><th>#</th><th>Date</th>{bsAvailable && <th>Nepali date</th>}<th className="num">Opening</th><th className="num">Instalment</th><th className="num">Interest</th><th className="num">Principal</th><th className="num">Extra</th><th className="num">Closing</th></tr></thead>
              <tbody>{g.rows.slice(0, shown).map((r) => { const b = bsAvailable ? toBS(r.date) : null; return (
                <tr key={r.n} id={`ln-r${r.n}`}><td>{r.n}</td><td className="nowrap">{nptDate(r.date)}</td>{bsAvailable && <td className="nowrap">{b ? bsLabel(b) : "—"}</td>}<td className="num">{num(r.opening, 2)}</td><td className="num">{num(r.payment, 2)}</td><td className="num down">{num(r.interest, 2)}</td><td className="num">{num(r.principal, 2)}</td><td className="num">{r.extra ? num(r.extra, 2) : ""}</td><td className="num"><b>{num(r.closing, 2)}</b></td></tr>
              ); })}</tbody>
            </table>{g.rows.length > shown && <button className="btn sm ghost" style={{ margin: 6 }} onClick={() => setOpen((o) => ({ ...o, [g.k]: shown + PAGE }))}>Show {Math.min(PAGE, g.rows.length - shown)} more of {g.rows.length - shown}</button>}</div>}
          </div>
        ); })}</div>
        <div className="tiny faint" style={{ marginTop: 6 }}>Totals: instalments {rs(res.totalPaid - res.totalExtra, 2)} · interest {rs(res.totalInterest, 2)} · prepayments {rs(res.totalExtra, 2)}. {bsAvailable ? "" : "Nepali dates and fiscal years appear once the Nepali calendar is added."}</div>
      </Card>

      <Card title="Using a loan wisely">
        <ul className="small" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
          <li><b>Borrow for things that earn or grow</b> (a home you live in or rent out, a business, education). Avoid loans for things that lose value.</li>
          <li><b>EMI + invest only works when your safe, after-tax return beats the loan's true cost.</b> Example: a 9% loan vs an FD paying 5% after tax loses money; a 12% loan vs shares that might return 15% is a gamble, not a plan.</li>
          <li><b>Keep total EMIs under about 35% of income</b> and an emergency fund of 3–6 months, including the EMI.</li>
          <li><b>Prepay early.</b> Interest is highest in the first years; even small extra payments save a lot (try the Prepayments section).</li>
          <li><b>Ask the bank for:</b> the base rate + premium, how often it changes, prepayment charges, processing and other fees. Compare the "true cost with fees", not just the rate.</li>
        </ul>
      </Card>
    </div>
  );
}
