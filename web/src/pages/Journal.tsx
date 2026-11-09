import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { Card, Stat, Empty, Badge, Tabs, Modal, Notice, DataTable, Score, NumInput } from "../components/ui.tsx";
import { num, pct, tone, todayNpt, nptDate, compact } from "../lib/format.ts";
import { I } from "../components/icons.tsx";
import { roundTrip } from "../../../shared/costs.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface VaultRow<T> { id: number; data: T; createdAt: string; updatedAt: string }
interface Trade { date: string; symbol: string; setup: string; entry: number; stop: number; target: number; qty: number; exitDate?: string; exit?: number | null; reason: string; emotion: string; followedPlan: boolean; lessons: string }
interface Thesis { symbol: string; createdOn: string; priceAtCreation: number | null; horizon: string; thesis: string; catalysts: string; watchMetrics: string; invalidation: string; fairValue: number | null; reviewOn: string; status: "active" | "validated" | "broken" | "closed"; notes: string }

const SETUPS = ["Breakout", "Pullback to support", "Momentum", "Oversold bounce", "Trend continuation", "Dividend play", "IPO / listing", "News / announcement", "Other"];

export default function Journal() {
  const [tab, setTab] = useState<"journal" | "theses">("journal");
  return (
    <div className="page">
      <div className="page-head"><div><h1>Trading Journal & Investment Theses</h1><p>Record why you entered, what you planned and what happened. Review it to learn which setups actually work for you. Entries are encrypted at rest.</p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "journal", label: "Trading journal" }, { key: "theses", label: "Investment theses" }]} />
      {tab === "journal" ? <TradeJournal /> : <Theses />}
    </div>
  );
}

function TradeJournal() {
  const j = useApi<VaultRow<Trade>[]>("/vault/journal");
  const [edit, setEdit] = useState<VaultRow<Trade> | null | "new">(null);
  const rows = j.data ?? [];
  const stats = useMemo(() => {
    const closed = rows.filter((r) => r.data.exit != null && r.data.exit > 0);
    const res = closed.map((r) => {
      const t = r.data;
      const days = t.exitDate ? Math.max(0, Math.round((Date.parse(t.exitDate) - Date.parse(t.date)) / 86_400_000)) : 30;
      const rt = roundTrip(t.qty, t.entry, t.exit as number, days);
      const risk = (t.entry - t.stop) * t.qty;
      return { setup: t.setup, net: rt.netProfit, pct: rt.netReturnPct, r: risk > 0 ? rt.netProfit / risk : null, followed: t.followedPlan };
    });
    const by = new Map<string, { n: number; wins: number; net: number; rs: number[] }>();
    for (const x of res) { const e = by.get(x.setup) || { n: 0, wins: 0, net: 0, rs: [] }; e.n++; if (x.net > 0) e.wins++; e.net += x.net; if (x.r != null) e.rs.push(x.r); by.set(x.setup, e); }
    const followed = res.filter((x) => x.followed), broke = res.filter((x) => !x.followed);
    return {
      closed: res.length, open: rows.length - closed.length, winRate: res.length ? (res.filter((x) => x.net > 0).length / res.length) * 100 : null,
      net: res.reduce((s, x) => s + x.net, 0), avgR: res.filter((x) => x.r != null).length ? res.reduce((s, x) => s + (x.r ?? 0), 0) / res.filter((x) => x.r != null).length : null,
      followedWin: followed.length ? (followed.filter((x) => x.net > 0).length / followed.length) * 100 : null,
      brokeWin: broke.length ? (broke.filter((x) => x.net > 0).length / broke.length) * 100 : null,
      bySetup: [...by.entries()].map(([setup, e]) => ({ setup, ...e, winRate: (e.wins / e.n) * 100, avgR: e.rs.length ? e.rs.reduce((a, b) => a + b, 0) / e.rs.length : null })),
    };
  }, [rows]);
  return (
    <div className="col">
      <div className="row between"><span className="muted small">Net results include Nepal commission, SEBON fee, DP charge and capital gains tax.</span><button className="btn primary" onClick={() => setEdit("new")}><I.plus /> Log a trade</button></div>
      <div className="grid g6">
        <Stat label="Closed trades" value={stats.closed} sub={`${stats.open} open`} />
        <Stat label="Win rate" value={stats.winRate != null ? `${num(stats.winRate, 0)}%` : "—"} />
        <Stat label="Net P&L (after costs & tax)" value={compact(stats.net)} tone={tone(stats.net)} />
        <Stat label="Average R" value={stats.avgR != null ? `${num(stats.avgR, 2)}R` : "—"} sub="Net profit ÷ planned risk" />
        <Stat label="Win rate: plan followed" value={stats.followedWin != null ? `${num(stats.followedWin, 0)}%` : "—"} />
        <Stat label="Win rate: plan broken" value={stats.brokeWin != null ? `${num(stats.brokeWin, 0)}%` : "—"} />
      </div>
      {stats.bySetup.length > 0 && <Card title="Results by setup" flush><DataTable rows={stats.bySetup} cols={[{ key: "setup", label: "Setup" }, { key: "n", label: "Trades", num: true }, { key: "winRate", label: "Win rate", num: true, render: (r: any) => `${num(r.winRate, 0)}%` }, { key: "avgR", label: "Avg R", num: true, render: (r: any) => num(r.avgR, 2) }, { key: "net", label: "Net P&L", num: true, render: (r: any) => <span className={tone(r.net)}>{compact(r.net)}</span> }]} /></Card>}
      <Card title="Trades" flush>
        {rows.length === 0 ? <Empty title="No trades logged yet">Log each trade with your plan (entry, stop, target) before or right after you place it.</Empty> : (
          <DataTable rows={[...rows].sort((a, b) => (a.data.date < b.data.date ? 1 : -1))} onRow={(r: any) => setEdit(r)} cols={[
            { key: "date", label: "Date", sort: (r: any) => r.data.date, render: (r: any) => nptDate(r.data.date) },
            { key: "symbol", label: "Stock", sort: (r: any) => r.data.symbol, render: (r: any) => <span className="sym">{r.data.symbol}</span> },
            { key: "setup", label: "Setup", sort: (r: any) => r.data.setup, render: (r: any) => <Badge>{r.data.setup}</Badge> },
            { key: "plan", label: "Entry / stop / target", render: (r: any) => <span className="mono small">{num(r.data.entry)} / {num(r.data.stop)} / {num(r.data.target)}</span> },
            { key: "exit", label: "Exit", num: true, sort: (r: any) => r.data.exit, render: (r: any) => r.data.exit ? num(r.data.exit) : <Badge tone="blue">Open</Badge> },
            { key: "ret", label: "Net %", num: true, sort: (r: any) => (r.data.exit ? (r.data.exit - r.data.entry) / r.data.entry : null), render: (r: any) => { if (!r.data.exit) return "—"; const p = roundTrip(r.data.qty, r.data.entry, r.data.exit, 30).netReturnPct; return <span className={tone(p)}>{pct(p, 1)}</span>; } },
            { key: "followed", label: "Plan", render: (r: any) => r.data.followedPlan ? <Badge tone="up">Followed</Badge> : <Badge tone="warn">Broken</Badge> },
            { key: "lessons", label: "Lesson", render: (r: any) => <span className="small muted">{r.data.lessons?.slice(0, 80)}</span> },
          ]} />
        )}
      </Card>
      {edit && <TradeModal row={edit === "new" ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); j.reload(); }} />}
    </div>
  );
}

function TradeModal({ row, onClose, onDone }: { row: VaultRow<Trade> | null; onClose: () => void; onDone: () => void }) {
  const [t, setT] = useState<any>(row?.data ?? { date: todayNpt(), symbol: "", setup: "Breakout", entry: "", stop: "", target: "", qty: "", exitDate: "", exit: "", reason: "", emotion: "Calm", followedPlan: true, lessons: "" });
  const [err, setErr] = useState<string | null>(null);
  const rr = +t.entry > +t.stop && +t.target > +t.entry ? (+t.target - +t.entry) / (+t.entry - +t.stop) : null;
  const save = async () => {
    if (!t.symbol || !(+t.entry > 0) || !(+t.qty > 0)) return setErr("Symbol, entry price and quantity are required.");
    const body = { ...t, symbol: t.symbol.toUpperCase(), entry: +t.entry, stop: +t.stop || 0, target: +t.target || 0, qty: +t.qty, exit: t.exit ? +t.exit : null };
    try { if (row) await api(`/vault/journal/${row.id}`, { method: "PUT", body }); else await api("/vault/journal", { body }); onDone(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const set = (k: string) => (e: React.ChangeEvent<any>) => setT({ ...t, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <Modal title={row ? `Trade: ${row.data.symbol}` : "Log a trade"} onClose={onClose} footer={<>{row && <button className="btn danger" onClick={async () => { await api(`/vault/journal/${row.id}`, { method: "DELETE" }); onDone(); }}>Delete</button>}<button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="col">
        <div className="grid g3">
          <label className="field">Date<input className="input" type="date" value={t.date} onChange={set("date")} /></label>
          <label className="field">Symbol<input className="input" value={t.symbol} onChange={(e) => setT({ ...t, symbol: e.target.value.toUpperCase() })} /></label>
          <label className="field">Setup<select className="input" value={t.setup} onChange={set("setup")}>{SETUPS.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="field">Entry price<NumInput className="input" value={t.entry} onChange={set("entry")} /></label>
          <label className="field">Planned stop<NumInput className="input" value={t.stop} onChange={set("stop")} /></label>
          <label className="field">Planned target<NumInput className="input" value={t.target} onChange={set("target")} /></label>
          <label className="field">Quantity<NumInput className="input" value={t.qty} onChange={set("qty")} /></label>
          <label className="field">Exit date<input className="input" type="date" value={t.exitDate ?? ""} onChange={set("exitDate")} /></label>
          <label className="field">Exit price (blank if open)<NumInput className="input" value={t.exit ?? ""} onChange={set("exit")} /></label>
        </div>
        {rr != null && <div className="small muted">Planned risk/reward {num(rr, 2)} · risk Rs. {num((+t.entry - +t.stop) * +t.qty, 0)}</div>}
        <label className="field">Why I took it<textarea className="input" value={t.reason} onChange={set("reason")} /></label>
        <div className="grid g2">
          <label className="field">How I felt<select className="input" value={t.emotion} onChange={set("emotion")}>{["Calm", "Confident", "Fear of missing out", "Anxious", "Revenge / frustrated", "Greedy", "Bored"].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="chk" style={{ alignSelf: "end", paddingBottom: 8 }}><input type="checkbox" checked={!!t.followedPlan} onChange={set("followedPlan")} /> I followed my plan (entry, stop, size)</label>
        </div>
        <label className="field">Lessons<textarea className="input" value={t.lessons} onChange={set("lessons")} style={{ minHeight: 50 }} /></label>
        {err && <Notice tone="warn">{err}</Notice>}
      </div>
    </Modal>
  );
}

function Theses() {
  const th = useApi<VaultRow<Thesis>[]>("/vault/thesis");
  const stocks = useApi<any[]>("/stocks");
  const [edit, setEdit] = useState<VaultRow<Thesis> | null | "new">(null);
  const info = (sym: string) => stocks.data?.find((s) => s.symbol === sym);
  const today = todayNpt();
  const rows = th.data ?? [];
  const due = rows.filter((r) => r.data.status === "active" && r.data.reviewOn && r.data.reviewOn <= today);
  return (
    <div className="col">
      <div className="row between"><span className="muted small">Write down why you own a stock and what would prove you wrong, so you review facts instead of price moves.</span><button className="btn primary" onClick={() => setEdit("new")}><I.plus /> New thesis</button></div>
      {due.length > 0 && <Notice tone="warn">Review due: {due.map((d) => d.data.symbol).join(", ")}. Check whether the thesis still holds.</Notice>}
      {rows.length === 0 ? <Card><Empty title="No investment theses yet">For each long-term holding, record the thesis, catalysts, metrics to watch and what would invalidate it.</Empty></Card> : (
        <div className="grid g2">
          {rows.map((r) => {
            const s = info(r.data.symbol);
            const since = s?.close && r.data.priceAtCreation ? ((s.close - r.data.priceAtCreation) / r.data.priceAtCreation) * 100 : null;
            return (
              <Card key={r.id} title={<><Link to={`/stocks/${r.data.symbol}`} className="mono">{r.data.symbol}</Link> <Badge tone={r.data.status === "active" ? "accent" : r.data.status === "validated" ? "up" : r.data.status === "broken" ? "down" : ""}>{r.data.status}</Badge></>}
                sub={`Since ${nptDate(r.data.createdOn)} · ${r.data.horizon}`} actions={<button className="btn sm" onClick={() => setEdit(r)}>Edit</button>}>
                <div className="row small" style={{ marginBottom: 8 }}>
                  <span>Price then <b className="mono">{num(r.data.priceAtCreation)}</b></span><span>now <b className="mono">{num(s?.close)}</b></span><span className={tone(since)}>{pct(since, 1)}</span>
                  {r.data.fairValue ? <span>fair value <b className="mono">{num(r.data.fairValue)}</b> ({pct(s?.close ? ((r.data.fairValue - s.close) / s.close) * 100 : null, 0)} upside)</span> : null}
                  <span>Fund. <Score value={s?.fundamentalScore} /></span>
                </div>
                <div className="small" style={{ whiteSpace: "pre-wrap" }}><strong>Thesis:</strong> {r.data.thesis}</div>
                {r.data.catalysts && <div className="small" style={{ marginTop: 4 }}><strong>Catalysts:</strong> {r.data.catalysts}</div>}
                {r.data.watchMetrics && <div className="small" style={{ marginTop: 4 }}><strong>Watch:</strong> {r.data.watchMetrics}</div>}
                <div className="small down" style={{ marginTop: 4 }}><strong>Wrong if:</strong> {r.data.invalidation || "not defined"}</div>
                <div className="tiny faint" style={{ marginTop: 6 }}>Next review {nptDate(r.data.reviewOn)}{r.data.reviewOn && r.data.reviewOn <= today && r.data.status === "active" ? " (due)" : ""}</div>
                <Link className="btn sm" style={{ marginTop: 8 }} to={`/analyst?q=${encodeURIComponent(`Review my investment thesis for ${r.data.symbol} against the latest data. Thesis: ${r.data.thesis}. Metrics I watch: ${r.data.watchMetrics}. It is invalidated if: ${r.data.invalidation}. Does it still hold? What changed since ${r.data.createdOn}?`)}`}><I.ai /> Review with AI</Link>
              </Card>
            );
          })}
        </div>
      )}
      {edit && <ThesisModal row={edit === "new" ? null : edit} price={(sym) => info(sym)?.close ?? null} onClose={() => setEdit(null)} onDone={() => { setEdit(null); th.reload(); }} />}
    </div>
  );
}

function ThesisModal({ row, price, onClose, onDone }: { row: VaultRow<Thesis> | null; price: (s: string) => number | null; onClose: () => void; onDone: () => void }) {
  const in90 = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  const [t, setT] = useState<any>(row?.data ?? { symbol: "", createdOn: todayNpt(), priceAtCreation: null, horizon: "3-5 years", thesis: "", catalysts: "", watchMetrics: "", invalidation: "", fairValue: "", reviewOn: in90, status: "active", notes: "" });
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!t.symbol || !t.thesis) return setErr("Symbol and thesis are required.");
    const sym = t.symbol.toUpperCase();
    const body = { ...t, symbol: sym, priceAtCreation: t.priceAtCreation ?? price(sym), fairValue: t.fairValue ? +t.fairValue : null };
    try { if (row) await api(`/vault/thesis/${row.id}`, { method: "PUT", body }); else await api("/vault/thesis", { body }); onDone(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const set = (k: string) => (e: React.ChangeEvent<any>) => setT({ ...t, [k]: e.target.value });
  return (
    <Modal title={row ? `Thesis: ${row.data.symbol}` : "New investment thesis"} onClose={onClose} footer={<>{row && <button className="btn danger" onClick={async () => { await api(`/vault/thesis/${row.id}`, { method: "DELETE" }); onDone(); }}>Delete</button>}<button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="col">
        <div className="grid g3">
          <label className="field">Symbol<input className="input" value={t.symbol} onChange={(e) => setT({ ...t, symbol: e.target.value.toUpperCase() })} disabled={!!row} /></label>
          <label className="field">Horizon<select className="input" value={t.horizon} onChange={set("horizon")}>{["6-12 months", "1-3 years", "3-5 years", "5+ years"].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="field">Status<select className="input" value={t.status} onChange={set("status")}>{["active", "validated", "broken", "closed"].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="field">Your fair value (Rs.)<NumInput className="input" value={t.fairValue ?? ""} onChange={set("fairValue")} /></label>
          <label className="field">Next review<input className="input" type="date" value={t.reviewOn} onChange={set("reviewOn")} /></label>
        </div>
        <label className="field">Thesis: why this company, why now<textarea className="input" value={t.thesis} onChange={set("thesis")} /></label>
        <label className="field">Catalysts<textarea className="input" value={t.catalysts} onChange={set("catalysts")} style={{ minHeight: 50 }} placeholder="e.g. new plant commissioning, falling NPL, rate cuts" /></label>
        <label className="field">Metrics to watch<input className="input" value={t.watchMetrics} onChange={set("watchMetrics")} placeholder="e.g. ROE > 14%, NPL < 3%, dividend each year" /></label>
        <label className="field">What would prove me wrong<textarea className="input" value={t.invalidation} onChange={set("invalidation")} style={{ minHeight: 50 }} /></label>
        {err && <Notice tone="warn">{err}</Notice>}
      </div>
    </Modal>
  );
}
