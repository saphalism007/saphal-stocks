// Money calculators: tax (FY 2083/84), growth, retirement, shares, property and gold. Every input has a
// slider and a number box, and results update as you move them.
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../lib/api.ts";
import { NumInput } from "../components/ui.tsx";
import { compact, num, rs } from "../lib/format.ts";
import { incomeTax, stepUpSip, goalMonthly, cagr, doublingYears, realReturn, retirement, averagePrice, adjustedPrice, ytm, rentVsBuy, loanAffordability, goldCost, TAX_YEAR, TAX_SOURCE, SLABS_2083 } from "../../../shared/calc.ts";
import { roundTrip, DEFAULT_FEES } from "../../../shared/costs.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
interface F { k: string; label: string; def: number; min: number; max: number; step: number; unit?: "Rs" | "%" | "yr" | "" ; bool?: boolean }
interface Out { main: [string, string]; rows: [string, string][]; bars?: { label: string; a: number; b?: number }[]; barLabels?: [string, string]; note?: string; table?: { head: string[]; rows: string[][] } }
interface CalcDef { id: string; cat: string; title: string; sub: string; fields: F[]; run: (v: Record<string, number>) => Out }

const R = (k: string, label: string, def: number, max: number, step = 1000, min = 0): F => ({ k, label, def, min, max, step, unit: "Rs" });
const P = (k: string, label: string, def: number, max = 30, step = 0.25, min = 0): F => ({ k, label, def, min, max, step, unit: "%" });
const Y = (k: string, label: string, def: number, max = 40, min = 1): F => ({ k, label, def, min, max, step: 1, unit: "yr" });
const B = (k: string, label: string, def = 0): F => ({ k, label, def, min: 0, max: 1, step: 1, bool: true });

function build(rates: Any): CalcDef[] {
  const fd = rates?.fdPct ?? 6, eq = rates?.equityLongRunPct ?? 10, inf = rates?.inflationPct ?? 5, gold = rates?.goldPct ?? 10;
  return [
    { id: "income-tax", cat: "Tax", title: `Income tax ${TAX_YEAR}`, sub: "Salary tax with the new single table, retirement fund and insurance deductions", fields: [
      R("inc", "Yearly income (salary, allowances, bonus)", 1_200_000, 10_000_000, 10_000), R("ret", "Retirement fund contribution (EPF/CIT/SSF) a year", 120_000, 1_000_000, 5_000),
      R("life", "Life insurance premium a year", 0, 100_000, 1_000), R("health", "Health insurance premium a year", 0, 50_000, 500), R("edu", "Children's school fees a year", 0, 500_000, 5_000),
      B("ssf", "I contribute to SSF (1% band not charged)"), B("female", "Woman with salary income only (10% rebate)"),
      R("retcap", "Retirement deduction cap (check yours)", 500_000, 1_000_000, 10_000), R("lifecap", "Life insurance cap", 40_000, 100_000, 1_000), R("healthcap", "Health insurance cap", 20_000, 50_000, 1_000)],
      run: (v) => { const t = incomeTax({ annualIncome: v.inc, retirement: v.ret, retirementCap: v.retcap, lifeInsurance: v.life, lifeCap: v.lifecap, healthInsurance: v.health, healthCap: v.healthcap, buildingInsurance: 0, childEducationFees: v.edu, ssfContributor: !!v.ssf, female: !!v.female });
        return { main: ["Tax for the year", rs(t.tax, 0)], rows: [["Each month", rs(t.monthlyTax, 0)], ["Effective rate", `${t.effectivePct}%`], ["Deductions", rs(t.totalDeductions, 0)], ["Taxable income", rs(t.taxable, 0)], ...(t.rebate ? [["Women's rebate", `− ${rs(t.rebate, 0)}`] as [string, string]] : []), ["Take-home a month (after tax & fund)", rs(t.takeHomeMonthly, 0)]],
          table: { head: ["Band", "Rate", "Tax"], rows: t.bands.map((b) => [`${compact(b.from, "")}-${b.to ? compact(b.to, "") : "above"}`, `${Math.round(b.rate * 1000) / 10}%`, rs(b.tax, 0)]) },
          note: `Rates: ${SLABS_2083.map((s, i) => `${s.upTo ? `${i ? "next" : "first"} ${compact(s.upTo - (i ? SLABS_2083[i - 1].upTo! : 0), "")}` : `above ${compact(SLABS_2083[i - 1].upTo, "")}`} ${Math.round(s.rate * 1000) / 10}%`).join(", ")}. Source: ${TAX_SOURCE}. Deduction caps not changed by the 2083 Act are editable; confirm them with your employer or IRD.` }; } },
    { id: "share-tax", cat: "Tax", title: "Share sale: fees & capital gains tax", sub: "Broker commission, SEBON fee, DP charge and CGT (10% up to 365 days, 7.5% after)", fields: [
      { k: "q", label: "Shares", def: 100, min: 1, max: 10_000, step: 10, unit: "" }, R("b", "Buy price", 500, 5000, 1), R("s", "Sell price", 600, 5000, 1), { k: "d", label: "Days held", def: 200, min: 1, max: 2000, step: 1, unit: "" }],
      run: (v) => { const x = roundTrip(v.q, v.b, v.s, v.d, DEFAULT_FEES); return { main: ["Profit in your pocket", rs(x.netProfit, 0)], rows: [["Buy total (with charges)", rs(x.costBasis, 0)], ["Sell amount after charges", rs(x.sell.net, 0)], ["Capital gains tax", rs(x.cgt, 0)], ["Net return", `${num(x.netReturnPct, 2)}%`], ["Break-even sell price", rs(x.breakevenPrice)]], note: v.d <= 365 ? `Holding ${366 - v.d} more day(s) would cut the tax from 10% to 7.5%.` : "Held over a year: 7.5% rate." }; } },
    { id: "income-other", cat: "Tax", title: "Dividend, interest & property tax", sub: "Final withholding on dividends (5%) and bank interest (6%); land/building CGT (7.5% / 10%)", fields: [
      R("div", "Cash dividend received", 50_000, 2_000_000, 1000), R("int", "Bank/FD interest received", 50_000, 2_000_000, 1000), R("gain", "Profit on selling land/house", 0, 20_000_000, 50_000), Y("own", "Years you owned the land/house", 6, 40, 0)],
      run: (v) => { const dt = v.div * 0.05, it = v.int * 0.06, lt = v.gain * (v.own >= 5 ? 0.075 : 0.10); return { main: ["Total tax", rs(dt + it + lt, 0)], rows: [["Dividend tax (5%)", rs(dt, 0)], ["Interest tax (6%)", rs(it, 0)], [`Land/house CGT (${v.own >= 5 ? "7.5%" : "10%"})`, rs(lt, 0)], ["You keep", rs(v.div + v.int + v.gain - dt - it - lt, 0)]], note: "Property CGT rose in FY 2083/84 to 7.5% (owned 5+ years) and 10% (less). Bonus shares are not taxed as dividend here; check special cases with IRD." }; } },
    { id: "sip", cat: "Grow", title: "SIP with yearly step-up", sub: "Invest every month and raise it each year", fields: [R("m", "Monthly SIP", 10_000, 200_000, 500), P("r", "Expected return a year", Math.round(eq * 4) / 4), Y("y", "Years", 10), P("s", "Raise SIP each year by", 10, 50, 1)],
      run: (v) => { const x = stepUpSip(v.m, v.r, v.y, v.s); const flat = stepUpSip(v.m, v.r, v.y, 0); return { main: [`Value after ${v.y} years`, compact(x.value)], rows: [["You put in", compact(x.paid)], ["Growth", compact(x.gain)], ["Without the step-up", compact(flat.value)]], bars: x.byYear.map((b) => ({ label: `Y${b.year}`, a: b.paid, b: b.value })), barLabels: ["Paid in", "Value"], note: `${num(v.r, 2)}% a year is an assumption (NEPSE's last 10 years: ${num(eq, 1)}%); markets can fall for years.` }; } },
    { id: "lumpsum", cat: "Grow", title: "Lump sum vs monthly", sub: "Invest all now or spread it monthly", fields: [R("a", "Amount", 500_000, 10_000_000, 10_000), P("r", "Return a year", Math.round(eq * 4) / 4), Y("y", "Years", 5)],
      run: (v) => { const ls = v.a * Math.pow(1 + v.r / 100, v.y); const sp = stepUpSip(v.a / (v.y * 12), v.r, v.y).value; return { main: ["Lump sum grows to", compact(ls)], rows: [["Monthly (same total) grows to", compact(sp)], ["Difference", compact(ls - sp)]], note: "A lump sum earns more when markets rise steadily; monthly investing lowers the risk of buying everything at a peak." }; } },
    { id: "goal", cat: "Grow", title: "How much a month for my goal?", sub: "House, education, wedding, car... in today's money", fields: [R("g", "Goal in today's money", 2_000_000, 50_000_000, 50_000), Y("y", "Years until you need it", 5), P("r", "Expected return a year", Math.round(fd * 4) / 4), P("i", "Inflation a year", Math.round(inf * 4) / 4, 15), R("h", "Already saved for it", 0, 20_000_000, 10_000)],
      run: (v) => { const x = goalMonthly(v.g, v.y, v.r, v.i, v.h); return { main: ["Save each month", rs(x.monthly, 0)], rows: [["Goal cost then (with inflation)", compact(x.futureGoal)], ["Your savings grow to", compact(x.fromSavings)]], note: v.y < 3 ? "Under 3 years: keep this money in deposits, not shares." : undefined }; } },
    { id: "retire", cat: "Grow", title: "Retirement fund", sub: "How big a fund you need and the monthly saving to build it", fields: [Y("age", "Your age", 30, 70, 18), Y("ra", "Retire at", 60, 75, 40), Y("life", "Plan until age", 85, 100, 60), R("exp", "Monthly expenses today", 50_000, 500_000, 1000), P("i", "Inflation", Math.round(inf * 4) / 4, 15), P("rb", "Return before retiring", 10), P("ra2", "Return after retiring", 7), R("saved", "Retirement savings now (EPF/CIT/SSF/other)", 0, 50_000_000, 10_000)],
      run: (v) => { const x = retirement({ age: v.age, retireAge: v.ra, lifeTo: v.life, monthlyExpense: v.exp, inflationPct: v.i, returnBeforePct: v.rb, returnAfterPct: v.ra2, saved: v.saved }); return { main: ["Fund needed at retirement", compact(x.corpus)], rows: [["Save each month from now", rs(x.monthlySaving, 0)], ["Yearly expenses at retirement", compact(x.yearlyExpenseAtRetirement)], ["Your current savings grow to", compact(x.savedGrowsTo)], ["Years to retirement", String(x.yearsToRetire)]], note: "EPF, CIT and SSF contributions count towards this and reduce your income tax." }; } },
    { id: "real", cat: "Grow", title: "Real return (after tax & inflation)", sub: "What an investment really earns", fields: [P("r", "Return a year", Math.round(fd * 4) / 4), P("t", "Tax on the return", 6, 40, 0.5), P("i", "Inflation", Math.round(inf * 4) / 4, 15), R("a", "Amount", 100_000, 10_000_000, 10_000), Y("y", "Years", 5)],
      run: (v) => { const x = realReturn(v.r, v.t, v.i); return { main: ["Real return a year", `${num(x.real, 2)}%`], rows: [["After tax", `${num(x.afterTax, 2)}%`], [`Buying power after ${v.y} years`, compact(v.a * Math.pow(1 + x.real / 100, v.y))], ["Doubles in", x.real > 0 ? `${num(doublingYears(x.real)!, 1)} years (real)` : "never (loses value)"]] }; } },
    { id: "cagr", cat: "Grow", title: "CAGR & doubling time", sub: "Yearly growth between two values", fields: [R("s", "Start value", 100_000, 10_000_000, 1000), R("e", "End value", 200_000, 50_000_000, 1000), Y("y", "Years", 5)],
      run: (v) => { const c = cagr(v.s, v.e, v.y); return { main: ["Growth a year (CAGR)", c != null ? `${num(c, 2)}%` : "-"], rows: [["Doubles every", c && c > 0 ? `${num(doublingYears(c)!, 1)} years` : "-"], ["Rule of 72", c && c > 0 ? `${num(72 / c, 1)} years` : "-"]] }; } },
    { id: "avg", cat: "Shares", title: "Average price after buying more", sub: "Your new WACC if you add shares", fields: [{ k: "hq", label: "Shares you hold", def: 100, min: 0, max: 10_000, step: 10, unit: "" }, R("ha", "Your average price", 500, 5000, 1), { k: "bq", label: "Shares to buy", def: 50, min: 0, max: 10_000, step: 10, unit: "" }, R("bp", "Buy price", 420, 5000, 1)],
      run: (v) => { const x = averagePrice(v.hq, v.ha, v.bq, v.bp); return { main: ["New average price", rs(x.avg)], rows: [["Total shares", num(x.qty, 0)], ["Total invested", rs(x.invested, 0)]], note: v.bp < v.ha ? "Averaging down only makes sense if the reason you bought is still true; never add to a stock that broke its stop." : undefined }; } },
    { id: "bonus", cat: "Shares", title: "Bonus & right share price", sub: "Adjusted price after book closure", fields: [R("p", "Price before", 600, 5000, 1), P("b", "Bonus share %", 10, 100, 1), P("r", "Right share % (of holding)", 0, 100, 5), R("rp", "Right share price", 100, 1000, 10)],
      run: (v) => { const x = adjustedPrice(v.p, v.b, v.r, v.rp); return { main: ["Expected price after", rs(v.r ? x.afterRight : x.afterBonus)], rows: [["After bonus only", rs(x.afterBonus)], ...(v.r ? [["After right too", rs(x.afterRight)] as [string, string]] : [])], note: "Your value doesn't change on the adjustment day: you get more shares at a lower price." }; } },
    { id: "ytm", cat: "Shares", title: "Debenture / bond yield", sub: "Real yield when bought above or below Rs. 1,000", fields: [R("p", "Price", 950, 1500, 1), P("c", "Coupon (interest) rate", 10, 20, 0.25), Y("y", "Years to maturity", 5, 15), P("t", "Tax on interest", 6, 20, 0.5)],
      run: (v) => { const x = ytm(v.p, 1000, v.c, v.y, v.t); return { main: ["Yield to maturity", `${num(x.ytm, 2)}%`], rows: [["After tax", `${num(x.afterTax, 2)}%`], ["Current yield", `${num(x.currentYield, 2)}%`], ["Compared with FD", `${num(fd, 2)}% before tax`]] }; } },
    { id: "rentbuy", cat: "Property & loans", title: "Rent or buy a home?", sub: "Net worth after N years either way", fields: [R("price", "Home price", 15_000_000, 100_000_000, 100_000), P("down", "Down payment", 30, 100, 5), P("rate", "Loan interest", 9, 20), Y("ly", "Loan years", 20, 30), R("rent", "Rent for a similar home, monthly", 30_000, 300_000, 1000), P("rg", "Rent rise a year", 7, 20), P("hg", "Home price rise a year", 6, 20), P("inv", "Return if renter invests the difference", Math.round(eq * 4) / 4), Y("y", "Compare after", 15), P("bc", "Buying costs (registration etc.)", 5, 15, 0.5)],
      run: (v) => { const x = rentVsBuy({ price: v.price, downPct: v.down, loanRatePct: v.rate, loanYears: v.ly, rentMonthly: v.rent, rentGrowthPct: v.rg, homeGrowthPct: v.hg, investPct: v.inv, years: v.y, buyCostPct: v.bc }); return { main: [x.better === "buy" ? "Buying is ahead" : "Renting is ahead", compact(Math.abs(x.ownNetWorth - x.rentNetWorth))], rows: [["Monthly EMI", rs(x.emi, 0)], ["Net worth if you buy", compact(x.ownNetWorth)], ["Net worth if you rent and invest", compact(x.rentNetWorth)]], note: "Land prices vary hugely by location and there is no public price index in Nepal; try a few home-price-rise rates." }; } },
    { id: "afford", cat: "Property & loans", title: "How big a loan can I get?", sub: "Banks cap all your EMIs at about half your income", fields: [R("inc", "Monthly income (net)", 150_000, 2_000_000, 5_000), R("oe", "Other EMIs now", 0, 500_000, 1000), P("rate", "Loan interest", 9, 20), Y("y", "Loan years", 20, 30), P("dti", "EMI limit (% of income)", 50, 70, 5)],
      run: (v) => { const x = loanAffordability(v.inc, v.oe, v.rate, v.y, v.dti); return { main: ["Maximum loan", compact(x.maxLoan)], rows: [["Maximum EMI", rs(x.maxEmi, 0)]], note: "Borrowing the maximum leaves no room for emergencies; aim for EMIs under 30-35% of income." }; } },
    { id: "gold", cat: "Gold", title: "Gold buying cost & break-even", sub: "Making charges, the 0.5% skill-development fee on jewellery, and dealer buy-back", fields: [{ k: "t", label: "Weight (tola)", def: 1, min: 0.1, max: 20, step: 0.1, unit: "" }, R("rate", "Gold rate per tola", rates?.goldTola ?? 200_000, 500_000, 100), R("mk", "Making charge per tola (0 for coins/bars)", 0, 50_000, 500), P("fee", "Skill-development fee (jewellery)", 0, 2, 0.5), P("bb", "Dealer buy-back below the rate", 2, 15, 0.5)],
      run: (v) => { const x = goldCost({ tola: v.t, ratePerTola: v.rate, makingPerTola: v.mk, skillFeePct: v.fee, buybackDiscountPct: v.bb }); return { main: ["You pay", rs(x.total, 0)], rows: [["Gold value", rs(x.metal, 0)], ["Making charges", rs(x.making, 0)], ["Fee", rs(x.fee, 0)], ["You'd get selling today", rs(x.resaleToday, 0)], ["Price rise needed to break even", x.breakEvenRisePct != null ? `${num(x.breakEvenRisePct, 1)}%` : "-"]], note: `Gold's planning return in this app: ${num(gold, 1)}% a year (FENEGOSIDA history). The 2% luxury fee on jewellery became a 0.5% skill-development fee in FY 2083/84.` }; } },
  ];
}

function Calc({ c }: { c: CalcDef }) {
  const [v, setV] = useState<Record<string, number>>(() => Object.fromEntries(c.fields.map((f) => [f.k, f.def])));
  const [more, setMore] = useState(false);
  let out: Out | null = null;
  try { out = c.run(v); } catch { out = null; }
  const main = c.fields.filter((f) => !/cap$/.test(f.k)), adv = c.fields.filter((f) => /cap$/.test(f.k));
  const field = (f: F) => f.bool ? (
    <label key={f.k} className="cl-bool"><input type="checkbox" checked={!!v[f.k]} onChange={(e) => setV({ ...v, [f.k]: e.target.checked ? 1 : 0 })} /> {f.label}</label>
  ) : (
    <div key={f.k} className="cl-field">
      <div className="cl-lab"><span>{f.label}</span>
        <span className="cl-box">{f.unit === "Rs" && <i>Rs.</i>}<NumInput className="input" value={v[f.k]} onChange={(e) => setV({ ...v, [f.k]: Number(e.target.value) || 0 })} />{f.unit === "%" && <i>%</i>}{f.unit === "yr" && <i>yr</i>}</span></div>
      <input type="range" min={f.min} max={Math.max(f.max, v[f.k] ?? 0)} step={f.step} value={Math.min(Math.max(v[f.k] ?? 0, f.min), Math.max(f.max, v[f.k] ?? 0))} onChange={(e) => setV({ ...v, [f.k]: Number(e.target.value) })} />
    </div>
  );
  const maxBar = out?.bars ? Math.max(...out.bars.map((b) => Math.max(b.a, b.b ?? 0)), 1) : 1;
  return (
    <section className="cl" id={c.id}>
      <header><h3>{c.title}</h3><p>{c.sub}</p></header>
      <div className="cl-grid">
        <div className="cl-in">{main.map(field)}{adv.length > 0 && <><button className="btn sm ghost" onClick={() => setMore(!more)}>{more ? "Hide" : "Edit"} deduction limits</button>{more && adv.map(field)}</>}</div>
        {out && <div className="cl-out">
          <div className="cl-main"><span>{out.main[0]}</span><b>{out.main[1]}</b></div>
          <dl className="kv text small">{out.rows.map(([k, x]) => <Fragment key={k}><dt>{k}</dt><dd style={{ textAlign: "right" }}><b>{x}</b></dd></Fragment>)}</dl>
          {out.bars && out.bars.length > 1 && <div className="cl-bars" aria-hidden>{out.bars.map((b) => <div key={b.label} title={`${b.label}: ${compact(b.a)}${b.b != null ? ` > ${compact(b.b)}` : ""}`}><i style={{ height: `${((b.b ?? b.a) / maxBar) * 100}%` }} className="v" /><i style={{ height: `${(b.a / maxBar) * 100}%` }} className="p" /></div>)}</div>}
          {out.barLabels && <div className="tiny faint row" style={{ gap: 10 }}><span><i className="cl-key p" />{out.barLabels[0]}</span><span><i className="cl-key v" />{out.barLabels[1]}</span></div>}
          {out.table && <table className="t small" style={{ marginTop: 6 }}><thead><tr>{out.table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{out.table.rows.map((r, i) => <tr key={i}>{r.map((x, j) => <td key={j} className={j ? "num" : ""}>{x}</td>)}</tr>)}</tbody></table>}
          {out.note && <p className="tiny faint" style={{ margin: "6px 0 0" }}>{out.note}</p>}
        </div>}
      </div>
    </section>
  );
}

export default function Calculators() {
  const rates = useApi<Any>("/money/rates-summary");
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const defs = useMemo(() => build(rates.data), [rates.data]);
  const cats = ["All", ...new Set(defs.map((d) => d.cat))];
  useEffect(() => { const h = window.location.hash.slice(1); if (h) setTimeout(() => document.getElementById(h)?.scrollIntoView({ behavior: "smooth", block: "start" }), 300); }, []);
  const list = defs.filter((d) => (cat === "All" || d.cat === cat) && (!q || `${d.title} ${d.sub}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="page">
      <div className="page-head"><div><h1>Money Calculators</h1><p className="muted">Tax for FY {TAX_YEAR}, growth, retirement, shares, property and gold. Drag a slider or type a number; results update instantly. Default rates come from the latest official data in the app.</p></div></div>
      <div className="row" style={{ gap: 8 }}>
        <input className="input" placeholder="Find a calculator..." value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: "1 1 200px", maxWidth: 320 }} />
        <div className="chips">{cats.map((c) => <button key={c} className={`chip ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>{c}</button>)}</div>
      </div>
      {!rates.data && !rates.error ? <p className="small muted">Loading the latest rates...</p> : null}
      <div className="cl-list">{list.map((c) => <Calc key={c.id + (rates.data ? "r" : "")} c={c} />)}</div>
      <p className="tiny faint">More: loan/EMI, FD, emergency fund, DCF and Graham value are in <Link to="/planner">Goals & Calculators</Link>. Results are estimates for planning, not tax or investment advice.</p>
    </div>
  );
}
