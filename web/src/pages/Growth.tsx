// My Growth: today's to-do list, a plan for every holding, the trading discipline coach (with the
// pre-buy checklist) and the dividend & events calendar.
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { Card, Stat, Tabs, Badge, Empty, Loading, ErrorBox, NumInput, Notice } from "../components/ui.tsx";
import { compact, num, nptDate, rs, tone, todayNpt } from "../lib/format.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Tab = "today" | "roadmap" | "holdings" | "coach" | "calendar";

export default function Growth() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "today";
  return (
    <div className="page">
      <div className="page-head"><div><h1>My Growth</h1><p className="muted">What needs you today, a plan for every share you own, habits from your own trades, and the dates that matter.</p></div></div>
      <Tabs value={tab} onChange={(t) => setSp({ tab: t })} tabs={[{ key: "today", label: "Today" }, { key: "roadmap", label: "Wealth roadmap" }, { key: "holdings", label: "Holdings plan" }, { key: "coach", label: "Discipline coach" }, { key: "calendar", label: "Dividends & events" }]} />
      {tab === "today" && <Today />}
      {tab === "roadmap" && <Roadmap />}
      {tab === "holdings" && <Holdings />}
      {tab === "coach" && <Coach />}
      {tab === "calendar" && <Calendar />}
    </div>
  );
}

const LV: Record<string, { label: string; cls: string }> = { urgent: { label: "Now", cls: "gr-urgent" }, act: { label: "Act", cls: "gr-act" }, info: { label: "Note", cls: "gr-info" }, watch: { label: "Watch", cls: "gr-info" }, ok: { label: "OK", cls: "gr-ok" } };

function Today() {
  const d = useApi<Any>("/growth/today");
  if (d.error) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading label="Checking your stocks" />;
  const t = d.data;
  return (
    <div className="col">
      <p className="small muted" style={{ margin: 0 }}>Based on prices of {t.date ? nptDate(t.date) : "—"} · {t.holdings} holding{t.holdings === 1 ? "" : "s"} · {t.watch} on your watchlist.</p>
      {t.items.length === 0 ? (
        <Empty title="Nothing needs you today">No stops hit, no buy zones reached, no dates due. {t.holdings + t.watch === 0 && <>Add stocks to a <Link to="/portfolio">portfolio</Link> or <Link to="/watchlist">watchlist</Link> so this list can watch them for you.</>}</Empty>
      ) : (
        <div className="gr-list">{t.items.map((it: Any, i: number) => (
          <Link key={i} to={it.to ?? "#"} className={`gr-item ${LV[it.level].cls}`}>
            <span className="gr-lv">{LV[it.level].label}</span>
            <span className="gr-txt"><b>{it.title}</b><span>{it.text}</span></span>
          </Link>
        ))}</div>
      )}
      <p className="tiny faint">Checked against the chart signals, your journal, thesis review dates, book closures and open issues. Market summary and news are on the <Link to="/">Dashboard</Link>.</p>
    </div>
  );
}

function Roadmap() {
  const d = useApi<Any>("/growth/roadmap");
  if (d.error) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading label="Checking your money" />;
  const st = d.data.steps, done = st.filter((x: Any) => x.status === "done").length;
  const ICON: Record<string, string> = { done: "✓", doing: "◐", todo: "○", unknown: "?" };
  return (
    <div className="col">
      <Card title="Your wealth roadmap" sub="Do the steps in order: each one protects the next. They tick themselves from My Money, Portfolio and your journal.">
        <div className="rm-prog"><i style={{ width: `${(done / st.length) * 100}%` }} /></div>
        <p className="small" style={{ margin: "6px 0 0" }}><b>{done} of {st.length}</b> steps done{d.data.saved ? <> · net worth {compact(d.data.netWorth)}{d.data.savingsRatePct != null ? ` · saving ${d.data.savingsRatePct}% of income` : ""}</> : ""}.</p>
      </Card>
      <ol className="rm">{st.map((x: Any) => (
        <li key={x.n} className={`rm-${x.status}`}>
          <span className="rm-ic">{ICON[x.status]}</span>
          <div className="rm-body"><b>{x.n}. {x.title}</b><span>{x.detail}</span></div>
          {x.status !== "done" && <Link className="btn sm" to={x.to}>{x.cta}</Link>}
        </li>
      ))}</ol>
    </div>
  );
}

function Holdings() {
  const d = useApi<Any>("/growth/holdings");
  const [paper, setPaper] = useState(false);
  if (d.error) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading label="Planning each holding" />;
  const h = d.data, rows = h.rows.filter((r: Any) => paper || !r.paper);
  if (!h.rows.length) return <Empty title="No holdings yet">Add your shares in <Link to="/portfolio">Portfolio</Link> (or import from MeroShare) to get a plan for each.</Empty>;
  const urgent = rows.filter((r: Any) => r.level === "urgent" || r.level === "act").length;
  return (
    <div className="col">
      <div className="grid g4">
        <Stat label="Portfolio value" value={compact(h.total)} sub={`prices of ${h.asOf ? nptDate(h.asOf) : "—"}`} />
        <Stat label="Need action" value={urgent} tone={urgent ? "down" : "up"} sub={urgent ? "see the top of the list" : "all holdings fine"} />
        <Stat label="Biggest sector" value={h.sectors[0] ? `${num(h.sectors[0].pct, 0)}%` : "—"} sub={h.sectors[0]?.sector ?? ""} tone={h.sectors[0]?.pct > 40 ? "down" : ""} />
        <Stat label="Dividend income (est.)" value={h.expectedDividends ? rs(h.expectedDividends, 0) : "—"} sub="if last year's cash dividend repeats, after 5% tax" />
      </div>
      {h.rows.some((r: Any) => r.paper) && <label className="small row" style={{ gap: 6 }}><input type="checkbox" checked={paper} onChange={(e) => setPaper(e.target.checked)} /> Include paper portfolios</label>}
      <div className="gr-holds">{rows.map((r: Any, i: number) => (
        <div key={i} className={`gr-hold ${LV[r.level]?.cls ?? ""}`}>
          <div className="row between" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
            <div style={{ minWidth: 0 }}><Link to={`/terminal/${r.symbol}`} className="mono" style={{ fontWeight: 700, fontSize: 15 }}>{r.symbol}</Link> <span className="tiny faint">{r.sector}{r.paper ? " · paper" : ""}</span></div>
            {r.verdict && <Badge tone={/BUY/.test(r.verdict) ? "up" : /SELL/.test(r.verdict) ? "down" : "warn"}>{r.verdict}</Badge>}
          </div>
          <div className="gr-action"><b>{r.action}</b><span>{r.why}</span></div>
          <div className="gr-kv">
            <span>Qty <b>{num(r.qty, 0)}</b></span><span>Cost <b>{num(r.wacc)}</b></span><span>Price <b>{r.price != null ? num(r.price) : "—"}</b></span>
            <span>P/L <b className={tone(r.pnl)}>{r.pnl != null ? compact(r.pnl) : "—"} {r.pnlPct != null ? `(${num(r.pnlPct, 1)}%)` : ""}</b></span>
            <span>Weight <b className={r.weightPct > 25 ? "down" : ""}>{num(r.weightPct, 1)}%</b></span>
            <span>Stop <b className="down">{r.stop != null ? num(r.stop) : "—"}</b></span><span>Target <b className="up">{r.t1 != null ? num(r.t1) : "—"}</b></span>
            <span>Support <b>{r.support != null ? num(r.support) : "—"}</b></span><span>Resistance <b>{r.resistance != null ? num(r.resistance) : "—"}</b></span>
          </div>
          <div className="tiny faint">If sold today: fees {r.sellCharges != null ? rs(r.sellCharges, 0) : "—"}, capital gains tax {r.cgt != null ? rs(r.cgt, 0) : "—"} ({r.held != null && r.held > 365 ? "held over a year: 7.5%" : "held a year or less: 10%"}) → you receive {r.netIfSold != null ? rs(r.netIfSold, 0) : "—"}.{r.expDividend ? ` Expected dividend ${rs(r.expDividend, 0)} (based on ${r.divYear}).` : ""}</div>
        </div>
      ))}</div>
      <p className="tiny faint">Stops, targets and verdicts come from the same chart analysis as the ⚡ Buy/Sell signal. Tax rates are Nepal's individual CGT on listed shares as set in Settings → Fees.</p>
    </div>
  );
}

function Coach() {
  const c = useApi<Any>("/growth/coach");
  const [sym, setSym] = useState("");
  const [capital, setCapital] = useState<number | "">(100000);
  const [risk, setRisk] = useState<number | "">(1);
  const [chk, setChk] = useState<Any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [logged, setLogged] = useState(false);
  const run = async () => {
    if (!sym.trim()) return; setErr(null); setChk(null); setLogged(false); setTicks({});
    try { setChk(await api(`/growth/pretrade/${encodeURIComponent(sym.trim().toUpperCase())}?capital=${capital || 100000}&risk=${risk || 1}`)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const MAN = ["I can explain in one sentence why I'm buying", "I accept losing the risk amount if the stop is hit", "I'm not buying because of a tip, fear of missing out, or to win back a loss"];
  const log = async () => {
    if (!chk) return;
    await api("/vault/journal", { body: { date: todayNpt(), symbol: chk.symbol, setup: "Other", entry: chk.price, stop: chk.stop ?? 0, target: chk.target ?? 0, qty: chk.qty, exit: null, reason: chk.setup, emotion: "calm", followedPlan: true, lessons: "" } });
    setLogged(true); c.reload();
  };
  const h = c.data;
  return (
    <div className="col">
      <Card title="Before you buy: the checklist" sub="Works out how many shares to buy from the risk you accept, and checks every rule">
        <div className="form-grid">
          <label className="field">Stock symbol<input className="input" value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} placeholder="e.g. NABIL" onKeyDown={(e) => { if (e.key === "Enter") void run(); }} autoCapitalize="characters" /></label>
          <label className="field">Trading capital (Rs.)<NumInput className="input" value={capital} onChange={(e) => setCapital(e.target.value === "" ? "" : Number(e.target.value))} /></label>
          <label className="field">Risk per trade (% of capital)<NumInput className="input" value={risk} step={0.5} onChange={(e) => setRisk(e.target.value === "" ? "" : Number(e.target.value))} /></label>
        </div>
        <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={run} disabled={!sym.trim()}>Check this trade</button></div>
        {err && <ErrorBox error={err} />}
        {chk && (
          <div className="col" style={{ marginTop: 12, gap: 8 }}>
            <div className={`gr-go ${chk.go === "GO" ? "gr-ok" : chk.go === "CAREFUL" ? "gr-act" : "gr-urgent"}`}>
              <b>{chk.go}</b>
              <span>{chk.symbol} at Rs. {num(chk.price)} · verdict {chk.verdict}. {chk.qty > 0 ? <>Buy <b>{num(chk.qty, 0)} shares</b> (Rs. {num(chk.cost, 0)}), stop Rs. {chk.stop != null ? num(chk.stop) : "—"}, target Rs. {chk.target != null ? num(chk.target) : "—"}. If the stop is hit you lose about Rs. {num(chk.riskRs, 0)}.</> : "No valid stop below the price, so no position size can be worked out."}</span>
            </div>
            <ul className="gr-checks">{chk.checks.map((x: Any, i: number) => <li key={i} className={x.ok === true ? "ok" : x.ok === false ? "bad" : "unk"}><span>{x.ok === true ? "✓" : x.ok === false ? "✕" : "?"}</span><div><b>{x.label}</b><em>{x.detail}</em></div></li>)}</ul>
            <div className="small"><b>Your own check</b></div>
            {MAN.map((m) => <label key={m} className="small row" style={{ gap: 8, flexWrap: "nowrap", alignItems: "flex-start" }}><input type="checkbox" checked={!!ticks[m]} onChange={(e) => setTicks({ ...ticks, [m]: e.target.checked })} style={{ marginTop: 3 }} /> {m}</label>)}
            <div className="row">
              <button className="btn" disabled={logged || chk.qty <= 0 || MAN.some((m) => !ticks[m])} onClick={log}>{logged ? "Logged in your journal ✓" : "Log this trade plan in my journal"}</button>
              <Link className="btn ghost" to={`/terminal/${chk.symbol}`}>Open chart</Link>
            </div>
            <p className="tiny faint" style={{ margin: 0 }}>Logging saves the plan (price, stop, target, shares) so the coach and the Today list can track it. It does not place any order.</p>
          </div>
        )}
      </Card>

      <Card title="Your trading habits" sub="From the closed trades in your journal">
        {c.error ? <ErrorBox error={c.error} /> : !h ? <Loading /> : (
          <>
            <div className="grid g4">
              <Stat label="Closed trades" value={h.closed} sub={`${h.open} open`} />
              <Stat label="Win rate" value={h.winRatePct != null ? `${h.winRatePct}%` : "—"} />
              <Stat label="Avg win / avg loss" value={h.avgWinPct != null || h.avgLossPct != null ? `${h.avgWinPct ?? "—"}% / ${h.avgLossPct ?? "—"}%` : "—"} />
              <Stat label="Average per trade" value={h.expectancyPct != null ? `${h.expectancyPct > 0 ? "+" : ""}${h.expectancyPct}%` : "—"} tone={tone(h.expectancyPct)} sub={h.holdWinDays != null ? `hold winners ${h.holdWinDays}d, losers ${h.holdLossDays ?? "—"}d` : undefined} />
            </div>
            <div className="gr-list" style={{ marginTop: 10 }}>{h.insights.map((x: Any, i: number) => (
              <div key={i} className={`gr-item ${x.tone === "good" ? "gr-ok" : x.tone === "bad" ? "gr-urgent" : "gr-info"}`}><span className="gr-lv">{x.tone === "good" ? "Good" : x.tone === "bad" ? "Fix" : "Note"}</span><span className="gr-txt"><b>{x.title}</b><span>{x.text}</span></span></div>
            ))}</div>
            {h.closed === 0 && <Notice>Record your trades in the <Link to="/journal">Trading journal</Link> (or use the checklist above to log plans). After a few closed trades, this shows the habits that make or cost you money.</Notice>}
          </>
        )}
      </Card>

      <Card title="The rules that keep traders in the game">
        <ol className="small" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
          <li>Risk at most 1–2% of your capital on any one trade.</li>
          <li>Set the stop-loss before you buy, and sell when a day closes below it.</li>
          <li>Only take trades where the target is at least twice as far as the stop.</li>
          <li>Never add money to a losing trade to "average down".</li>
          <li>Keep no more than 25% in one stock and 40% in one sector.</li>
          <li>After 3 losses in a row, halve your size until you win again.</li>
          <li>Write down every trade and review the journal every month.</li>
        </ol>
      </Card>
    </div>
  );
}

function Calendar() {
  const d = useApi<Any>("/growth/calendar");
  const [all, setAll] = useState(false);
  if (d.error) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading label="Collecting dates" />;
  const c = d.data;
  const f = <T extends { mine: string | null }>(xs: T[]) => (all ? xs : xs.filter((x) => x.mine));
  const tag = (m: string | null) => (m ? <Badge tone={m === "holding" ? "accent" : ""}>{m === "holding" ? "you hold" : "watchlist"}</Badge> : null);
  return (
    <div className="col">
      <label className="small row" style={{ gap: 6 }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show the whole market (not only your holdings and watchlist)</label>
      <Card title="Upcoming book closures" sub="Hold the shares through the book-closure date to receive the dividend or bonus">
        {f(c.bookClosures).length === 0 ? <p className="small muted">{all ? "No upcoming book closures in the data." : "None for your stocks. Tick the box above to see the whole market."}</p> : (
          <div className="table-scroll"><table className="t small"><thead><tr><th>Stock</th><th>Book closure</th><th className="num">Cash</th><th className="num">Bonus</th><th>Year</th></tr></thead>
            <tbody>{f(c.bookClosures).map((b: Any, i: number) => <tr key={i}><td><Link className="mono" to={`/stocks/${b.symbol}?tab=dividends`}>{b.symbol}</Link> {tag(b.mine)}</td><td>{nptDate(b.bookclose_date)} <span className="tiny faint">{b.days === 0 ? "today" : b.days > 0 ? `in ${b.days}d` : `${-b.days}d ago`}</span></td><td className="num">{b.cash_pct ? `${num(b.cash_pct)}%` : "—"}</td><td className="num">{b.bonus_pct ? `${num(b.bonus_pct)}%` : "—"}</td><td>{b.fiscal_year}</td></tr>)}</tbody></table></div>
        )}
      </Card>
      <Card title="IPOs, right shares and other issues" sub="Open now or opening soon (apply in MeroShare)">
        {c.issues.length === 0 ? <p className="small muted">No open or upcoming issues in the data.</p> : (
          <div className="table-scroll"><table className="t small"><thead><tr><th>Company</th><th>Type</th><th>Opens</th><th>Closes</th></tr></thead>
            <tbody>{(all ? c.issues : c.issues.slice(0, 15)).map((i: Any, k: number) => <tr key={k}><td>{i.company ?? i.symbol} {tag(i.mine)}</td><td>{i.issue_type}{i.ratio ? ` (${i.ratio})` : ""}</td><td>{nptDate(i.opening_date)}{i.open ? <Badge tone="up">open</Badge> : <span className="tiny faint"> in {i.daysToOpen}d</span>}</td><td>{nptDate(i.closing_date)} <span className="tiny faint">{i.daysToClose <= 0 ? "today" : `in ${i.daysToClose}d`}</span></td></tr>)}</tbody></table></div>
        )}
      </Card>
      <Card title="AGM, dividend and book-closure notices (last 30 days)" sub="Dates in Nepali (BS) are shown exactly as announced">
        {f(c.notices).length === 0 ? <p className="small muted">{all ? "No notices in the last 30 days." : "No notices for your stocks in the last 30 days."}</p> : (
          <div className="gr-notices">{f(c.notices).map((n: Any, i: number) => (
            <a key={i} href={n.url} target="_blank" rel="noopener noreferrer" className="gr-notice"><span className="tiny faint">{nptDate(n.published_date)} · {n.category} {n.symbol ? `· ${n.symbol}` : ""}</span><span className="small">{n.title}</span>{tag(n.mine)}</a>
          ))}</div>
        )}
      </Card>
    </div>
  );
}
