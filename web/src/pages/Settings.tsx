import { useEffect, useState } from "react";
import { api, useApi } from "../lib/api.ts";
import { Card, Loading, Badge, Notice, Tabs, DataTable } from "../components/ui.tsx";
import { nptDate, ago, int } from "../lib/format.ts";
import { I } from "../components/icons.tsx";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tab = "data" | "quality" | "ai" | "fees" | "security";

export default function Settings() {
  const [tab, setTab] = useState<Tab>("data");
  return (
    <div className="page">
      <div className="page-head"><div><h1>Settings</h1><p>Data sources and refresh, AI provider, Nepal fees and taxes, security, export and deletion.</p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "data", label: "Data" }, { key: "quality", label: "Data quality" }, { key: "ai", label: "AI" }, { key: "fees", label: "Fees & taxes" }, { key: "security", label: "Security & privacy" }]} />
      {tab === "data" && <DataTab />}
      {tab === "quality" && <QualityTab />}
      {tab === "ai" && <AiTab />}
      {tab === "fees" && <FeesTab />}
      {tab === "security" && <SecurityTab />}
    </div>
  );
}

const DATASETS: Record<string, string> = { prices_latest: "Latest prices & quotes", prices_history: "Daily price history", companies: "Company list & sectors", indices: "NEPSE & sector indices", company_details: "Profiles, dividends, statements", news: "Announcements & news", forex: "NRB exchange rates" };

function DataTab() {
  const s = useApi<any>("/data/status");
  useEffect(() => { const id = setInterval(() => s.reload(), 4000); return () => clearInterval(id); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = async (job: string) => { await api("/data/refresh", { body: { job } }); s.reload(); };
  if (!s.data) return <Loading />;
  const c = s.data.counts;
  return (
    <div className="col">
      <div className="grid g4">
        <Card title="Companies"><div className="mono" style={{ fontSize: 20 }}>{int(c.companies)}</div><div className="small muted">{c.withSector} with sector · {c.companiesWithDetails} with full profile</div></Card>
        <Card title="Price history"><div className="mono" style={{ fontSize: 20 }}>{int(c.priceRows)}</div><div className="small muted">{c.symbolsWithHistory} symbols · {nptDate(c.firstPriceDate)} → {nptDate(c.lastPriceDate)}</div></Card>
        <Card title="Financial statements"><div className="mono" style={{ fontSize: 20 }}>{int(c.reports)}</div><div className="small muted">quarterly reports for {c.companiesWithReports} companies · {int(c.dividends)} dividend records</div></Card>
        <Card title="Indices & news"><div className="mono" style={{ fontSize: 20 }}>{int(c.indexRows)}</div><div className="small muted">index rows · {int(c.announcements)} announcements</div></Card>
      </div>
      <Card title="Datasets & freshness" actions={<button className="btn primary" onClick={() => refresh("all")}><I.refresh /> Refresh everything</button>} flush>
        <table className="t"><thead><tr><th>Dataset</th><th>Source</th><th>Data as of</th><th>Last success</th><th>Rows</th><th>Last error</th><th /></tr></thead><tbody>
          {Object.entries(DATASETS).map(([k, label]) => {
            const f = s.data.freshness.find((x: any) => x.dataset === k);
            const job = { prices_latest: "listing", companies: "listing", prices_history: "history", indices: "indices", company_details: "details", news: "news", forex: "forex" }[k]!;
            const st = s.data.jobs.find((j: any) => j.name === job);
            return (
              <tr key={k}><td><strong>{label}</strong></td><td className="small">{f?.source_url ? <a href={f.source_url} target="_blank" rel="noopener noreferrer">{f.source}</a> : f?.source ?? "—"}</td>
                <td>{f?.as_of ? nptDate(f.as_of) : <span className="warn">Data unavailable</span>}</td><td className="small">{f?.last_success_at ? `${nptDate(f.last_success_at, true)} (${ago(f.last_success_at)})` : "never"}</td>
                <td className="num">{f?.rows ?? "—"}</td><td className="small down">{f?.last_error ? `${f.last_error.slice(0, 80)} (${ago(f.last_error_at)})` : ""}</td>
                <td>{st && (st.status === "running" || st.status === "queued") ? <span className="row small"><span className="spinner" />{st.message}</span> : <button className="btn sm" onClick={() => refresh(job)}>Refresh</button>}</td></tr>
            );
          })}
        </tbody></table>
      </Card>
      {(s.data.missing.noHistory.length > 0 || s.data.missing.noSector.length > 0) && <Notice tone="warn">Missing data: {s.data.missing.noHistory.length ? `no price history for ${s.data.missing.noHistory.slice(0, 20).join(", ")}${s.data.missing.noHistory.length > 20 ? "…" : ""}. ` : ""}{s.data.missing.noSector.length ? `No sector yet for ${s.data.missing.noSector.length} companies (filled by the profile job).` : ""}</Notice>}
      <Card title="How data gets here" sub="Full notes in DATA_SOURCES.md">
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li><strong>Daily price history</strong>: the open nepse-data dataset on GitHub (MIT licence), one CSV per company, history back to the 1990s for older companies.</li>
          <li><strong>Latest prices, sectors, indices, company profiles, dividends, announcements and quarterly statements</strong>: ShareSansar public pages (robots.txt allows crawling). Requests are rate-limited to about one per 1.2 seconds and cached in the local database.</li>
          <li><strong>Exchange rates</strong>: the official Nepal Rastra Bank forex API.</li>
          <li>The official NEPSE website API requires an authentication token that is not publicly offered, so it is not used. If an official API is opened, a new provider can be added without changing the rest of the app.</li>
          <li>Automatic refresh runs daily at 15:45 NPT (after the market closes) and on start-up if data is older than 12 hours. Alerts are evaluated after each refresh.</li>
        </ul>
      </Card>
      <Card title="Recent runs" flush>
        <DataTable rows={s.data.runs} cols={[{ key: "job", label: "Job" }, { key: "status", label: "Status", render: (r: any) => <Badge tone={r.status === "ok" ? "up" : r.status === "error" ? "down" : "warn"}>{r.status}</Badge> }, { key: "started_at", label: "Started", render: (r: any) => nptDate(r.started_at, true) }, { key: "rows", label: "Rows", num: true }, { key: "message", label: "Message", render: (r: any) => <span className="small muted">{r.message}</span> }]} />
      </Card>
    </div>
  );
}

function AiTab() {
  const s = useApi<any>("/settings/ai");
  const [f, setF] = useState({ provider: "anthropic", model: "claude-opus-5-5", effort: "medium", apiKey: "" });
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (s.data) setF((x) => ({ ...x, provider: s.data.provider, model: s.data.model, effort: s.data.effort })); }, [s.data]);
  const save = async () => {
    try { await api("/settings/ai", { method: "PUT", body: { provider: f.provider, model: f.model, effort: f.effort, ...(f.apiKey ? { apiKey: f.apiKey } : {}) } }); setF({ ...f, apiKey: "" }); setMsg("Saved."); s.reload(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="grid g2">
      <Card title="AI provider" sub="Settings are written to the local .env file (never committed to git)">
        <div className="col">
          <label className="field">Provider<select className="input" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}><option value="anthropic">Anthropic Claude</option><option value="none">None (rule-based data reports only)</option></select></label>
          <label className="field">Model<input className="input" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /></label>
          <label className="field">Effort<select className="input" value={f.effort} onChange={(e) => setF({ ...f, effort: e.target.value })}>{["low", "medium", "high", "xhigh", "max"].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="field">API key {s.data?.hasKey && <Badge tone="accent">A key is set</Badge>}<input className="input" type="password" value={f.apiKey} onChange={(e) => setF({ ...f, apiKey: e.target.value })} placeholder={s.data?.hasKey ? "Leave blank to keep the current key" : "sk-ant-…"} autoComplete="off" /></label>
          <button className="btn primary" onClick={save}>Save</button>
          {msg && <Notice>{msg}</Notice>}
        </div>
      </Card>
      <Card title="How the AI works here">
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>The analyst does not guess. It calls tools that read the database and run the deterministic engines (indicators, levels, patterns, fundamentals, rankings, backtests, portfolio, document search), then explains the results.</li>
          <li>It is instructed to cite data dates, separate facts from calculations, assumptions and predictions, and to say "data unavailable" when it is.</li>
          <li>Questions and the data it reads are sent to the AI provider you choose. Without a key, nothing leaves your computer and the analyst answers with rule-based reports.</li>
          <li>Effort: higher effort = more thorough reasoning and higher cost. Medium suits most questions.</li>
        </ul>
      </Card>
    </div>
  );
}

function FeesTab() {
  const s = useApi<any>("/settings/fees");
  const [f, setF] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (s.data) setF(s.data.current); }, [s.data]);
  if (!f) return <Loading />;
  const save = async () => { try { await api("/settings/fees", { method: "PUT", body: { commissionSlabs: f.commissionSlabs, minCommission: +f.minCommission, sebonFeeRate: +f.sebonFeeRate, dpChargePerScrip: +f.dpChargePerScrip, cgtShortTerm: +f.cgtShortTerm, cgtLongTerm: +f.cgtLongTerm, cgtInstitution: +f.cgtInstitution, dividendTax: +f.dividendTax, holdingDaysForLongTerm: +f.holdingDaysForLongTerm, verifiedOn: f.verifiedOn } }); setMsg("Saved. All cost, tax, portfolio and backtest calculations now use these rates."); s.reload(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } };
  return (
    <div className="grid g2">
      <Card title="Broker commission slabs" sub="Rate applies to the whole transaction value in that slab">
        <table className="t"><thead><tr><th>Up to (Rs.)</th><th>Rate %</th></tr></thead><tbody>
          {f.commissionSlabs.map((sl: any, i: number) => (
            <tr key={i}><td><input className="input" type="number" value={sl.upTo ?? ""} placeholder="and above" onChange={(e) => { const c = [...f.commissionSlabs]; c[i] = { ...sl, upTo: e.target.value === "" ? null : +e.target.value }; setF({ ...f, commissionSlabs: c }); }} /></td>
              <td><input className="input" type="number" step="0.01" value={+(sl.rate * 100).toFixed(4)} onChange={(e) => { const c = [...f.commissionSlabs]; c[i] = { ...sl, rate: +e.target.value / 100 }; setF({ ...f, commissionSlabs: c }); }} /></td></tr>
          ))}
        </tbody></table>
      </Card>
      <Card title="Other charges & taxes">
        <div className="form-grid">
          <label className="field">Minimum commission (Rs.)<input className="input" type="number" value={f.minCommission} onChange={(e) => setF({ ...f, minCommission: e.target.value })} /></label>
          <label className="field">SEBON fee %<input className="input" type="number" step="0.001" value={+(f.sebonFeeRate * 100).toFixed(4)} onChange={(e) => setF({ ...f, sebonFeeRate: +e.target.value / 100 })} /></label>
          <label className="field">DP charge per scrip sold (Rs.)<input className="input" type="number" value={f.dpChargePerScrip} onChange={(e) => setF({ ...f, dpChargePerScrip: e.target.value })} /></label>
          <label className="field">CGT, held ≤ threshold %<input className="input" type="number" step="0.5" value={+(f.cgtShortTerm * 100).toFixed(2)} onChange={(e) => setF({ ...f, cgtShortTerm: +e.target.value / 100 })} /></label>
          <label className="field">CGT, held longer %<input className="input" type="number" step="0.5" value={+(f.cgtLongTerm * 100).toFixed(2)} onChange={(e) => setF({ ...f, cgtLongTerm: +e.target.value / 100 })} /></label>
          <label className="field">Long-term threshold (days)<input className="input" type="number" value={f.holdingDaysForLongTerm} onChange={(e) => setF({ ...f, holdingDaysForLongTerm: e.target.value })} /></label>
          <label className="field">CGT institutions %<input className="input" type="number" step="0.5" value={+(f.cgtInstitution * 100).toFixed(2)} onChange={(e) => setF({ ...f, cgtInstitution: +e.target.value / 100 })} /></label>
          <label className="field">Dividend tax %<input className="input" type="number" step="0.5" value={+(f.dividendTax * 100).toFixed(2)} onChange={(e) => setF({ ...f, dividendTax: +e.target.value / 100 })} /></label>
          <label className="field">Verified on<input className="input" value={f.verifiedOn} onChange={(e) => setF({ ...f, verifiedOn: e.target.value })} /></label>
        </div>
        <ul className="tiny faint" style={{ paddingLeft: 18 }}>{s.data.defaults.notes.map((n: string) => <li key={n}>{n}</li>)}</ul>
        <div className="row"><button className="btn primary" onClick={save}>Save rates</button><button className="btn" onClick={async () => { await api("/settings/fees/reset", { body: {} }); s.reload(); }}>Reset to defaults</button></div>
        {msg && <Notice>{msg}</Notice>}
      </Card>
    </div>
  );
}

function SecurityTab() {
  const [pw, setPw] = useState({ current: "", next: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const sessions = useApi<any[]>("/auth/sessions");
  const backups = useApi<any>("/backups");
  const change = async () => { try { await api("/auth/password", { body: pw }); setMsg("Password changed. Other sessions were signed out."); setPw({ current: "", next: "" }); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } };
  return (
    <div className="grid g2">
      <Card title="Password">
        <div className="col">
          <label className="field">Current password<input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></label>
          <label className="field">New password (10+ characters)<input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></label>
          <button className="btn primary" onClick={change}>Change password</button>
          {msg && <Notice>{msg}</Notice>}
        </div>
        <div className="sep" />
        <div className="small" style={{ fontWeight: 600 }}>Active sessions</div>
        {sessions.data?.map((x, i) => <div key={i} className="tiny faint">{nptDate(x.created_at, true)} · {x.user_agent?.slice(0, 60)}</div>)}
      </Card>
      <Card title="Your data">
        <ul className="small" style={{ margin: "0 0 10px", paddingLeft: 18 }}>
          <li>Everything is stored locally in <code>data/saphal-stocks.db</code>. The server listens only on this computer (127.0.0.1).</li>
          <li>Financial profile, goals, net worth and journal entries are encrypted with AES-256-GCM using the key in your local <code>.env</code>. Keep a copy of that key with your backups.</li>
          <li>Passwords are hashed with scrypt; sessions use HTTP-only, same-site cookies.</li>
        </ul>
        <div className="row">
          <a className="btn" href="/api/account/export"><I.download /> Export my data (JSON)</a>
          <button className="btn" onClick={async () => { const r = await api<any>("/backup", { body: {} }); setMsg(`Backup written to ${r.file}`); backups.reload(); }}>Back up database</button>
        </div>
        {backups.data && <p className="tiny faint" style={{ marginTop: 8 }}>Automatic daily backups (last {backups.data.keepDays} kept) in <code>{backups.data.dir}</code>: {backups.data.files.slice(0, 8).join(", ") || "none yet"}. Copy this folder and your <code>.env</code> key somewhere safe (e.g. an external drive).</p>}
        <div className="sep" />
        <div className="small" style={{ fontWeight: 600 }} >Delete personal data</div>
        <p className="small muted">Deletes portfolios, watchlists, alerts, notifications, financial profile, goals, documents and AI conversations. Market data is kept. This cannot be undone.</p>
        <div className="row"><input className="input" placeholder="Type DELETE MY DATA" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} /><button className="btn danger" disabled={confirmText !== "DELETE MY DATA"} onClick={async () => { await api("/account/delete-personal-data", { body: { confirm: confirmText } }); setMsg("Personal data deleted."); setConfirmText(""); }}>Delete</button></div>
      </Card>
    </div>
  );
}

function QualityTab() {
  const q = useApi<any>("/data/quality");
  const [check, setCheck] = useState("");
  if (q.loading && !q.data) return <Loading label="Checking stored data" />;
  if (!q.data) return null;
  const d = q.data;
  const rows = d.findings.filter((f: any) => !check || f.check === check);
  return (
    <div className="col">
      <div className="grid g4">
        <Card title="Errors"><div className="mono down" style={{ fontSize: 22 }}>{d.counts.error}</div><div className="small muted">Impossible values</div></Card>
        <Card title="Warnings"><div className="mono warn" style={{ fontSize: 22 }}>{d.counts.warning}</div><div className="small muted">May distort analysis</div></Card>
        <Card title="Info"><div className="mono" style={{ fontSize: 22 }}>{d.counts.info}</div><div className="small muted">Gaps in coverage</div></Card>
        <Card title="Data dates"><div className="small">Prices {nptDate(d.latestPrices)}<br />NEPSE index {nptDate(d.latestIndex)}</div><div className="tiny faint">Checked {ago(d.checkedAt)}</div></Card>
      </div>
      <div className="pill-tabs">
        <button className="chip" style={!check ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined} onClick={() => setCheck("")}>All ({d.findings.length})</button>
        {Object.entries(d.summary).map(([k, n]) => <button key={k} className="chip" style={check === k ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined} onClick={() => setCheck(k)}>{k} ({n as number})</button>)}
      </div>
      <Card flush>
        <DataTable rows={rows} empty="No issues found" cols={[
          { key: "severity", label: "Severity", render: (f: any) => <Badge tone={f.severity === "error" ? "down" : f.severity === "warning" ? "warn" : ""}>{f.severity}</Badge> },
          { key: "check", label: "Check" },
          { key: "symbol", label: "Stock", render: (f: any) => f.symbol ? <a href={`/stocks/${f.symbol}`} className="sym">{f.symbol}</a> : "—" },
          { key: "date", label: "Date / period", render: (f: any) => <span className="small">{f.date ?? "—"}</span> },
          { key: "detail", label: "Detail", render: (f: any) => <span className="small muted">{f.detail}</span> },
        ]} />
      </Card>
      <p className="tiny faint">Checks: impossible OHLC values, stocks without trades for 30+ days, single-session moves beyond NEPSE's daily band after bonus and right adjustments, balance sheets that don't balance, statements 2+ quarters out of date, companies without statements, and prices vs index date mismatch.</p>
    </div>
  );
}
