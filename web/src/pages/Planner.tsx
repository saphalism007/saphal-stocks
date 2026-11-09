import { scenariosFromRates } from "../../../shared/money.ts";
import { Fragment } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { Card, Stat, Loading, Notice, Badge, Tabs, Empty, DataTable, NumInput } from "../components/ui.tsx";
import { LineChart } from "../components/PriceChart.tsx";
import { I } from "../components/icons.tsx";
import { num, compact, rs, pct, todayNpt, nptDate, tone } from "../lib/format.ts";
import * as PL from "../../../shared/planner.ts";
import { roundTrip } from "../../../shared/costs.ts";
import { positionSize } from "../../../shared/portfolio.ts";
import { dcf, dividendDiscount, grahamNumber } from "../../../shared/fundamentals.ts";
import { useTheme } from "../App.tsx";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tab = "profile" | "goals" | "car" | "allocation" | "networth" | "calculators";

export default function Planner() {
  const [tab, setTab] = useState<Tab>("profile");
  return (
    <div className="page">
      <div className="page-head"><div><h1>Wealth Planner</h1><p>Turn goals into monthly numbers. Projections use your assumptions and show a range of outcomes; none is guaranteed. Personal data is encrypted at rest.</p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "profile", label: "Financial profile" }, { key: "goals", label: "Goals" }, { key: "car", label: "Car purchase planner" }, { key: "allocation", label: "Smart money allocation" }, { key: "networth", label: "Net worth" }, { key: "calculators", label: "Calculators" }]} />
      {tab === "profile" && <Profile />}
      {tab === "goals" && <Goals />}
      {tab === "car" && <CarPlanner />}
      {tab === "allocation" && <Allocation />}
      {tab === "networth" && <NetWorth />}
      {tab === "calculators" && <Calculators />}
    </div>
  );
}

const PROFILE_FIELDS: [string, string][] = [["monthlyIncome", "Monthly take-home income"], ["additionalIncome", "Additional monthly income"], ["monthlyExpenses", "Monthly expenses"], ["essentialExpenses", "Of which essential"], ["currentSavings", "Current savings (cash, deposits)"], ["existingInvestments", "Existing investments (shares, funds)"], ["monthlyInvestable", "Monthly amount you can invest"], ["loans", "Outstanding loans"], ["loanEmi", "Total monthly EMIs"], ["highInterestDebt", "Of which high-interest debt (>12%)"], ["emergencyFund", "Emergency fund set aside"]];

function useProfile() {
  const v = useApi<{ id: number; data: Record<string, any> }[]>("/vault/profile");
  return { profile: v.data?.[0]?.data ?? null, loading: v.loading, reload: v.reload };
}

function Profile() {
  const { profile, loading, reload } = useProfile();
  const [f, setF] = useState<Record<string, any>>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (profile) setF(profile); }, [profile]);
  if (loading) return <Loading />;
  const n = (k: string) => Number(f[k]) || 0;
  const surplus = n("monthlyIncome") + n("additionalIncome") - n("monthlyExpenses") - n("loanEmi");
  const ef = PL.emergencyFund(n("essentialExpenses") || n("monthlyExpenses"), 6, n("emergencyFund"));
  const dti = n("monthlyIncome") ? (n("loanEmi") / (n("monthlyIncome") + n("additionalIncome"))) * 100 : null;
  const save = async () => { await api("/vault/profile", { body: f }); setSaved(true); setTimeout(() => setSaved(false), 2000); reload(); };
  return (
    <div className="grid g3">
      <Card title="Your financial situation" className="span2" sub="Encrypted with AES-256-GCM in the local database">
        <div className="form-grid">
          {PROFILE_FIELDS.map(([k, l]) => <label key={k} className="field">{l} (Rs.)<NumInput className="input" value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}
          <label className="field">Risk tolerance<select className="input" value={f.risk ?? "medium"} onChange={(e) => setF({ ...f, risk: e.target.value })}><option value="low">Low: protect capital</option><option value="medium">Medium: balanced</option><option value="high">High: growth, accept big swings</option></select></label>
          <label className="field">Investment horizon (years)<NumInput className="input" value={f.horizon ?? ""} onChange={(e) => setF({ ...f, horizon: e.target.value })} /></label>
          <label className="field">Dependents<NumInput className="input" value={f.dependents ?? ""} onChange={(e) => setF({ ...f, dependents: e.target.value })} /></label>
        </div>
        <label className="field" style={{ marginTop: 12 }}>Preferences and obligations<textarea className="input" value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. prefer dividend stocks, avoid hydropower, family obligations…" /></label>
        <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={save}>Save profile</button>{saved && <span className="small up">Saved</span>}</div>
      </Card>
      <div className="col">
        <Stat label="Monthly surplus" value={compact(surplus)} tone={tone(surplus)} sub="Income − expenses − EMIs" />
        <Stat label="Emergency fund (6 months)" value={compact(ef.target)} sub={ef.gap > 0 ? <span className="warn">Gap {compact(ef.gap)} · covers {num(ef.coveredMonths, 1)} months</span> : <span className="up">Fully funded</span>} />
        <Stat label="Debt-to-income (EMIs)" value={dti != null ? `${num(dti, 0)}%` : "—"} sub={dti != null ? (dti > 40 ? <span className="down">High: above 40%</span> : dti > 30 ? <span className="warn">Moderate</span> : <span className="up">Comfortable</span>) : ""} />
        <Card title="Priorities from your numbers">
          <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {n("highInterestDebt") > 0 && <li>Pay down high-interest debt ({compact(n("highInterestDebt"))}) before investing in shares.</li>}
            {ef.gap > 0 && <li>Build the emergency fund gap of {compact(ef.gap)} in a savings or call account.</li>}
            <li>Invest the monthly surplus toward your goals (see the <strong>Goals</strong> tab), matching each goal's timeline to the right products.</li>
            <li>Keep money needed within 3 years out of equities.</li>
          </ol>
          <Link className="btn sm" style={{ marginTop: 10 }} to={`/analyst?q=${encodeURIComponent("Using my saved financial profile and goals, review my situation and suggest a prioritised plan with specific Nepali investment options for each goal.")}`}><I.ai /> Ask AI for a plan</Link>
        </Card>
      </div>
    </div>
  );
}

const GOAL_PRESETS: Record<string, { costToday: number; years: number; inflationPct: number }> = {
  "Buy a car": { costToday: 6_000_000, years: 4, inflationPct: 5 }, "Buy a house": { costToday: 25_000_000, years: 10, inflationPct: 7 }, "Purchase land": { costToday: 10_000_000, years: 7, inflationPct: 8 },
  "Emergency fund": { costToday: 600_000, years: 1, inflationPct: 6 }, "Higher education": { costToday: 4_000_000, years: 8, inflationPct: 8 }, "Start a business": { costToday: 3_000_000, years: 5, inflationPct: 6 },
  "Retirement": { costToday: 50_000_000, years: 25, inflationPct: 6 }, "Passive income": { costToday: 20_000_000, years: 15, inflationPct: 6 }, "Financial independence": { costToday: 60_000_000, years: 20, inflationPct: 6 }, "Grow long-term wealth": { costToday: 10_000_000, years: 10, inflationPct: 6 },
};

function Goals() {
  const rates = useApi<{ market: { fdPct: number | null; equityLongRunPct: number | null } }>("/economy/rates");
  const scenarios = useMemo(() => (rates.data ? scenariosFromRates(rates.data.market) ?? undefined : undefined), [rates.data]);
  const g = useApi<{ id: number; data: any; createdAt: string }[]>("/vault/goal");
  const { theme } = useTheme();
  const [f, setF] = useState<any>({ name: "Buy a car", ...GOAL_PRESETS["Buy a car"], currentSaved: 500000, monthlyCapacity: 60000, annualStepUpPct: 5, investmentCostPct: 0.5, taxOnGainsPct: 6, targetDate: "" });
  const [sel, setSel] = useState<number | null>(null);
  const plan = useMemo(() => { try { return PL.planGoal({ ...f, costToday: +f.costToday, years: +f.years, inflationPct: +f.inflationPct, currentSaved: +f.currentSaved, monthlyCapacity: +f.monthlyCapacity, annualStepUpPct: +f.annualStepUpPct, investmentCostPct: +f.investmentCostPct, taxOnGainsPct: +f.taxOnGainsPct, scenarios }); } catch { return null; } }, [f, scenarios]);
  const save = async () => { if (sel) await api(`/vault/goal/${sel}`, { method: "PUT", body: f }); else { const r = await api<{ id: number }>("/vault/goal", { body: f }); setSel(r.id); } g.reload(); };
  const curve = useMemo(() => {
    if (!plan) return [];
    const mod = plan.scenarios[1];
    const out: { date: string; value: number }[] = [];
    const start = new Date();
    for (let m = 0; m <= plan.months; m += Math.max(1, Math.floor(plan.months / 60))) out.push({ date: new Date(start.getFullYear(), start.getMonth() + m, 1).toISOString().slice(0, 10), value: PL.futureValue(+f.currentSaved, +f.monthlyCapacity, mod.effectiveReturnPct, m, +f.annualStepUpPct).value });
    return out;
  }, [plan, f]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="grid g3">
      <div className="col">
        <Card title="Your goals">
          {g.data?.length ? g.data.map((x) => {
            const p = PL.planGoal({ ...x.data, costToday: +x.data.costToday, years: +x.data.years, inflationPct: +x.data.inflationPct, currentSaved: +x.data.currentSaved, monthlyCapacity: +x.data.monthlyCapacity, scenarios });
            const prog = Math.min(100, (+x.data.currentSaved / p.targetFutureCost) * 100);
            return (
              <div key={x.id} style={{ marginBottom: 10, cursor: "pointer", padding: 8, borderRadius: 8, background: sel === x.id ? "var(--panel-3)" : undefined }} onClick={() => { setSel(x.id); setF(x.data); }}>
                <div className="row between"><strong className="small">{x.data.name}</strong><button className="btn ghost sm" onClick={async (e) => { e.stopPropagation(); await api(`/vault/goal/${x.id}`, { method: "DELETE" }); if (sel === x.id) setSel(null); g.reload(); }}><I.trash /></button></div>
                <div className="bar"><span style={{ width: `${prog}%` }} /></div>
                <div className="tiny faint">{compact(+x.data.currentSaved)} of {compact(p.targetFutureCost)} ({num(prog, 0)}%) · need {compact(p.scenarios[1].requiredMonthly)}/month (moderate)</div>
              </div>
            );
          }) : <Empty title="No saved goals" />}
          <button className="btn sm" onClick={() => setSel(null)}><I.plus /> New goal</button>
        </Card>
        <Card title="Goal details">
          <div className="col">
            <label className="field">Goal<select className="input" value={f.name in GOAL_PRESETS ? f.name : "custom"} onChange={(e) => e.target.value !== "custom" && setF({ ...f, name: e.target.value, ...GOAL_PRESETS[e.target.value] })}>{Object.keys(GOAL_PRESETS).map((k) => <option key={k}>{k}</option>)}<option value="custom">Custom…</option></select></label>
            <label className="field">Name<input className="input" value={f.name} onChange={set("name")} /></label>
            <div className="grid g2">
              <label className="field">Cost today (Rs.)<NumInput className="input" value={f.costToday} onChange={set("costToday")} /></label>
              <label className="field">Years<NumInput className="input" value={f.years} onChange={set("years")} /></label>
              <label className="field">Inflation for this goal %<NumInput className="input" step="0.5" value={f.inflationPct} onChange={set("inflationPct")} /></label>
              <label className="field">Saved so far (Rs.)<NumInput className="input" value={f.currentSaved} onChange={set("currentSaved")} /></label>
              <label className="field">Monthly you can invest<NumInput className="input" value={f.monthlyCapacity} onChange={set("monthlyCapacity")} /></label>
              <label className="field">Yearly increase %<NumInput className="input" value={f.annualStepUpPct} onChange={set("annualStepUpPct")} /></label>
              <label className="field">Costs/fees % per year<NumInput className="input" step="0.1" value={f.investmentCostPct} onChange={set("investmentCostPct")} /></label>
              <label className="field">Tax on gains %<NumInput className="input" step="0.5" value={f.taxOnGainsPct} onChange={set("taxOnGainsPct")} /></label>
            </div>
            <button className="btn primary" onClick={save}>{sel ? "Update goal" : "Save goal"}</button>
          </div>
        </Card>
      </div>
      {plan && (
        <div className="col span2">
          <div className="grid g3">
            <Stat label="Future cost (with inflation)" value={compact(plan.targetFutureCost)} sub={`${rs(+f.costToday, 0)} today · ${f.years} years at ${f.inflationPct}%`} />
            <Stat label="Return needed with your monthly amount" value={plan.requiredReturnPct != null ? `${num(plan.requiredReturnPct, 1)}%/yr` : "Not reachable"} sub={plan.requiredReturnPct != null && plan.requiredReturnPct > 13 ? <span className="warn">Unrealistic: increase savings or extend the timeline</span> : "After costs and tax"} />
            <Stat label="Moderate plan: monthly needed" value={compact(plan.scenarios[1].requiredMonthly)} sub={`You plan ${compact(+f.monthlyCapacity)}`} />
          </div>
          <Card title="Scenarios" flush>
            <table className="t"><thead><tr><th>Scenario</th><th className="num">Assumed return</th><th className="num">Monthly needed</th><th className="num">Projected with your plan</th><th className="num">Shortfall</th><th className="num">Time needed</th><th className="num">Chance of reaching goal</th><th className="num">Range (10th–90th pct)</th></tr></thead>
              <tbody>{plan.scenarios.map((s) => (
                <tr key={s.name}><td><strong>{s.name}</strong><div className="tiny faint">{s.description}</div></td><td className="num">{num(s.effectiveReturnPct, 1)}%</td><td className="num">{compact(s.requiredMonthly)}</td><td className="num">{compact(s.projectedWithCapacity)}</td><td className={`num ${s.shortfall > 0 ? "down" : "up"}`}>{s.shortfall > 0 ? compact(s.shortfall) : "None"}</td><td className="num">{s.monthsNeededWithCapacity != null ? `${num(s.monthsNeededWithCapacity / 12, 1)} y` : "> 50 y"}</td><td className="num">{num(s.simulated.probabilityOfSuccess * 100, 0)}%</td><td className="num tiny">{compact(s.simulated.p10)} – {compact(s.simulated.p90)}</td></tr>
              ))}</tbody></table>
          </Card>
          <Card title="Projected savings (moderate scenario)" sub="Dashed line: inflation-adjusted target"><LineChart data={curve} height={220} baseline={plan.targetFutureCost} theme={theme} /></Card>
          <Card title="Suitable products for this timeline">
            {+f.years <= 3 ? <p className="small">Under 3 years: keep this money safe and liquid. Fixed deposits matched to the goal date, debentures from strong issuers, development bonds. Avoid putting it in shares.</p>
              : +f.years <= 7 ? <p className="small">3–7 years: a balance of fixed deposits/bonds and diversified equity (open-ended mutual fund SIPs or a diversified basket of strong NEPSE stocks). Shift to safer assets as the date approaches.</p>
                : <p className="small">7+ years: equity can be the growth engine (diversified NEPSE stocks, equity mutual funds, dividend stocks), with fixed income for stability. Rebalance yearly.</p>}
            <p className="tiny faint">Simulated chances assume returns vary randomly around the assumed average with the scenario's volatility (2,000 runs). Real markets can do worse. <Link to="/opportunities">Browse products</Link>.</p>
          </Card>
        </div>
      )}
    </div>
  );
}

function CarPlanner() {
  const [f, setF] = useState({ price: 6000000, downPaymentPct: 50, loanRatePct: 11, loanYears: 5, savingsReturnPct: 8, carInflationPct: 5, monthlyCapacity: 80000, currentSaved: 1500000, maxLtvPct: 50 });
  const r = useMemo(() => PL.carPlan(f), [f]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: +e.target.value });
  return (
    <div className="grid g3">
      <Card title="Car details">
        <div className="form-grid tight">
          {([["price", "Car price today (Rs.)"], ["currentSaved", "Saved so far"], ["monthlyCapacity", "Monthly you can save / pay"], ["downPaymentPct", "Down payment %"], ["maxLtvPct", "Max loan % (bank limit)"], ["loanRatePct", "Loan interest rate %"], ["loanYears", "Loan years"], ["savingsReturnPct", "Return on savings while you wait %"], ["carInflationPct", "Car price increase %/yr"]] as [keyof typeof f, string][]).map(([k, l]) => <label key={k} className="field">{l}<NumInput className="input" value={f[k]} onChange={set(k)} /></label>)}
        </div>
      </Card>
      <div className="col span2">
        <div className="grid g2">
          <Card title="Option A · Finance now">
            <dl className="kv">
              <dt>Down payment</dt><dd>{rs(r.financed.downPayment, 0)}</dd><dt>Loan</dt><dd>{rs(r.financed.loan, 0)}</dd>
              <dt>EMI</dt><dd><strong>{rs(r.financed.emi, 0)}</strong>/month</dd><dt>Total interest</dt><dd className="down">{rs(r.financed.totalInterest, 0)}</dd>
              <dt>Total cost</dt><dd>{rs(r.financed.totalCost, 0)}</dd><dt>EMI vs your capacity</dt><dd className={r.financed.emiShareOfCapacity && r.financed.emiShareOfCapacity > 0.8 ? "down" : ""}>{r.financed.emiShareOfCapacity != null ? pct(r.financed.emiShareOfCapacity * 100, 0, false) : "—"}</dd>
              <dt>Down-payment gap</dt><dd>{r.financed.downPaymentGap > 0 ? <span className="warn">{rs(r.financed.downPaymentGap, 0)} · ~{r.financed.monthsToSaveDownPayment} months to save</span> : <span className="up">Ready</span>}</dd>
            </dl>
          </Card>
          <Card title="Option B · Save and buy outright">
            <dl className="kv">
              <dt>Months to save</dt><dd><strong>{r.cash.monthsToSave ?? "—"}</strong> ({r.cash.monthsToSave != null ? num(r.cash.monthsToSave / 12, 1) : "—"} years)</dd>
              <dt>Price by then</dt><dd>{rs(r.cash.priceAtPurchase, 0)}</dd>
              <dt>Interest paid</dt><dd className="up">Rs. 0</dd>
              <dt>Insurance estimate</dt><dd>{rs(r.yearlyInsuranceEstimate, 0)}/yr</dd>
            </dl>
            <p className="small muted" style={{ marginTop: 8 }}>Saving first avoids {rs(r.financed.totalInterest, 0)} of interest but delays the purchase while prices rise. If you need the car now, a larger down payment and shorter loan cut interest.</p>
          </Card>
        </div>
        <Card title="Things to weigh">
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{r.notes.map((n) => <li key={n}>{n}</li>)}<li>Your other goals: EMI money cannot go to your emergency fund or retirement. Check the Goals tab with the remaining surplus.</li></ul>
          <Link className="btn sm" style={{ marginTop: 10 }} to={`/analyst?q=${encodeURIComponent(`I want to buy a car worth Rs. ${f.price}. I have Rs. ${f.currentSaved} saved and can put aside Rs. ${f.monthlyCapacity} a month. Compare financing (${f.loanRatePct}% for ${f.loanYears} years, ${f.downPaymentPct}% down) with saving first, and suggest where to keep the savings in Nepal.`)}`}><I.ai /> Ask AI to compare with my profile</Link>
        </Card>
      </div>
    </div>
  );
}

function Allocation() {
  const { profile } = useProfile();
  const [f, setF] = useState({ amount: 1000000, emergencyFundGap: 0, highInterestDebt: 0, horizonYears: 7, risk: "medium" as "low" | "medium" | "high", nearTermGoalAmount: 0, nearTermGoalYears: 2 });
  useEffect(() => {
    if (!profile) return;
    const ess = +profile.essentialExpenses || +profile.monthlyExpenses || 0;
    setF((x) => ({ ...x, emergencyFundGap: Math.max(0, ess * 6 - (+profile.emergencyFund || 0)), highInterestDebt: +profile.highInterestDebt || 0, risk: profile.risk || x.risk, horizonYears: +profile.horizon || x.horizonYears }));
  }, [profile]);
  const r = useMemo(() => PL.allocateLumpSum(f), [f]);
  const compare = (["low", "medium", "high"] as const).map((risk) => ({ risk, a: PL.allocateLumpSum({ ...f, risk }) }));
  return (
    <div className="grid g3">
      <Card title="Money to allocate" sub={profile ? "Pre-filled from your profile" : "Save your profile to pre-fill"}>
        <div className="col">
          <label className="field">Amount (Rs.)<NumInput className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: +e.target.value })} /></label>
          <label className="field">Emergency fund gap<NumInput className="input" value={f.emergencyFundGap} onChange={(e) => setF({ ...f, emergencyFundGap: +e.target.value })} /></label>
          <label className="field">High-interest debt<NumInput className="input" value={f.highInterestDebt} onChange={(e) => setF({ ...f, highInterestDebt: +e.target.value })} /></label>
          <label className="field">Near-term goal amount<NumInput className="input" value={f.nearTermGoalAmount} onChange={(e) => setF({ ...f, nearTermGoalAmount: +e.target.value })} /></label>
          <label className="field">Near-term goal in (years)<NumInput className="input" value={f.nearTermGoalYears} onChange={(e) => setF({ ...f, nearTermGoalYears: +e.target.value })} /></label>
          <label className="field">Long-term horizon (years)<NumInput className="input" value={f.horizonYears} onChange={(e) => setF({ ...f, horizonYears: +e.target.value })} /></label>
          <label className="field">Risk tolerance<select className="input" value={f.risk} onChange={(e) => setF({ ...f, risk: e.target.value as "low" })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        </div>
      </Card>
      <div className="col span2">
        <Card title={`Suggested allocation of ${compact(f.amount)}`} sub="Rules: debt first, then emergency fund, near-term goals, then long-term split by risk and horizon">
          {r.steps.map((s) => (
            <div key={s.bucket} style={{ marginBottom: 12 }}>
              <div className="row between"><strong>{s.bucket}</strong><span className="mono">{compact(s.amount)} · {num((s.amount / f.amount) * 100, 0)}%</span></div>
              <div className="bar" style={{ margin: "4px 0" }}><span style={{ width: `${(s.amount / f.amount) * 100}%` }} /></div>
              <div className="small muted">{s.why}</div>
              <div className="row" style={{ marginTop: 4 }}>{s.vehicles.map((v) => <Badge key={v}>{v}</Badge>)}</div>
            </div>
          ))}
        </Card>
        <Card title="Compare risk levels" flush>
          <table className="t"><thead><tr><th>Risk</th><th className="num">Equity</th><th className="num">Fixed income & safety</th><th>Trade-off</th></tr></thead><tbody>
            {compare.map(({ risk, a }) => { const eq = a.steps.find((s) => s.bucket.startsWith("Equity"))?.amount ?? 0; return <tr key={risk}><td><strong>{risk}</strong></td><td className="num">{compact(eq)}</td><td className="num">{compact(f.amount - eq)}</td><td className="small muted">{risk === "low" ? "Smaller swings, lower expected growth; inflation can erode real value." : risk === "medium" ? "Balanced growth and stability." : "Highest expected growth, but a 30–40% fall in a bad year is possible."}</td></tr>; })}
          </tbody></table>
        </Card>
        <Notice>This is a starting framework, not personal advice. It never puts everything into stocks. For tax or complex situations, consult a licensed professional.</Notice>
      </div>
    </div>
  );
}

function NetWorth() {
  const nw = useApi<{ id: number; data: any }[]>("/vault/networth");
  const { theme } = useTheme();
  const ports = useApi<any[]>("/portfolios");
  const sharesValue = (ports.data ?? []).filter((p) => p.kind === "real").reduce((s, p) => s + p.marketValue, 0);
  const [f, setF] = useState<Record<string, any>>({ date: todayNpt(), cash: 0, deposits: 0, shares: 0, mutualFunds: 0, retirement: 0, property: 0, vehicles: 0, gold: 0, other: 0, loans: 0, otherLiabilities: 0 });
  useEffect(() => { setF((x) => ({ ...x, shares: Math.round(sharesValue) })); }, [sharesValue]);
  const assets = ["cash", "deposits", "shares", "mutualFunds", "retirement", "property", "vehicles", "gold", "other"];
  const liabs = ["loans", "otherLiabilities"];
  const total = (d: any) => assets.reduce((s, k) => s + (+d[k] || 0), 0) - liabs.reduce((s, k) => s + (+d[k] || 0), 0);
  const rows = [...(nw.data ?? [])].sort((a, b) => (a.data.date < b.data.date ? -1 : 1));
  return (
    <div className="grid g3">
      <Card title="Snapshot">
        <div className="col">
          <label className="field">Date<input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          {assets.map((k) => <label key={k} className="field">{k.replace(/([A-Z])/g, " $1")} {k === "shares" && <span className="faint">(from your real portfolios)</span>}<NumInput className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}
          {liabs.map((k) => <label key={k} className="field">{k.replace(/([A-Z])/g, " $1")} (liability)<NumInput className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}
          <div className="row between"><strong>Net worth</strong><span className="mono">{rs(total(f), 0)}</span></div>
          <button className="btn primary" onClick={async () => { await api("/vault/networth", { body: f }); nw.reload(); }}>Save snapshot</button>
        </div>
      </Card>
      <div className="col span2">
        <Card title="Net worth over time">{rows.length >= 2 ? <LineChart data={rows.map((r) => ({ date: r.data.date, value: total(r.data) }))} height={260} theme={theme} /> : <Empty title="Save at least two snapshots to see a trend">Take one each month.</Empty>}</Card>
        <Card title="Snapshots" flush>
          <DataTable rows={rows.reverse()} cols={[
            { key: "date", label: "Date", render: (r: any) => nptDate(r.data.date) },
            { key: "assets", label: "Assets", num: true, render: (r: any) => compact(assets.reduce((s, k) => s + (+r.data[k] || 0), 0)) },
            { key: "liab", label: "Liabilities", num: true, render: (r: any) => compact(liabs.reduce((s, k) => s + (+r.data[k] || 0), 0)) },
            { key: "net", label: "Net worth", num: true, render: (r: any) => <strong>{compact(total(r.data))}</strong> },
            { key: "x", label: "", render: (r: any) => <button className="btn ghost sm" onClick={async () => { await api(`/vault/networth/${r.id}`, { method: "DELETE" }); nw.reload(); }}><I.trash /></button> },
          ]} />
        </Card>
      </div>
    </div>
  );
}

function Calc({ title, fields, compute, sub }: { title: string; sub?: string; fields: [string, string, number][]; compute: (v: Record<string, number>) => [string, string][] }) {
  const [v, setV] = useState<Record<string, number>>(Object.fromEntries(fields.map(([k, , d]) => [k, d])));
  let out: [string, string][] = [];
  try { out = compute(v); } catch { out = [["Result", "Check inputs"]]; }
  return (
    <Card title={title} sub={sub}>
      <div className="grid g2" style={{ gap: 8 }}>{fields.map(([k, l]) => <label key={k} className="field">{l}<NumInput className="input" value={v[k]} onChange={(e) => setV({ ...v, [k]: +e.target.value })} /></label>)}</div>
      <div className="sep" />
      <dl className="kv">{out.map(([k, x]) => <Fragment key={k}><dt>{k}</dt><dd>{x}</dd></Fragment>)}</dl>
    </Card>
  );
}

function Calculators() {
  return (
    <div className="grid g3">
      <Calc title="Loan / EMI" fields={[["p", "Loan amount", 2500000], ["r", "Interest % / yr", 11], ["m", "Months", 60]]} compute={(v) => { const e = PL.emi(v.p, v.r, v.m)!; return [["EMI", rs(e.payment, 0)], ["Total interest", rs(e.totalInterest, 0)], ["Total paid", rs(e.totalPaid, 0)]]; }} />
      <Calc title="SIP / monthly investing" fields={[["lump", "Starting amount", 0], ["m", "Monthly", 10000], ["r", "Return % / yr", 10], ["y", "Years", 10], ["s", "Yearly step-up %", 5]]} compute={(v) => { const x = PL.futureValue(v.lump, v.m, v.r, v.y * 12, v.s); return [["Future value", rs(x.value, 0)], ["You invest", rs(x.contributed, 0)], ["Growth", rs(x.growth, 0)]]; }} />
      <Calc title="Fixed deposit" sub="Quarterly compounding; 6% interest tax for individuals (verify)" fields={[["p", "Principal", 500000], ["r", "Rate %", 8], ["y", "Years", 2], ["t", "Interest tax %", 6]]} compute={(v) => { const x = PL.fdMaturity(v.p, v.r, v.y, 4, v.t); return [["Maturity", rs(x.maturity, 0)], ["Net interest", rs(x.interestNet, 0)], ["Tax withheld", rs(x.taxPaid, 0)], ["Effective yield", `${num(x.effectiveAnnualPct, 2)}%`]]; }} />
      <Calc title="Inflation" fields={[["a", "Amount today", 100000], ["i", "Inflation %", 6], ["y", "Years", 10]]} compute={(v) => [["Cost in future", rs(PL.inflate(v.a, v.i, v.y), 0)], ["Today's money then worth", rs(v.a / Math.pow(1 + v.i / 100, v.y), 0)]]} />
      <Calc title="Emergency fund" fields={[["e", "Essential monthly expenses", 50000], ["m", "Months of cover", 6], ["c", "Already saved", 100000]]} compute={(v) => { const x = PL.emergencyFund(v.e, v.m, v.c); return [["Target", rs(x.target, 0)], ["Gap", rs(x.gap, 0)], ["Months covered now", num(x.coveredMonths, 1)]]; }} />
      <Calc title="Financial independence" sub="Target = annual expenses ÷ withdrawal rate; real return = return − inflation" fields={[["e", "Annual expenses", 1200000], ["w", "Withdrawal rate %", 4], ["c", "Invested now", 1000000], ["m", "Monthly investing", 50000], ["r", "Return %", 11], ["i", "Inflation %", 6]]} compute={(v) => { const x = PL.financialIndependence(v.e, v.w, v.c, v.m, v.r, v.i); return [["FI number (today's Rs.)", rs(x.targetInTodaysRs, 0)], ["Real return", `${num(x.realReturnPct, 2)}%`], ["Years to FI", x.yearsToFI != null ? num(x.yearsToFI, 1) : "> 60"]]; }} />
      <Calc title="Trade cost & capital gains tax" sub="Broker commission slabs, SEBON fee, DP charge, CGT" fields={[["q", "Quantity", 100], ["b", "Buy price", 500], ["s", "Sell price", 600], ["d", "Days held", 200]]} compute={(v) => { const x = roundTrip(v.q, v.b, v.s, v.d); return [["Buy total (WACC basis)", rs(x.costBasis)], ["Sell net of charges", rs(x.sell.net)], ["Gross gain", rs(x.grossGain)], ["CGT", rs(x.cgt)], ["Net profit", rs(x.netProfit)], ["Net return", `${num(x.netReturnPct, 2)}%`], ["Break-even sell price", rs(x.breakevenPrice)]]; }} />
      <Calc title="Position size" sub="Risk a fixed % of capital between entry and stop" fields={[["c", "Capital", 500000], ["r", "Risk per trade %", 1], ["e", "Entry", 500], ["s", "Stop-loss", 470]]} compute={(v) => { const x = positionSize(v.c, v.r, v.e, v.s); return x ? [["Shares", num(x.quantity, 0)], ["Position value", rs(x.positionValue, 0)], ["Amount at risk", rs(x.riskAmount, 0)], ["% of capital", `${num(x.positionPctOfCapital, 1)}%`]] : [["Error", "Stop must be below entry"]]; }} />
      <Calc title="Risk / reward" fields={[["e", "Entry", 500], ["s", "Stop", 470], ["t", "Target", 580]]} compute={(v) => [["Risk / share", rs(v.e - v.s)], ["Reward / share", rs(v.t - v.e)], ["R:R", num((v.t - v.e) / (v.e - v.s), 2)], ["Win rate needed to break even", `${num((1 / (1 + (v.t - v.e) / (v.e - v.s))) * 100, 0)}%`]]} />
      <Calc title="Intrinsic value: DCF" sub="Two-stage; per-share cash flow (e.g. EPS or FCF)" fields={[["cf", "Cash flow / share now", 30], ["g", "Growth % (stage 1)", 10], ["n", "Years of stage 1", 5], ["tg", "Terminal growth %", 4], ["d", "Discount rate %", 12]]} compute={(v) => { const x = dcf({ cashFlow0: v.cf, growthRate: v.g / 100, growthYears: v.n, terminalGrowth: v.tg / 100, discountRate: v.d / 100 }); return x ? [["Intrinsic value / share", rs(x.value)], ["From terminal value", `${num(x.terminalShare * 100, 0)}%`]] : [["Error", "Discount rate must exceed terminal growth"]]; }} />
      <Calc title="Dividend discount model" fields={[["d", "Last cash dividend / share (Rs.)", 12], ["g", "Dividend growth %", 5], ["r", "Required return %", 12]]} compute={(v) => [["Value / share", rs(dividendDiscount(v.d, v.g / 100, v.r / 100))]]} />
      <Calc title="Graham number" sub="√(22.5 × EPS × BVPS)" fields={[["e", "EPS", 30], ["b", "Book value / share", 230]]} compute={(v) => [["Graham number", rs(grahamNumber(v.e, v.b))]]} />
    </div>
  );
}
