// Where to invest: "I have Rs. X — where should it go?" Allocation advice from your situation and
// official rates; deposit rates by institution (from their official notices); NRB rates and
// inflation; mutual funds; debentures; government securities; prepay a loan or invest.
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { Card, Stat, Loading, ErrorBox, Tabs, Badge, Notice, Empty, DataTable, Seg, NumInput } from "../components/ui.tsx";
import { I } from "../components/icons.tsx";
import { LineChart } from "../components/PriceChart.tsx";
import { compact, num, nptDate, rs, tone } from "../lib/format.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Tab = "advisor" | "best" | "deposits" | "rates" | "metals" | "funds" | "loan";

export default function Invest() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "advisor";
  return (
    <div className="page">
      <div className="page-head"><div><h1>Investment Planner</h1><p className="muted">Compare real options in Nepal and get a split that fits your risk, goals and the latest official rates. Guaranteed (contractual) and market-linked returns are always shown separately.</p></div></div>
      <Tabs value={tab} onChange={(t) => setSp({ tab: t })} tabs={[{ key: "advisor", label: "Where should I invest?" }, { key: "best", label: "Which is best?" }, { key: "deposits", label: "Deposit rates" }, { key: "rates", label: "Rates & inflation" }, { key: "metals", label: "Gold & silver" }, { key: "funds", label: "Funds, debentures, bonds" }, { key: "loan", label: "Prepay or invest?" }]} />
      {tab === "advisor" && <Advisor />}
      {tab === "best" && <BestReturns />}
      {tab === "deposits" && <Deposits />}
      {tab === "rates" && <Rates />}
      {tab === "metals" && <Metals />}
      {tab === "funds" && <FundsBonds />}
      {tab === "loan" && <LoanVsInvest />}
      <p className="tiny faint" style={{ marginTop: 16 }}>Decision support, not licensed financial advice. Confirm rates and terms with the institution before investing.</p>
    </div>
  );
}

const MONTHS = ["Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];
const CH_COL: Record<string, string> = { fd: "var(--blue)", debenture: "#0ea5e9", cit: "#14b8a6", sip: "var(--violet)", closed: "#a855f7", stocks: "var(--accent)", ipo: "var(--warn)", gold: "#d4a017", silver: "#94a3b8" };

function Advisor() {
  const money = useApi<Any>("/money");
  const future = useApi<Any>("/future");
  const [lump, setLump] = useState<number | "">(0);
  const [mode, setMode] = useState<"same" | "varies">("same");
  const [monthly, setMonthly] = useState<number | "">(10000);
  const [months, setMonths] = useState<(number | "")[]>(() => Array(12).fill(10000));
  const [stepUp, setStepUp] = useState<number | "">(0);
  const [risk, setRisk] = useState<"" | "low" | "medium" | "high">("");
  const [horizon, setHorizon] = useState<number | "">("");
  const [r, setR] = useState<Any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cmp, setCmp] = useState<Any>(null);
  const v = (x: number | "") => (x === "" ? 0 : Math.max(0, x));
  const pattern = mode === "same" ? [v(monthly)] : months.map(v);
  const anyMonthly = pattern.some((x) => x > 0);
  const canRun = v(lump) > 0 || anyMonthly;
  const run = async () => {
    if (!canRun) { setErr("Enter an amount to invest now, a monthly amount, or both."); return; }
    setBusy(true); setErr(null);
    try {
      const body = { lumpSum: v(lump), monthly: anyMonthly ? pattern : [], stepUpPct: v(stepUp) || undefined, risk: risk || undefined, horizonYears: horizon === "" ? undefined : Math.max(1, horizon) };
      const [a, c] = await Promise.all([api<Any>("/money/plan", { body }), v(lump) > 0 ? api("/money/compare-profiles", { body: { amount: v(lump) } }) : Promise.resolve(null)]);
      if (!a.ok) { setErr(a.reason); setR(null); } else setR(a);
      setCmp(c);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const products: Record<string, Any> = Object.fromEntries((future.data?.products ?? []).map((p: Any) => [p.seed_key, p]));
  const finalYear = r?.yearly?.[r.yearly.length - 1];
  return (
    <div className="col">
      <Card title="Build my investment plan" sub="Start with any amount, or nothing today and invest monthly. Monthly amounts can change from month to month.">
        <div className="form-grid">
          <label className="field">Invest now (Rs.)<NumInput className="input" placeholder="0" value={lump} onChange={(e) => setLump(e.target.value === "" ? "" : Number(e.target.value))} /></label>
          <label className="field">Monthly<select className="input" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="same">Same every month</option><option value="varies">Varies by month</option></select></label>
          {mode === "same" && <label className="field">Every month (Rs.)<NumInput className="input" placeholder="0" value={monthly} onChange={(e) => setMonthly(e.target.value === "" ? "" : Number(e.target.value))} /></label>}
          <label className="field">Yearly increase (%)<NumInput className="input" placeholder="0" value={stepUp} onChange={(e) => setStepUp(e.target.value === "" ? "" : Number(e.target.value))} /></label>
          <label className="field">Risk<select className="input" value={risk} onChange={(e) => setRisk(e.target.value as typeof risk)}><option value="">From My Money ({money.data?.data?.risk ?? "medium"})</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          <label className="field">Horizon (years)<NumInput className="input" placeholder={`From My Money (${money.data?.data?.horizonYears ?? 5})`} value={horizon} onChange={(e) => setHorizon(e.target.value === "" ? "" : Number(e.target.value))} /></label>
        </div>
        {mode === "varies" && (
          <div style={{ marginTop: 12 }}>
            <div className="row between"><strong className="small">Amount for each month (Rs.); leave a month empty or 0 if you can't invest then</strong>
              <span className="row" style={{ gap: 6 }}><button className="btn sm ghost" onClick={() => setMonths(Array(12).fill(months.find((x) => x !== "" && x > 0) ?? 0))}>Same for all</button><button className="btn sm ghost" onClick={() => setMonths(Array(12).fill(""))}>Clear</button></span></div>
            <div className="month-grid">{MONTHS.map((m, i) => <label key={m} className="field">{m}<NumInput className="input" placeholder="0" value={months[i]} onChange={(e) => setMonths(months.map((x, j) => (j === i ? (e.target.value === "" ? "" : Number(e.target.value)) : x)))} /></label>)}</div>
            <p className="tiny faint">Total {rs(pattern.reduce((s, x) => s + x, 0), 0)} a year · average {rs(pattern.reduce((s, x) => s + x, 0) / 12, 0)} a month. The pattern repeats each year.</p>
          </div>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary" disabled={busy || !canRun} onClick={run}>{busy ? <span className="spinner" /> : "Show my plan"}</button>
          {[100000, 500000].map((a) => <button key={a} className="btn sm" onClick={() => setLump(a)}>Now {compact(a)}</button>)}
          {[5000, 20000].map((a) => <button key={a} className="btn sm" onClick={() => { setMode("same"); setMonthly(a); }}>{compact(a)}/month</button>)}
        </div>
        {!canRun && <p className="small muted" style={{ marginTop: 8 }}>Enter an amount to invest now, a monthly amount, or both.</p>}
        {!money.data?.saved && <p className="small muted" style={{ marginTop: 8 }}>Tip: fill in <Link to="/money">My Money</Link> so the plan first covers your emergency fund, costly loans and near-term goals.</p>}
        {err && <ErrorBox error={err} />}
      </Card>
      {r && (
        <>
          <div className="grid g4">
            <Stat label="You put in" value={compact(r.totalIn)} sub={`${v(lump) > 0 ? `${compact(v(lump))} now` : "Nothing now"}${r.avgMonthly ? ` + avg ${compact(r.avgMonthly)}/month` : ""} over ${num(r.months / 12, 0)} yr`} />
            <Stat label={`Expected in ${num(r.months / 12, 0)} years`} value={compact(finalYear.mid)} sub={`Weak ${compact(finalYear.low)} · strong ${compact(finalYear.high)}`} />
            <Stat label="Guaranteed / contractual" value={`${num(r.guaranteedPct, 0)}%`} sub="Deposits, bonds, CIT, debt repaid, emergency fund" />
            <Stat label="Market-linked" value={`${r.equityCapPct}%`} sub={`Shares & funds ${r.equityPart}%${r.metalsPct ? ` · gold/silver ${r.metalsPct}%` : ""} · ${r.inputs.risk} risk, ${r.inputs.horizonYears}-yr`} />
          </div>
          {r.priorities.length > 0 && (
            <Card title="First, protect yourself" sub="New money fills these before anything is invested">
              <div className="list">{r.priorities.map((x: Any) => (
                <div key={x.name} className="list-row" style={{ alignItems: "flex-start" }}>
                  <span className="dot" style={{ background: x.kind === "debt" ? "var(--down)" : "var(--blue)", marginTop: 6 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row between"><strong>{x.name}</strong><span className="mono small">{rs(x.amount, 0)} of {rs(x.need, 0)}</span></div>
                    <div className="small muted">{x.note}. {x.done ? (x.monthDone ? `Covered by month ${x.monthDone}.` : "Covered by today's amount.") : "Not fully covered within this plan."}</div>
                  </div>
                </div>))}</div>
            </Card>
          )}
          <Card title="Your diversified plan" sub="Where each rupee goes, by channel. Percentages are of money left after the steps above.">
            <div className="bucket-bar" style={{ marginBottom: 12 }}>{r.channels.map((c: Any) => <div key={c.key} title={`${c.name}: ${c.pct}%`} style={{ width: `${c.pct}%`, background: CH_COL[c.key] }} />)}</div>
            <div className="list">{r.channels.map((c: Any) => { const p = products[c.product]; return (
              <div key={c.key} className="list-row" style={{ alignItems: "flex-start" }}>
                <span className="dot" style={{ background: CH_COL[c.key], marginTop: 6 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row between"><strong>{c.name}</strong><Badge tone={c.group === "guaranteed" ? "up" : "warn"}>{c.pct}% · {c.group === "guaranteed" ? "contractual" : "market-linked"}</Badge></div>
                  <div className="small">{c.lump > 0 && <>Now <b>{rs(c.lump, 0)}</b> · </>}{c.monthlyAvg > 0 && <>about <b>{rs(c.monthlyAvg, 0)}</b> a month · </>}expected {compact(c.final.mid)}{c.group === "market" ? ` (${compact(c.final.low)}–${compact(c.final.high)})` : ""}</div>
                  <div className="small muted">{c.howTo}</div>
                  <div className="tiny faint">Return: {c.rateNote}. Liquidity: {c.liquidity}.</div>
                  <div className="row" style={{ marginTop: 4, gap: 6 }}>
                    {p?.official_url && <a className="btn sm" href={p.official_url} target="_blank" rel="noopener noreferrer"><I.external /> Official site</a>}
                    {p?.info_url && <a className="btn sm ghost" href={p.info_url} target="_blank" rel="noopener noreferrer"><I.external /> {/meroshare/.test(p.info_url) ? "MeroShare" : /pdmo/.test(p.info_url) ? "PDMO" : "More info"}</a>}
                    {c.inApp && <Link className="btn sm ghost" to={c.inApp.to}>{c.inApp.label}</Link>}
                  </div>
                </div>
              </div>); })}</div>
          </Card>
          <Card title="Year by year" sub="What you put in and what it could be worth">
            <div className="table-scroll"><table className="t small"><thead><tr><th>Year</th><th className="num">Paid in</th><th className="num">Weak</th><th className="num">Expected</th><th className="num">Strong</th></tr></thead>
              <tbody>{r.yearly.map((y: Any) => <tr key={y.year}><td>{num(y.year, 0)}</td><td className="num">{compact(y.paidIn)}</td><td className="num">{compact(y.low)}</td><td className="num"><b>{compact(y.mid)}</b></td><td className="num">{compact(y.high)}</td></tr>)}</tbody></table></div>
            {r.notes.map((n: string) => <p key={n} className="tiny faint">{n}</p>)}
            {r.rates.inflationPct != null && <p className="tiny faint">Inflation is {num(r.rates.inflationPct, 2)}% (NRB), so future amounts buy less than today.</p>}
            <div className="row" style={{ marginTop: 8 }}>
              <Link className="btn sm" to={`/analyst?q=${encodeURIComponent(`I can invest Rs. ${v(lump)} now and these monthly amounts: ${pattern.join(", ")} (repeating yearly${v(stepUp) ? `, rising ${v(stepUp)}% a year` : ""}). Risk ${r.inputs.risk}, horizon ${r.inputs.horizonYears} years. Using my money data and current Nepal rates, review this diversified plan and suggest improvements.`)}`}><I.ai /> Review with AI</Link>
            </div>
          </Card>
          {cmp && <ProfileCompare c={cmp} />}
        </>
      )}
      <ChannelsCard products={future.data?.products} />
    </div>
  );
}

function BestReturns() {
  const r = useApi<Any>("/money/rates-summary");
  const [amount, setAmount] = useState<number | "">(500000);
  const [monthly, setMonthly] = useState<number | "">(10000);
  const [years, setYears] = useState<number | "">(5);
  if (r.error) return <ErrorBox error={r.error} onRetry={r.reload} />;
  if (!r.data) return <Loading />;
  const d = r.data, A = Number(amount) || 0, M = Number(monthly) || 0, Y = Math.max(1, Number(years) || 1), inf = d.inflationPct ?? 0;
  // Grows a lump sum + monthly at a yearly rate (monthly compounding).
  const grow = (pct: number) => { const m = pct / 100 / 12; let v = A; for (let i = 0; i < Y * 12; i++) v = v * (1 + m) + M; return v; };
  const paid = A + M * 12 * Y;
  type Row = { name: string; rate: number | null; how: string; tax: string; worst: string; liquidity: string; safety: number; to: string; value?: number; real?: number };
  const opts: Row[] = [
    { name: "Savings account", rate: d.savingPct, how: "NRB average savings rate", tax: "6% on interest", worst: "None (deposit insurance up to a limit)", liquidity: "Instant", safety: 5, to: "/invest?tab=rates" },
    { name: "Fixed deposit", rate: d.fdPct, how: d.sources?.fd ?? "best verified FD rate", tax: "6% on interest", worst: "None (deposit insurance up to a limit)", liquidity: "At maturity", safety: 5, to: "/invest?tab=deposits" },
    { name: "Treasury bills", rate: d.tbillPct, how: "NRB 364-day T-bill yield", tax: "6% on interest (assumed)", worst: "None (government)", liquidity: "At maturity (via banks)", safety: 5, to: "/invest?tab=funds" },
    { name: "Mutual funds / NEPSE shares", rate: d.equityLongRunPct, how: "NEPSE last 10 years incl. dividends", tax: "7.5% CGT on gains (held > 1 year)", worst: d.nepseWorst ? `${d.nepseWorst.pct}% (${d.nepseWorst.from.slice(0, 4)}–${d.nepseWorst.to.slice(0, 4)})` : "Large", liquidity: "2–3 days", safety: 2, to: "/invest?tab=funds" },
    { name: "Gold", rate: d.goldPct, how: "FENEGOSIDA gold, planning rate", tax: "Dealer buy-back gap ~2%", worst: d.goldWorst ? `${d.goldWorst.pct}% (${d.goldWorst.from.slice(0, 4)}–${d.goldWorst.to.slice(0, 4)})` : "Large", liquidity: "Same day (dealer)", safety: 3, to: "/invest?tab=metals" },
    { name: "Silver", rate: d.silverPct, how: "FENEGOSIDA silver, planning rate", tax: "Dealer buy-back gap ~4%", worst: d.silverWorst ? `${d.silverWorst.pct}% (${d.silverWorst.from.slice(0, 4)}–${d.silverWorst.to.slice(0, 4)})` : "Very large", liquidity: "Same day (dealer)", safety: 1, to: "/invest?tab=metals" },
  ];
  for (const o of opts) {
    if (o.rate == null) continue;
    if (o.tax.startsWith("6%")) o.value = grow(o.rate * 0.94);
    else if (o.name.startsWith("Mutual")) { const g = grow(o.rate); o.value = g - Math.max(0, g - paid) * 0.075; }
    else { const g = grow(o.rate); o.value = g * (o.name === "Gold" ? 0.98 : 0.96); }
    o.real = o.value / Math.pow(1 + inf / 100, Y);
  }
  const ranked = [...opts].filter((o) => o.value != null).sort((a, b) => (b.real ?? 0) - (a.real ?? 0));
  const max = Math.max(...ranked.map((o) => o.value ?? 0), 1);
  const safest = ranked.filter((o) => o.safety >= 5).sort((a, b) => (b.real ?? 0) - (a.real ?? 0))[0];
  const advice = Y < 2 ? "For under 2 years, keep the money safe: the best fixed deposit (or T-bills). Shares and gold can be down when you need the money."
    : Y < 5 ? "For 2–5 years: mostly fixed deposits/T-bills, with up to a quarter in mutual funds and a little gold."
    : "For 5+ years: a mix grows most — mutual funds/strong shares for growth, deposits for safety and 5–15% gold as a hedge. Spread it; don't pick only the top line.";
  return (
    <div className="col">
      <Card title="Which investment is best for me?" sub="What you'd have after tax, and what it can actually buy after inflation">
        <div className="form-grid">
          <label className="field">Invest now (Rs.)<NumInput className="input" value={amount} onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))} /></label>
          <label className="field">Add every month (Rs.)<NumInput className="input" value={monthly} onChange={(e) => setMonthly(e.target.value === "" ? "" : Number(e.target.value))} /></label>
          <label className="field">For how many years<NumInput className="input" value={years} onChange={(e) => setYears(e.target.value === "" ? "" : Number(e.target.value))} /></label>
        </div>
        <p className="small" style={{ margin: "10px 0 0" }}>You put in <b>{rs(paid, 0)}</b>. Inflation is {num(inf, 2)}% (NRB), so Rs. 100 today buys only Rs. {num(100 / Math.pow(1 + inf / 100, Y), 0)} worth in {Y} years.</p>
      </Card>
      <div className="best-list">{ranked.map((o, i) => (
        <Link key={o.name} to={o.to} className="best-row">
          <div className="row between" style={{ flexWrap: "nowrap" }}><strong>{i + 1}. {o.name}</strong><span className="small">{num(o.rate, 2)}% a year</span></div>
          <div className="best-bar"><i style={{ width: `${((o.value ?? 0) / max) * 100}%` }} className={(o.real ?? 0) >= paid ? "up" : "down"} /></div>
          <div className="best-kv">
            <span>After tax <b>{compact(o.value)}</b></span>
            <span>Buying power <b className={(o.real ?? 0) >= paid ? "up" : "down"}>{compact(o.real)}</b></span>
            <span>Worst fall <b>{o.worst}</b></span>
            <span>Cash out <b>{o.liquidity}</b></span>
          </div>
          <div className="tiny faint">{o.how} · {o.tax}{o === safest ? " · safest with the best return" : ""}{(o.real ?? 0) < paid ? " · loses buying power" : ""}</div>
        </Link>
      ))}</div>
      <Notice>{advice} <Link to="/invest">Build my diversified plan →</Link></Notice>
      <p className="tiny faint">Rates are the latest official and historical figures in the app; past returns are not a promise. Debentures, CIT and land are left out because they have no public rate history here (see <Link to="/future">all channels</Link>).</p>
    </div>
  );
}

function Metals() {
  const m = useApi<Any>("/metals");
  const [metal, setMetal] = useState<"gold" | "silver">("gold");
  const [range, setRange] = useState<"1" | "5" | "all">("5");
  if (m.error) return <ErrorBox error={m.error} onRetry={m.reload} />;
  if (!m.data) return <Loading />;
  const x = m.data[metal];
  if (!x) return <Empty title="Gold and silver rates are not loaded yet">They are collected with the daily market data.</Empty>;
  const cut = range === "all" ? "" : new Date(Date.now() - Number(range) * 365.25 * 86_400_000).toISOString().slice(0, 10);
  const data = x.history.filter(([d]: [string, number]) => d >= cut).map(([date, value]: [string, number]) => ({ date, value }));
  const pct = (v: Any) => (v == null ? "—" : `${v > 0 ? "+" : ""}${num(v, 1)}%`);
  return (
    <div className="col">
      <div className="grid g4">
        <Stat label={`${metal === "gold" ? "Fine gold" : "Silver"} per tola`} value={rs(x.latest, 0)} sub={<span>{nptDate(x.latestDate)} {x.changePct != null && <span className={tone(x.changePct)}>{pct(x.changePct)} vs previous day</span>}</span>} />
        <Stat label="1 year" value={<span className={tone(x.y1?.pct)}>{pct(x.y1?.pct)}</span>} sub={x.y1 ? `from ${rs(x.y1.fromPrice, 0)}` : undefined} />
        <Stat label="10 years, per year" value={<span className={tone(x.y10?.pct)}>{pct(x.y10?.pct)}</span>} sub={`Since ${x.full.from.slice(0, 4)}: ${pct(x.full.pct)} a year`} />
        <Stat label="Worst fall" value={<span className="down">{num(x.worstFall.pct, 1)}%</span>} sub={`${nptDate(x.worstFall.from)} to ${nptDate(x.worstFall.to)}${x.worstFall.recoveredBy ? `; recovered ${nptDate(x.worstFall.recoveredBy)}` : "; not yet recovered"}`} />
      </div>
      <Card title={`${metal === "gold" ? "Gold" : "Silver"} price history (Rs. per tola)`} sub="Official FENEGOSIDA daily rate" actions={<><Seg value={metal} onChange={setMetal} options={[{ key: "gold", label: "Gold" }, { key: "silver", label: "Silver" }]} /><Seg value={range} onChange={setRange} options={[{ key: "1", label: "1Y" }, { key: "5", label: "5Y" }, { key: "all", label: "All" }]} /></>}>
        <LineChart data={data} height={260} color={metal === "gold" ? "#d4a017" : "#94a3b8"} />
        <p className="tiny faint" style={{ marginTop: 8 }}>All-time high {rs(x.high.price, 0)} on {nptDate(x.high.date)} ({x.high.offPct}% from today). The plan uses {num(x.planPct, 1)}% a year for {metal}: the lower of its 10-year and full-history growth, so a recent boom isn't assumed to continue.</p>
      </Card>
      <Card title="Investing in gold and silver" sub="How to do it well">
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Keep it to about 5-15% of your money: it protects against inflation and a weaker rupee, but pays no interest or dividend.</li>
          <li>Buy fine (chhapawal) gold bars or coins with a bill from a FENEGOSIDA-member dealer. Jewellery has making charges you lose when you sell.</li>
          <li>Dealers buy back below their selling rate, so short-term trading loses money. Think 5+ years.</li>
          <li>Silver swings far more than gold ({num(m.data.silver?.worstFall.pct ?? 0, 0)}% worst fall): keep it small.</li>
          <li>Store it safely (a bank locker) and keep the bills.</li>
        </ul>
        <div className="row" style={{ marginTop: 10 }}>
          <a className="btn sm" href={m.data.url} target="_blank" rel="noopener noreferrer"><I.external /> FENEGOSIDA official rates</a>
          <Link className="btn sm ghost" to="/invest">Add gold to my plan</Link>
        </div>
        <p className="tiny faint" style={{ marginTop: 8 }}>Source: {m.data.source}. Rates are updated daily with the market data.</p>
      </Card>
    </div>
  );
}

function ChannelsCard({ products }: { products?: Any[] }) {
  if (!products) return <Card title="All investment channels in Nepal"><Loading /></Card>;
  const cats = [...new Set(products.map((p) => p.category))] as string[];
  return (
    <Card title="All investment channels in Nepal" sub="Official websites, where to apply, and whether each link opened at the last daily check">
      <div className="col" style={{ gap: 14 }}>{cats.map((cat) => (
        <div key={cat}>
          <div className="sub-h">{cat}</div>
          <div className="list">{products.filter((p) => p.category === cat).map((p) => (
            <div key={p.id} className="list-row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <strong>{p.name}</strong>
                {p.suitableFor && <div className="small muted">Suits: {p.suitableFor}</div>}
                {p.how_to_apply && <div className="tiny faint">How to start: {p.how_to_apply}</div>}
              </div>
              <div className="row" style={{ gap: 6 }}>
                {p.official_url && <a className="btn sm" href={p.official_url} target="_blank" rel="noopener noreferrer"><I.external /> {new URL(p.official_url).host.replace(/^www\./, "")}</a>}
                {p.info_url && <a className="btn sm ghost" href={p.info_url} target="_blank" rel="noopener noreferrer"><I.external /> {new URL(p.info_url).host.replace(/^www\./, "")}</a>}
                {p.officialCheck && <span className={`tiny ${p.officialCheck.ok ? "up" : "warn"}`}>{p.officialCheck.ok ? "✓ opened" : "couldn't reach"} {nptDate(p.officialCheck.checked_at)}</span>}
              </div>
            </div>))}</div>
        </div>))}</div>
      <div className="sub-h" style={{ marginTop: 14 }}>Avoid</div>
      <ul className="small muted" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
        <li>Cryptocurrency trading and mining: declared illegal in Nepal by NRB.</li>
        <li>Investing abroad (foreign shares, forex/crypto apps) without approval: residents are restricted by law, and money can be lost with no protection.</li>
        <li>Network/multi-level marketing, "double your money" schemes, hundi and unlicensed lenders.</li>
      </ul>
      <p className="tiny faint" style={{ marginTop: 8 }}>Some Nepal government sites block requests from outside Nepal, so a failed check does not always mean the link is broken. Full details for each channel are on <Link to="/future">Invest for the Future</Link>.</p>
    </Card>
  );
}

function Deposits() {
  const [amount, setAmount] = useState(500000);
  const [months, setMonths] = useState(12);
  const cmp = useApi<Any>(`/money/deposits/compare?amount=${amount}&months=${months}`, [amount, months]);
  const notices = useApi<Any[]>("/economy/rate-notices");
  const mine = useApi<Any[]>("/money/deposit-rates");
  const [reading, setReading] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null);
  const [filter, setFilter] = useState<"all" | "Commercial Bank" | "Development Bank" | "Finance">("all");
  const read = async (url: string) => {
    setReading(url); setMsg(null);
    try { const x = await api<Any>("/money/deposit-rates/extract", { body: { url } }); setMsg({ text: `${x.institution}: read ${x.saved} deposit rate(s)${x.effective_from ? `, effective ${x.effective_from}` : ""}. Check them against the notice, then tick Verified.` }); cmp.reload(); mine.reload(); }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : String(e), warn: true }); }
    finally { setReading(null); }
  };
  const readAll = async () => { for (const n of (notices.data ?? []).filter((n) => n.image_url && (filter === "all" || n.inst_type === filter)).slice(0, 25)) await read(n.url); };
  const del = async (id: number) => { await api(`/money/deposit-rates/${id}`, { method: "DELETE" }); mine.reload(); cmp.reload(); };
  const verify = async (id: number) => { await api(`/money/deposit-rates/${id}/verify`, { method: "PUT", body: {} }); mine.reload(); };
  return (
    <div className="col">
      <Card title="Best fixed deposit for your money" sub="After 6% tax on interest, quarterly compounding; real return after inflation">
        <div className="row">
          <label className="field">Amount (Rs.)<NumInput className="input" value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} /></label>
          <label className="field">Term<select className="input" value={months} onChange={(e) => setMonths(Number(e.target.value))}>{[3, 6, 12, 24, 36, 60].map((m) => <option key={m} value={m}>{m < 12 ? `${m} months` : `${m / 12} year${m > 12 ? "s" : ""}`}</option>)}</select></label>
        </div>
        {!cmp.data ? <Loading /> : cmp.data.rows.length <= 1 && <Notice>Only the NRB average is available. Read the latest bank notices below (AI) or add rates you have checked, to compare institutions.</Notice>}
        {cmp.data && <DataTable rows={cmp.data.rows} rowKey={(r: Any, i) => `${r.institution}-${r.product}-${i}`} initialSort={{ key: "maturity", dir: -1 }} cols={[
          { key: "institution", label: "Institution", render: (r: Any) => <span>{r.institution} {r.instType === "benchmark" ? <Badge>NRB average</Badge> : r.instType ? <span className="tiny faint">{r.instType}</span> : null}</span> },
          { key: "product", label: "Product", render: (r: Any) => <span className="small">{r.product ?? "—"}{r.tenorMonths ? ` · ${r.tenorMonths} m` : ""}</span> },
          { key: "ratePct", label: "Rate", num: true, render: (r: Any) => `${num(r.ratePct)}%` },
          { key: "maturity", label: "You get", num: true, render: (r: Any) => compact(r.maturity) },
          { key: "netAnnualPct", label: "After tax", num: true, render: (r: Any) => `${num(r.netAnnualPct)}%` },
          { key: "realPct", label: "After inflation", num: true, render: (r: Any) => <span className={tone(r.realPct)}>{r.realPct != null ? `${num(r.realPct)}%` : "—"}</span> },
          { key: "method", label: "Source", render: (r: Any) => <span className="small">{r.method === "ai" ? <Badge tone="warn">AI-read, check</Badge> : r.method === "verified" ? <Badge tone="up">Verified</Badge> : r.method === "official" ? <Badge tone="up">Official</Badge> : <Badge>Entered</Badge>} {r.sourceUrl && <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer">notice</a>} {r.effectiveFrom ? <span className="faint">{r.effectiveFrom}</span> : null}</span> },
        ]} />}
        {cmp.data?.inflationPct != null && <p className="tiny faint">Inflation {num(cmp.data.inflationPct)}% (NRB). A negative real return means the deposit keeps your money safe but loses purchasing power.</p>}
      </Card>
      <Card title="Official rate notices (latest per institution)" sub="Banks and finance companies publish new rates each month as notice images" actions={<><Seg value={filter} onChange={setFilter} options={[{ key: "all", label: "All" }, { key: "Commercial Bank", label: "Banks" }, { key: "Development Bank", label: "Dev. banks" }, { key: "Finance", label: "Finance" }]} /><button className="btn sm" disabled={!!reading} onClick={readAll} title="Uses your Anthropic API key">{reading ? <span className="spinner" /> : <><I.ai /> Read these with AI</>}</button></>}>
        {msg && <Notice tone={msg.warn ? "warn" : "info"}>{msg.text}</Notice>}
        {!notices.data ? <Loading /> : notices.data.length === 0 ? <Empty title="No rate notices in the last 75 days" /> : (
          <DataTable rows={notices.data.filter((n) => filter === "all" || n.inst_type === filter)} rowKey={(n: Any) => n.url} maxHeight={420} cols={[
            { key: "institution", label: "Institution", render: (n: Any) => <span>{n.symbol ? <Link className="sym" to={`/stocks/${n.symbol}`}>{n.symbol}</Link> : null} {n.institution}</span> },
            { key: "inst_type", label: "Type", render: (n: Any) => <span className="small">{n.inst_type ?? "—"}</span> },
            { key: "published", label: "Published", render: (n: Any) => nptDate(n.published) },
            { key: "x", label: "", render: (n: Any) => <span className="row" style={{ gap: 6 }}>{n.image_url && <a className="btn ghost sm" href={n.image_url} target="_blank" rel="noopener noreferrer">View notice</a>}<a className="btn ghost sm" href={n.url} target="_blank" rel="noopener noreferrer"><I.external /></a>{n.image_url && <button className="btn sm" disabled={!!reading} onClick={() => read(n.url)}>{reading === n.url ? <span className="spinner" /> : "Read rates"}</button>}</span> },
          ]} />
        )}
        <p className="tiny faint">"Read rates" sends the notice image to Claude with your API key (Settings → AI) and saves the rates as AI-read with the notice link. Nothing is guessed: rates not printed on the notice are not saved.</p>
      </Card>
      <MyRates rows={mine.data} onDel={del} onVerify={verify} onAdded={() => { mine.reload(); cmp.reload(); }} />
    </div>
  );
}

function MyRates({ rows, onDel, onVerify, onAdded }: { rows: Any[] | null; onDel: (id: number) => void; onVerify: (id: number) => void; onAdded: () => void }) {
  const [f, setF] = useState<Any>({ institution: "", product: "Fixed deposit", tenor_months: 12, rate: "", depositor: "individual", source_url: "", effective_from: "" });
  const add = async () => { await api("/money/deposit-rates", { body: { ...f, rate: Number(f.rate), tenor_months: Number(f.tenor_months) || null, effective_from: f.effective_from || null, source_url: f.source_url || null } }); setF({ ...f, institution: "", rate: "" }); onAdded(); };
  return (
    <Card title="Deposit rates you are tracking" sub="AI-read and your own entries; used by the comparison and the advisor">
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <input className="input" style={{ flex: "1 1 160px" }} placeholder="Institution" value={f.institution} onChange={(e) => setF({ ...f, institution: e.target.value })} />
        <input className="input" style={{ width: 150 }} placeholder="Product" value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} />
        <NumInput className="input" style={{ width: 90 }} placeholder="Months" value={f.tenor_months} onChange={(e) => setF({ ...f, tenor_months: e.target.value })} />
        <NumInput className="input" style={{ width: 90 }} placeholder="Rate %" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
        <input className="input" style={{ width: 150 }} type="date" value={f.effective_from} onChange={(e) => setF({ ...f, effective_from: e.target.value })} title="Effective from" />
        <input className="input" style={{ flex: "1 1 160px" }} placeholder="Source link (notice)" value={f.source_url} onChange={(e) => setF({ ...f, source_url: e.target.value })} />
        <button className="btn sm primary" disabled={!f.institution || !(Number(f.rate) > 0)} onClick={add}><I.plus /> Add</button>
      </div>
      {!rows ? <Loading /> : rows.length === 0 ? <Empty title="None yet" /> : (
        <DataTable rows={rows} rowKey={(r: Any) => r.id} maxHeight={360} initialSort={{ key: "rate", dir: -1 }} cols={[
          { key: "institution", label: "Institution" }, { key: "product", label: "Product", render: (r: Any) => <span className="small">{r.product}{r.depositor !== "individual" ? ` (${r.depositor})` : ""}</span> },
          { key: "tenor_months", label: "Months", num: true }, { key: "rate", label: "Rate", num: true, render: (r: Any) => `${num(r.rate)}%` },
          { key: "effective_from", label: "Effective", render: (r: Any) => <span className="small">{r.effective_from ?? "—"}</span> },
          { key: "method", label: "", render: (r: Any) => <span className="row" style={{ gap: 6 }}>{r.method === "ai" ? <button className="btn sm" onClick={() => onVerify(r.id)} title="Mark as checked against the notice"><I.check /> Verified</button> : <Badge tone="up">{r.method === "verified" ? "Verified" : "Entered"}</Badge>}{r.source_url && <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="small">notice</a>}<button className="btn ghost sm" onClick={() => onDel(r.id)} aria-label="Delete"><I.trash /></button></span> },
        ]} />
      )}
    </Card>
  );
}

function Rates() {
  const r = useApi<Any>("/economy/rates");
  if (r.error) return <ErrorBox error={r.error} onRetry={r.reload} />;
  if (!r.data) return <Loading />;
  const d = r.data, m = d.market;
  const fdNet = m.fdPct != null ? m.fdPct * (1 - m.interestTaxPct / 100) : null;
  return (
    <div className="col">
      <div className="grid g4">
        <Stat label="Inflation (CPI, y-o-y)" value={m.inflationPct != null ? `${num(m.inflationPct)}%` : "—"} sub={d.macro ? `NRB, published ${nptDate(d.macro.published)}` : "Unavailable"} />
        <Stat label="Average FD rate (banks)" value={d.groups.find((g: Any) => g.grp === "deposit")?.rows.find((x: Any) => x.key === "deposit.fixed_deposit") ? `${num(d.groups.find((g: Any) => g.grp === "deposit").rows.find((x: Any) => x.key === "deposit.fixed_deposit").value)}%` : "—"} sub="NRB weighted average" />
        <Stat label="Real return on FDs" value={fdNet != null && m.inflationPct != null ? `${num(fdNet - m.inflationPct)}%` : "—"} tone={fdNet != null && m.inflationPct != null ? tone(fdNet - m.inflationPct) : ""} sub="After tax and inflation" />
        <Stat label="NEPSE long-run growth" value={d.nepse ? `${num(d.nepse.pct, 1)}%/yr` : "—"} sub={d.nepse ? `${d.nepse.from.slice(0, 4)}–${d.nepse.to.slice(0, 4)}: ${num(d.nepse.pricePct, 1)}% price + ${num(d.nepse.dividendYieldPct, 1)}% dividends, not guaranteed` : ""} />
      </div>
      {d.macro && (
        <Card title={d.macro.title} sub={`Nepal Rastra Bank, published ${nptDate(d.macro.published)}`} actions={<a className="btn sm" href={d.macro.pdf_url || d.macro.url} target="_blank" rel="noopener noreferrer"><I.external /> Report</a>}>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{d.macro.highlights.map((h: string) => <li key={h}>{h}</li>)}</ul>
        </Card>
      )}
      <div className="grid g2">
        {d.groups.map((g: Any) => (
          <Card key={g.grp} title={g.title}>
            <table className="t small"><thead><tr><th>Rate</th><th className="num">Current</th><th className="num">Previous</th><th>Since</th></tr></thead>
              <tbody>{g.rows.map((x: Any) => <tr key={x.key}><td>{x.label}</td><td className="num"><strong>{num(x.value)}%</strong></td><td className={`num ${x.change ? (x.change > 0 ? "up" : "down") : "muted"}`}>{x.prev_value != null ? `${num(x.prev_value)}%` : "—"}</td><td className="small muted">{nptDate(x.as_of)}</td></tr>)}</tbody></table>
            <a className="tiny" href={g.rows[0]?.source_url} target="_blank" rel="noopener noreferrer">Source: nrb.org.np</a>
          </Card>
        ))}
      </div>
      <Card title="What these mean for you">
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li><strong>Policy rate</strong>: NRB's main signal. Cuts usually lead banks to lower deposit and loan rates over the following months, and lower rates have tended to support share prices; hikes do the opposite.</li>
          <li><strong>T-bill yields</strong> show how much spare cash banks have. Very low yields mean excess liquidity, which tends to push deposit rates down.</li>
          <li><strong>Inflation vs your deposit rate</strong>: if inflation is higher than your after-tax FD rate, deposits protect money but lose purchasing power. Keep near-term money safe and consider a measured long-term share in diversified investments.</li>
        </ul>
        <p className="tiny faint">Fetched {d.fetchedAt ? nptDate(d.fetchedAt, true) : "—"}. {d.source}.</p>
      </Card>
    </div>
  );
}

function FundsBonds() {
  const funds = useApi<Any[]>("/funds");
  const deb = useApi<Any>("/economy/debentures");
  const rates = useApi<Any>("/economy/rates");
  const tb = rates.data?.groups.find((g: Any) => g.grp === "tbill");
  return (
    <div className="col">
      <Card title="Listed mutual funds" sub="Closed-end funds trade on NEPSE; price vs NAV shows the discount or premium. Returns are market-linked, not guaranteed." actions={<Link className="btn sm" to="/opportunities">Fund tracker</Link>}>
        {!funds.data ? <Loading /> : <DataTable rows={funds.data} rowKey={(f: Any) => f.symbol} maxHeight={460} initialSort={{ key: "priceReturn1y", dir: -1 }} cols={[
          { key: "symbol", label: "Fund", render: (f: Any) => <span><Link className="sym" to={`/stocks/${f.symbol}`}>{f.symbol}</Link> <span className="tiny faint">{f.name}</span></span> },
          { key: "kind", label: "Type", render: (f: Any) => <span className="small">{f.kind}</span> },
          { key: "weekly_nav", label: "NAV", num: true, render: (f: Any) => num(f.weekly_nav) },
          { key: "ltp", label: "Price", num: true, render: (f: Any) => num(f.ltp) },
          { key: "premium_pct", label: "vs NAV", num: true, render: (f: Any) => <span className={f.premium_pct < 0 ? "up" : f.premium_pct > 0 ? "down" : ""} title="Negative = buying below NAV (discount)">{f.premium_pct != null ? `${num(f.premium_pct, 1)}%` : "—"}</span> },
          { key: "priceReturn1y", label: "Price 1Y", num: true, render: (f: Any) => <span className={tone(f.priceReturn1y)}>{f.priceReturn1y != null ? `${num(f.priceReturn1y, 1)}%` : "—"}</span> },
          { key: "maturity_date", label: "Maturity", render: (f: Any) => <span className="small">{f.maturity_date ?? "Open-ended"}</span> },
        ]} />}
        <p className="tiny faint">Price returns exclude dividends. Fund fees are in each scheme's offer document (link on the fund's page).</p>
      </Card>
      <Card title="Listed debentures" sub="Fixed coupon paid by the issuer (contractual, but depends on the issuer staying sound)">
        {!deb.data ? <Loading /> : <DataTable rows={deb.data.rows} rowKey={(r: Any) => r.symbol} initialSort={{ key: "approxYtmPct", dir: -1 }} cols={[
          { key: "symbol", label: "Debenture", render: (r: Any) => <span><Link className="sym" to={`/stocks/${r.symbol}`}>{r.symbol}</Link> <span className="tiny faint">{r.name}</span></span> },
          { key: "couponPct", label: "Coupon", num: true, render: (r: Any) => r.couponPct != null ? `${num(r.couponPct)}%` : "—" },
          { key: "maturityBs", label: "Matures (BS)", num: true },
          { key: "close", label: "Price", num: true, render: (r: Any) => num(r.close) },
          { key: "currentYieldPct", label: "Current yield", num: true, render: (r: Any) => r.currentYieldPct != null ? `${num(r.currentYieldPct)}%` : "—" },
          { key: "approxYtmPct", label: "Approx. YTM", num: true, render: (r: Any) => r.approxYtmPct != null ? `${num(r.approxYtmPct)}%` : "—" },
          { key: "volume", label: "90-day volume", num: true, render: (r: Any) => r.volume ? num(r.volume, 0) : <span className="warn small">illiquid</span> },
        ]} />}
        {deb.data && <p className="tiny faint">{deb.data.note} Prices as of {deb.data.asOf}. Coupon interest is taxed at source.</p>}
      </Card>
      <Card title="Government securities">
        {tb ? <table className="t small"><thead><tr><th>Treasury bill</th><th className="num">Latest auction yield</th><th>Date</th></tr></thead><tbody>{tb.rows.map((x: Any) => <tr key={x.key}><td>{x.label}</td><td className="num">{num(x.value)}%</td><td className="small muted">{nptDate(x.as_of)}</td></tr>)}</tbody></table> : <Loading />}
        <ul className="small" style={{ marginTop: 10, paddingLeft: 18 }}>
          <li><strong>Treasury bills</strong> (28–364 days) are auctioned by NRB mainly to banks and institutions; individuals usually buy through banks/brokers. Very safe, but yields are currently low.</li>
          <li><strong>Development bonds and citizen/savings bonds</strong> (Nagarik Bachat Patra, Baideshik Rojgar Bachat Patra) are issued from time to time with fixed coupons; watch NRB's public debt notices and the <Link to="/monitor">Market Monitor</Link>.</li>
          <li>Details, eligibility and official links: <Link to="/opportunities">Investment Opportunities directory</Link>.</li>
        </ul>
      </Card>
    </div>
  );
}

function LoanVsInvest() {
  const money = useApi<Any>("/money");
  const rates = money.data?.rates;
  const [f, setF] = useState({ amount: 200000, loanRatePct: 11, years: 3, investReturnPct: 0, investGuaranteed: true });
  const [r, setR] = useState<Any>(null);
  const fdNet = rates?.fdPct != null ? rates.fdPct * (1 - rates.interestTaxPct / 100) : null;
  const ret = f.investReturnPct || (f.investGuaranteed ? fdNet ?? 5 : rates?.equityLongRunPct ?? 9);
  const run = async () => setR(await api("/money/loan-vs-invest", { body: { ...f, investReturnPct: ret } }));
  return (
    <div className="grid g2">
      <Card title="Prepay a loan or invest the money?">
        <div className="form-grid">
          <label className="field">Amount (Rs.)<NumInput className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: Number(e.target.value) || 0 })} /></label>
          <label className="field">Loan interest rate (%)<NumInput className="input" value={f.loanRatePct} onChange={(e) => setF({ ...f, loanRatePct: Number(e.target.value) || 0 })} /></label>
          <label className="field">Years<NumInput className="input" value={f.years} onChange={(e) => setF({ ...f, years: Number(e.target.value) || 1 })} /></label>
          <label className="field">Invest in<select className="input" value={f.investGuaranteed ? "g" : "m"} onChange={(e) => setF({ ...f, investGuaranteed: e.target.value === "g", investReturnPct: 0 })}><option value="g">Fixed deposit (guaranteed)</option><option value="m">Shares / funds (market-linked)</option></select></label>
          <label className="field">Expected return after tax (%)<NumInput className="input" placeholder={num(ret)} value={f.investReturnPct || ""} onChange={(e) => setF({ ...f, investReturnPct: Number(e.target.value) || 0 })} /></label>
        </div>
        <p className="tiny faint">Default return: {f.investGuaranteed ? `FD ${fdNet != null ? num(fdNet) : "—"}% after tax (${rates?.sources?.fd ?? "NRB"})` : `NEPSE long-run ${rates?.equityLongRunPct ?? "—"}% (not guaranteed)`}.</p>
        <button className="btn primary" onClick={run}>Compare</button>
      </Card>
      <Card title="Result">
        {!r ? <Empty title="Enter the numbers and compare" /> : (
          <div className="col">
            <div className="grid g2"><Stat label="Interest saved by prepaying" value={compact(r.interestSaved)} /><Stat label="Gain from investing" value={compact(r.investGain)} sub={f.investGuaranteed ? "Contractual" : "Not guaranteed"} /></div>
            <Notice tone={r.better === "prepay" ? "info" : "warn"}><strong>{r.better === "prepay" ? "Prepay the loan." : "Investing comes out ahead."}</strong> {r.why}</Notice>
          </div>
        )}
      </Card>
    </div>
  );
}

function ProfileCompare({ c }: { c: Any }) {
  const r = c.rates;
  const fdNet = r.fdPct != null ? r.fdPct * (1 - r.interestTaxPct / 100) : null;
  const opts = [
    { o: "Savings / call account", ret: r.savingPct != null ? `${num(r.savingPct * (1 - r.interestTaxPct / 100), 2)}% after tax` : "—", risk: "Very low", liq: "Instant", dur: "Any", tax: "6% TDS on interest", min: "Bank minimum (often Rs. 0–1,000)", prot: "Yes (deposit insurance up to the limit)", acc: "Any bank branch / app", link: "/invest?tab=deposits" },
    { o: "Fixed deposit", ret: fdNet != null ? `${num(fdNet, 2)}% after tax (contractual)` : "—", risk: "Low", liq: "At maturity; early break with penalty", dur: "3 months – 5 years", tax: "6% TDS on interest", min: "Often Rs. 1,000–10,000", prot: "Yes (deposit insurance up to the limit)", acc: "Any bank / finance company", link: "/invest?tab=deposits" },
    { o: "Treasury bills", ret: r.tbillPct != null ? `${num(r.tbillPct, 2)}% (364-day auction)` : "—", risk: "Very low (government)", liq: "To maturity", dur: "28–364 days", tax: "Interest tax applies", min: "Large lots; mainly via banks", prot: "Yes (government)", acc: "Limited for individuals", link: "/invest?tab=funds" },
    { o: "Listed debentures", ret: "Coupon 6–11%; yield depends on price (see table)", risk: "Low–medium (issuer)", liq: "Thinly traded", dur: "Up to maturity (years)", tax: "Interest tax on coupon; CGT on gains", min: "1 unit (≈ Rs. 1,000)", prot: "Issuer must stay sound", acc: "Broker (TMS) / IPO", link: "/invest?tab=funds" },
    { o: "Mutual funds (SIP)", ret: r.equityLongRunPct != null ? `≈ ${num(r.equityLongRunPct, 1)}%/yr NEPSE 10-yr (not guaranteed)` : "Variable", risk: "Medium–high", liq: "Days", dur: "3+ years", tax: "CGT on gains; fund fees", min: "Often Rs. 1,000/month (SIP)", prot: "No", acc: "Fund manager / Mero Share", link: "/future" },
    { o: "NEPSE stocks", ret: r.equityLongRunPct != null ? `≈ ${num(r.equityLongRunPct, 1)}%/yr 10-yr incl. dividends (not guaranteed)` : "Variable", risk: "High", liq: "T+2 (liquid stocks)", dur: "5+ years", tax: "CGT 7.5% / 5%; 5% dividend tax; broker fees", min: "1 share", prot: "No", acc: "Demat + Mero Share + broker TMS", link: "/trading?tab=longterm" },
    { o: "CIT / EPF / SSF", ret: "Published by each fund (see provider)", risk: "Low", liq: "Long lock-in", dur: "Until retirement / scheme term", tax: "Tax benefits within limits", min: "Scheme-specific", prot: "Generally yes (scheme rules)", acc: "Employer or provider", link: "/future" },
  ];
  return (
    <>
      <Card title={`Three ways to invest ${rs(c.amount, 0)}`} sub="Expected returns use current official rates and NEPSE's 10-year record; worst year assumes a 35% equity fall">
        <div className="grid g3">{c.profiles.map((p: Any) => (
          <div key={p.name} className="opt">
            <div className="row between"><strong>{p.name}</strong><Badge tone={p.name === "Conservative" ? "up" : p.name === "Growth" ? "warn" : "blue"}>{p.protectedPct}% protected</Badge></div>
            <div className="small muted">{p.why}</div>
            {p.parts.map((x: Any) => <div key={x.option} className="row between small" style={{ flexWrap: "nowrap", gap: 8 }}><span>{x.pct}% {x.option}</span><span className="mono">{compact(x.amount)}</span></div>)}
            <div className="sep" />
            <div className="row between small"><span>Expected a year</span><strong>{p.expectedPct != null ? `${num(p.expectedPct, 2)}%` : "—"}</strong></div>
            <div className="row between small"><span>In 5 years (expected)</span><strong>{p.in5y != null ? compact(p.in5y) : "—"}</strong></div>
            <div className="row between small"><span>A bad year</span><strong className={tone(p.worstYearPct)}>{num(p.worstYearPct, 1)}%</strong></div>
          </div>
        ))}</div>
        <p className="tiny faint">The plan above adjusts for your emergency fund, loans and goals; these three are simpler reference mixes. None puts everything in NEPSE.</p>
      </Card>
      <Card title="Options compared">
        <div className="table-scroll"><table className="t small"><thead><tr><th>Option</th><th>Return</th><th>Risk</th><th>Liquidity</th><th>Duration</th><th>Tax & fees</th><th>Minimum</th><th>Capital protected</th><th>How to access</th></tr></thead>
          <tbody>{opts.map((x) => <tr key={x.o}><td><Link to={x.link}>{x.o}</Link></td><td>{x.ret}</td><td>{x.risk}</td><td>{x.liq}</td><td>{x.dur}</td><td>{x.tax}</td><td>{x.min}</td><td>{x.prot}</td><td>{x.acc}</td></tr>)}</tbody></table></div>
      </Card>
    </>
  );
}
