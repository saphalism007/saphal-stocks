// Loan amortisation, bank style. Any three of principal / rate / tenure / instalment give the fourth.
// Frequencies from daily to yearly; equal instalments (EMI), equal principal, interest-only (bullet) or
// a balloon; interest per period or accrued daily on actual days (365, as Nepali banks do); grace period;
// extra and lump-sum prepayments (shorten the loan or lower the instalment); floating-rate changes; fees.
// Pure; tested. Dates are ISO (AD); a Nepali-calendar converter can be passed in for BS dates and fiscal years.

export type Freq = "daily" | "weekly" | "fortnightly" | "monthly" | "quarterly" | "half-yearly" | "yearly";
export const PER_YEAR: Record<Freq, number> = { daily: 365, weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, "half-yearly": 2, yearly: 1 };
export type Method = "emi" | "equal-principal" | "interest-only" | "balloon";

export interface LoanInput {
  principal?: number | null; price?: number | null; downPayment?: number | null; downPaymentPct?: number | null;
  ratePct?: number | null; years?: number | null; months?: number | null; installments?: number | null; installment?: number | null;
  freq?: Freq; method?: Method; basis?: "periodic" | "actual365"; balloonPct?: number | null;
  start?: string | null; // disbursement date (YYYY-MM-DD)
  graceInstallments?: number | null; capitaliseGrace?: boolean; // interest-only first N instalments (or added to the loan)
  extraEach?: number | null; extraFrom?: number | null; // extra principal with every instalment from instalment N
  lumps?: { at: number; amount: number }[]; // one-off prepayments after instalment number `at`
  prepayMode?: "shorten" | "reduce";
  rateChanges?: { at: number; ratePct: number }[]; // new rate from instalment `at`
  feePct?: number | null; feeFixed?: number | null; roundTo?: number | null;
}
export interface Row { n: number; date: string; opening: number; rate: number; payment: number; interest: number; principal: number; extra: number; closing: number }
export interface LoanResult {
  ok: true; principal: number; ratePct: number; freq: Freq; method: Method; installments: number; installment: number; solved: string | null;
  rows: Row[]; totalInterest: number; totalPaid: number; totalExtra: number; fees: number; payoffDate: string; firstDate: string;
  effectiveAnnualPct: number; aprWithFeesPct: number | null; interestToPrincipalPct: number; savedByExtras: { interest: number; installments: number } | null; notes: string[];
}
export type LoanOutput = LoanResult | { ok: false; error: string; need?: string[] };

const r2 = (x: number) => Math.round(x * 100) / 100;
const pmt = (P: number, r: number, n: number) => (n <= 0 ? P : r === 0 ? P / n : (P * r) / (1 - Math.pow(1 + r, -n)));
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function addPeriod(start: string, freq: Freq, k: number) {
  const d = new Date(`${start}T00:00:00Z`);
  if (freq === "daily") d.setUTCDate(d.getUTCDate() + k);
  else if (freq === "weekly") d.setUTCDate(d.getUTCDate() + 7 * k);
  else if (freq === "fortnightly") d.setUTCDate(d.getUTCDate() + 14 * k);
  else {
    const m = k * (freq === "monthly" ? 1 : freq === "quarterly" ? 3 : freq === "half-yearly" ? 6 : 12);
    const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + m);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last)); // 31 Jan + 1 month = 28/29 Feb, as banks do
  }
  return iso(d);
}
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Fills in whichever of principal / rate / number of instalments / instalment is missing (EMI method). */
export function solve(inp: LoanInput) {
  const freq = inp.freq ?? "monthly", f = PER_YEAR[freq];
  let P = inp.principal ?? null;
  if (P == null && inp.price != null) { const dp = inp.downPayment ?? (inp.downPaymentPct != null ? (inp.price * inp.downPaymentPct) / 100 : 0); P = inp.price - dp; }
  let n = inp.installments ?? (inp.years != null || inp.months != null ? Math.round(((inp.years ?? 0) * 12 + (inp.months ?? 0)) / 12 * f) : null);
  let rate = inp.ratePct ?? null, A = inp.installment ?? null;
  const missing = [P == null && "principal", rate == null && "interest rate", n == null && "tenure", A == null && "instalment"].filter(Boolean) as string[];
  if (missing.length > 1) return { error: `Enter at least three of: loan amount, interest rate, tenure and instalment (missing ${missing.join(", ")}).`, need: missing };
  let solved: string | null = null;
  if (P != null && P <= 0) return { error: "The loan amount must be more than zero (check the down payment)." };
  if (missing[0] === "instalment") { A = pmt(P!, rate! / 100 / f, n!); solved = null; }
  else if (missing[0] === "tenure") {
    const r = rate! / 100 / f;
    if (A! <= P! * r) return { error: `An instalment of ${r2(A!)} doesn't even cover the interest (${r2(P! * r)} per period). Increase it.` };
    n = Math.ceil(r === 0 ? P! / A! : -Math.log(1 - (P! * r) / A!) / Math.log(1 + r)); solved = "tenure";
  } else if (missing[0] === "principal") { const r = rate! / 100 / f; P = r === 0 ? A! * n! : (A! * (1 - Math.pow(1 + r, -n!))) / r; solved = "principal"; }
  else if (missing[0] === "interest rate") {
    if (A! * n! < P!) return { error: "Instalments add up to less than the loan amount, so no interest rate fits." };
    let lo = 0, hi = 2; for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (pmt(P!, mid / f, n!) > A!) hi = mid; else lo = mid; }
    rate = ((lo + hi) / 2) * 100; solved = "interest rate";
  }
  return { P: P!, rate: rate!, n: n!, A: A!, solved, freq };
}

export function amortise(inp: LoanInput, opts: { maxRows?: number } = {}): LoanOutput {
  const s = solve(inp);
  if ("error" in s) return { ok: false, error: s.error!, need: s.need };
  const freq = s.freq, f = PER_YEAR[freq], method: Method = inp.method ?? "emi", basis = inp.basis ?? "periodic";
  if (!(s.n >= 1)) return { ok: false, error: "Tenure must be at least one instalment." };
  const maxRows = opts.maxRows ?? 60_000;
  if (s.n > maxRows) return { ok: false, error: `That is ${s.n.toLocaleString()} instalments; the limit is ${maxRows.toLocaleString()}. Use a less frequent payment or a shorter tenure.` };
  const start = inp.start || new Date().toISOString().slice(0, 10);
  const grace = Math.max(0, Math.min(s.n - 1, inp.graceInstallments ?? 0));
  const rateAt = (k: number) => { let r = s.rate; for (const c of [...(inp.rateChanges ?? [])].sort((a, b) => a.at - b.at)) if (k >= c.at) r = c.ratePct; return r; };
  const lumps = new Map<number, number>(); for (const l of inp.lumps ?? []) if (l.amount > 0) lumps.set(l.at, (lumps.get(l.at) ?? 0) + l.amount);
  const roundUp = (x: number) => (inp.roundTo && inp.roundTo > 0 ? Math.ceil(x / inp.roundTo) * inp.roundTo : x);
  const balloon = method === "balloon" ? (s.P * (inp.balloonPct ?? 0)) / 100 : 0;
  const rows: Row[] = [];
  let bal = s.P, prevDate = start, payment = 0, k = 1, extraTotal = 0;
  let remaining = s.n;
  const fixedPrincipal = () => (bal - balloon) / Math.max(1, remaining);
  const recompute = (r: number) => {
    const rp = r / 100 / f;
    if (method === "emi") payment = roundUp(pmt(bal, rp, remaining));
    else if (method === "balloon") { const pvBal = balloon / Math.pow(1 + rp, remaining); payment = roundUp(pmt(bal - pvBal, rp, remaining)); }
  };
  let curRate = rateAt(1);
  if (inp.installment != null && s.solved !== "interest rate" && method === "emi" && grace === 0) payment = inp.installment; else recompute(curRate);
  let graceLeft = grace;
  if (grace > 0) remaining = s.n - grace;
  while (bal > 0.005 && k <= maxRows) {
    const date = addPeriod(start, freq, k);
    const r = rateAt(k);
    const opening = bal;
    const interest = basis === "actual365" ? (bal * (r / 100) * days(prevDate, date)) / 365 : (bal * (r / 100)) / f;
    let pay: number, princ: number;
    if (graceLeft > 0) {
      if (inp.capitaliseGrace) { bal += interest; pay = 0; princ = -interest; } else { pay = interest; princ = 0; }
      graceLeft--;
      if (graceLeft === 0) { remaining = s.n - grace; recompute(r); curRate = r; }
    } else {
      if (r !== curRate) { curRate = r; recompute(r); }
      if (method === "emi" || method === "balloon") { pay = payment; princ = pay - interest; }
      else if (method === "equal-principal") { princ = fixedPrincipal(); pay = princ + interest; }
      else { princ = remaining <= 1 ? bal : 0; pay = interest + princ; } // interest-only, principal at the end
      if (princ < 0 && method !== "interest-only") return { ok: false, error: `At instalment ${k} the payment (${r2(pay)}) is less than the interest (${r2(interest)}), so the loan would never be repaid. Raise the instalment or lower the rate.` };
      const isLast = remaining <= 1 || princ >= bal - 0.005;
      if (isLast) { princ = bal; pay = princ + interest; }
      remaining--;
    }
    let extra = 0;
    if (graceLeft === 0 && k > grace && bal - Math.max(0, princ) > 0.005) {
      if (inp.extraEach && k >= (inp.extraFrom ?? 1)) extra += inp.extraEach;
      extra += lumps.get(k) ?? 0;
      extra = Math.min(extra, bal - Math.max(0, princ));
    }
    bal = bal - Math.max(0, princ) - extra;
    if (Math.abs(bal) < 0.005) bal = 0;
    extraTotal += extra;
    rows.push({ n: k, date, opening: r2(opening), rate: r, payment: r2(pay), interest: r2(interest), principal: r2(Math.max(0, princ)), extra: r2(extra), closing: r2(Math.max(0, bal)) });
    if (extra > 0 && (inp.prepayMode ?? "shorten") === "reduce" && remaining > 0) recompute(r);
    if (extra > 0 && (inp.prepayMode ?? "shorten") === "shorten" && method === "equal-principal") remaining = Math.max(1, Math.ceil(bal / Math.max(1e-9, (s.P - balloon) / (s.n - grace))));
    prevDate = date; k++;
    if (method !== "interest-only" && remaining <= 0 && bal > 0.005 && graceLeft === 0) { remaining = 1; } // rounding leftovers go in one final payment
  }
  if (bal > 0.005) return { ok: false, error: `The schedule passed ${maxRows.toLocaleString()} rows without finishing. Check the instalment and rate.` };
  const totalInterest = rows.reduce((a, x) => a + x.interest, 0), totalPaid = rows.reduce((a, x) => a + x.payment + x.extra, 0);
  const fees = (inp.feePct ? (s.P * inp.feePct) / 100 : 0) + (inp.feeFixed ?? 0);
  // APR with fees: the yearly rate at which the payments repay what you actually received (loan minus fees).
  let apr: number | null = null;
  if (fees > 0) {
    const flows = rows.map((x) => ({ t: days(start, x.date) / 365, a: x.payment + x.extra }));
    const net = s.P - fees, pv = (y: number) => flows.reduce((a, x) => a + x.a / Math.pow(1 + y, x.t), 0);
    let lo = -0.5, hi = 3; for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (pv(mid) > net) lo = mid; else hi = mid; }
    apr = r2(((lo + hi) / 2) * 100);
  }
  let saved: LoanResult["savedByExtras"] = null;
  if ((inp.extraEach || inp.lumps?.length) && opts.maxRows !== -1) {
    const base = amortise({ ...inp, extraEach: null, lumps: [] }, { maxRows });
    if (base.ok) saved = { interest: r2(base.totalInterest - totalInterest), installments: base.rows.length - rows.length };
  }
  const notes: string[] = [];
  if (s.solved) notes.push(`Worked out the ${s.solved} from your other inputs.`);
  if (basis === "actual365") notes.push("Interest is charged daily on the outstanding balance for the actual days between payments (365-day year), as Nepali banks do; months with 31 days cost slightly more.");
  if (inp.roundTo) notes.push(`Instalment rounded up to the nearest ${inp.roundTo}; the last instalment is smaller.`);
  return {
    ok: true, principal: r2(s.P), ratePct: r2(s.rate * 1000) / 1000, freq, method, installments: rows.length, installment: r2(rows.find((x) => x.n > grace)?.payment ?? payment), solved: s.solved,
    rows, totalInterest: r2(totalInterest), totalPaid: r2(totalPaid), totalExtra: r2(extraTotal), fees: r2(fees), payoffDate: rows[rows.length - 1].date, firstDate: rows[0].date,
    effectiveAnnualPct: r2((Math.pow(1 + s.rate / 100 / f, f) - 1) * 100), aprWithFeesPct: apr, interestToPrincipalPct: r2((totalInterest / s.P) * 100), savedByExtras: saved, notes,
  };
}

/** Pay cash vs take the loan and invest the cash you kept (withdrawing the instalments from that investment). */
export function buyOrFinance(p: { price: number; cash: number; downPayment: number; loan: LoanResult; investReturnPct: number; taxOnReturnPct: number; freq: Freq }) {
  const f = PER_YEAR[p.freq], r = (p.investReturnPct * (1 - p.taxOnReturnPct / 100)) / 100 / f;
  // Option A: pay in full; what's left of your cash is invested for the same period.
  let a = Math.max(0, p.cash - p.price);
  // Option B: pay the down payment and fees; invest the rest; each instalment comes out of the investment.
  let b = p.cash - p.downPayment - p.loan.fees, ranOut: string | null = null;
  for (const row of p.loan.rows) { a *= 1 + r; b = b * (1 + r) - (row.payment + row.extra); if (b < 0 && !ranOut) ranOut = row.date; }
  const canAfford = p.cash >= p.price;
  return { cashLeftIfFull: r2(a), investmentLeftIfLoan: r2(b), better: b > a ? "loan" as const : "cash" as const, difference: r2(Math.abs(b - a)), ranOut, canAfford, breakEvenReturnPct: null as number | null };
}
