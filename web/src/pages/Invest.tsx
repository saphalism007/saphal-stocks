// Where to invest: "I have Rs. X — where should it go?" Allocation advice from your situation and
// official rates; deposit rates by institution (from their official notices); NRB rates and
// inflation; mutual funds; debentures; government securities; prepay a loan or invest.
import { Fragment, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { Card, Stat, Loading, ErrorBox, Tabs, Badge, Notice, Empty, DataTable, Seg, NumInput } from "../components/ui.tsx";
import { I } from "../components/icons.tsx";
import { compact, num, nptDate, rs, tone } from "../lib/format.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Tab = "advisor" | "deposits" | "rates" | "funds" | "loan";

export default function Invest() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "advisor";
  return (
    <div className="page">
      <div className="page-head"><div><h1>Where to Invest</h1><p className="muted">Compare real options in Nepal and get a split that fits your risk, goals and the latest official rates. Guaranteed (contractual) and market-linked returns are always shown separately.</p></div></div>
      <Tabs value={tab} onChange={(t) => setSp({ tab: t })} tabs={[{ key: "advisor", label: "Allocation advisor" }, { key: "deposits", label: "Deposit rates" }, { key: "rates", label: "Rates & inflation" }, { key: "funds", label: "Funds, debentures, bonds" }, { key: "loan", label: "Prepay or invest?" }]} />
      {tab === "advisor" && <Advisor />}
      {tab === "deposits" && <Deposits />}
      {tab === "rates" && <Rates />}
      {tab === "funds" && <FundsBonds />}
      {tab === "loan" && <LoanVsInvest />}
      <p className="tiny faint" style={{ marginTop: 16 }}>Decision support, not licensed financial advice. Confirm rates and terms with the institution before investing.</p>
    </div>
  );
}

function Advisor() {
  const money = useApi<Any>("/money");
  const [amount, setAmount] = useState(500000);
  const [monthly, setMonthly] = useState(0);
  const [risk, setRisk] = useState<"" | "low" | "medium" | "high">("");
  const [horizon, setHorizon] = useState<number | "">("");
  const [r, setR] = useState<Any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => { setBusy(true); setErr(null); try { setR(await api("/money/allocate", { body: { amount, monthly: monthly || undefined, risk: risk || undefined, horizonYears: horizon === "" ? undefined : horizon } })); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const KCOL: Record<string, string> = { debt: "var(--down)", safety: "var(--blue)", guaranteed: "var(--up)", market: "var(--violet)" };
  return (
    <div className="col">
      <Card title="I have money available. Where should it go?">
        <div className="form-grid">
          <label className="field">Amount to invest now (Rs.)<NumInput className="input" value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} /></label>
          <label className="field">Plus every month (Rs., optional)<NumInput className="input" value={monthly || ""} onChange={(e) => setMonthly(Number(e.target.value) || 0)} /></label>
          <label className="field">Risk<select className="input" value={risk} onChange={(e) => setRisk(e.target.value as typeof risk)}><option value="">From My Money ({money.data?.data?.risk ?? "medium"})</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          <label className="field">Horizon (years)<NumInput className="input" placeholder={`From My Money (${money.data?.data?.horizonYears ?? 5})`} value={horizon} onChange={(e) => setHorizon(e.target.value === "" ? "" : Number(e.target.value))} /></label>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary" disabled={busy || amount <= 0} onClick={run}>{busy ? <span className="spinner" /> : "Show my plan"}</button>
          {[100000, 500000, 1000000].map((a) => <button key={a} className="btn sm" onClick={() => setAmount(a)}>{compact(a)}</button>)}
          {!money.data?.saved && <span className="small muted">Tip: fill in <Link to="/money">My Money</Link> so the plan accounts for your emergency fund, loans and goals.</span>}
        </div>
        {err && <ErrorBox error={err} />}
      </Card>
      {r && (
        <>
          <div className="grid g4">
            <Stat label="Guaranteed / contractual" value={`${num(r.guaranteedPct, 0)}%`} sub="Debt repaid, deposits, bonds" />
            <Stat label="Market-linked (max)" value={`${r.equityCapPct}% of long-term money`} sub={`${r.inputs.risk} risk, ${r.inputs.horizonYears}-year horizon`} />
            <Stat label={`In 1 year (expected)`} value={compact(r.projections[0].mid)} sub={`Range ${compact(r.projections[0].low)} – ${compact(r.projections[0].high)}`} />
            <Stat label={`In ${r.projections[1].years} years (expected)`} value={compact(r.projections[1].mid)} sub={`Range ${compact(r.projections[1].low)} – ${compact(r.projections[1].high)}`} />
          </div>
          <Card title="Suggested split" sub="Priorities: costly debt, then safety, then near-term goals, then long-term growth">
            <div className="bucket-bar" style={{ marginBottom: 12 }}>{r.buckets.map((b: Any) => <div key={b.name} title={`${b.name}: ${compact(b.amount)}`} style={{ width: `${(b.amount / amount) * 100}%`, background: KCOL[b.kind] }} />)}</div>
            <div className="list">{r.buckets.map((b: Any) => (
              <div key={b.name} className="list-row" style={{ alignItems: "flex-start" }}>
                <span className="dot" style={{ background: KCOL[b.kind], marginTop: 6 }} />
                <div style={{ flex: 1 }}>
                  <div className="row between"><strong>{b.name}</strong><strong className="mono">{rs(b.amount, 0)} <span className="muted small">({num((b.amount / amount) * 100, 0)}%)</span></strong></div>
                  <div className={`small ${b.guaranteed ? "tag-g" : "tag-m"}`}>{b.guaranteed ? "Guaranteed: " : "Not guaranteed: "}{b.returnText}</div>
                  <div className="small muted">{b.why}</div>
                  <div className="small">Options: {b.options.join(" · ")}</div>
                </div>
              </div>
            ))}</div>
            {r.monthlySplit.length > 0 && <div style={{ marginTop: 12 }}><strong className="small">Each month:</strong> {r.monthlySplit.map((m: Any) => `${m.name} ${rs(m.amount, 0)}`).join(" · ")}</div>}
            <div className="row" style={{ marginTop: 12 }}>
              <Link className="btn sm" to="/invest?tab=deposits">Best deposit rates</Link>
              <Link className="btn sm" to="/invest?tab=funds">Mutual funds & debentures</Link>
              <Link className="btn sm" to="/stocks">Strong stocks</Link>
              <Link className="btn sm" to={`/analyst?q=${encodeURIComponent(`I have Rs. ${amount}${monthly ? ` and can add Rs. ${monthly} every month` : ""}. Using my money data, goals and current rates, where should I put it in Nepal? Compare realistic options with expected outcomes.`)}`}><I.ai /> Discuss with AI</Link>
            </div>
          </Card>
          <Card title="Rates behind this plan">
            <dl className="kv small">{Object.entries(r.rates.sources as Record<string, string>).map(([k, v]) => <Fragment key={k}><dt>{({ fd: "Fixed deposit", saving: "Savings", tbill: "T-bill", inflation: "Inflation", equity: "NEPSE long run" } as Record<string, string>)[k] ?? k}</dt><dd>{v}</dd></Fragment>)}</dl>
            <p className="tiny faint">Projections: guaranteed parts compound at their contractual after-tax rate; market-linked parts show a range (not a forecast).</p>
          </Card>
        </>
      )}
    </div>
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
