import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { Card, Loading, Empty, DataTable, Notice, Badge, Modal } from "../components/ui.tsx";
import { nptDate } from "../lib/format.ts";
import { I } from "../components/icons.tsx";
import { AuditViewer } from "../components/AuditViewer.tsx";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Reports() {
  const docs = useApi<any[]>("/documents");
  const [f, setF] = useState({ title: "", symbol: "", kind: "Quarterly report", period: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; warn?: boolean } | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any>(null);
  const [page, setPage] = useState<any>(null);
  const nav = useNavigate();
  const upload = async () => {
    if (!file) return;
    setBusy(true); setMsg(null);
    const fd = new FormData();
    fd.append("file", file); fd.append("title", f.title || file.name.replace(/\.pdf$/i, "")); fd.append("symbol", f.symbol); fd.append("kind", f.kind); fd.append("period", f.period);
    try { const r = await api<any>("/documents", { form: fd }); setMsg({ t: `Stored ${r.pages} pages (${r.pagesWithText} with text). ${r.note ?? ""}`, warn: !!r.note }); setFile(null); docs.reload(); } catch (e) { setMsg({ t: e instanceof Error ? e.message : String(e), warn: true }); } finally { setBusy(false); }
  };
  const search = async () => { if (!q.trim()) return; setResults(await api(`/documents/search?q=${encodeURIComponent(q)}`)); };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Reports & Audit</h1><p>Latest audited results and annual reports of NEPSE companies, and your own uploaded PDFs (indexed by page so the AI can answer with citations).</p></div></div>
      <AuditedList />
      <div className="grid g3">
        <Card title="Upload a PDF report">
          <div className="col">
            <input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <label className="field">Title<input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. NABIL Annual Report 2081/82" /></label>
            <div className="grid g2">
              <label className="field">Symbol<input className="input" value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })} /></label>
              <label className="field">Period<input className="input" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} placeholder="Q1 2083/84" /></label>
            </div>
            <label className="field">Type<select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{["Quarterly report", "Annual report", "Audited financial statements", "Auditor's report", "AGM notice", "Prospectus", "Other"].map((k) => <option key={k}>{k}</option>)}</select></label>
            <button className="btn primary" onClick={upload} disabled={!file || busy}>{busy ? <span className="spinner" /> : <I.upload />} Upload & index</button>
            {msg && <Notice tone={msg.warn ? "warn" : "info"}>{msg.t}</Notice>}
            <p className="tiny faint">Scanned (image-only) PDFs have no extractable text; OCR is not built in yet. Files stay on this computer.</p>
          </div>
        </Card>
        <Card title="Search inside documents" className="span2">
          <form className="row" onSubmit={(e) => { e.preventDefault(); void search(); }}><input className="input" style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. qualified opinion, NPL, related party, contingent liabilities" /><button className="btn">Search</button></form>
          {results && (results.results.length === 0 ? <Empty title="No matches">{results.note}</Empty> : (
            <div className="list" style={{ marginTop: 10 }}>{results.results.map((r: any) => (
              <div key={`${r.docId}:${r.page}`} className="list-item" style={{ padding: "10px 0" }}>
                <div style={{ flex: 1 }}>
                  <div className="row"><strong className="small">{r.document}</strong><Badge>p. {r.page}</Badge>{r.symbol && <Badge tone="blue">{r.symbol}</Badge>}{r.period && <span className="tiny faint">{r.period}</span>}</div>
                  <p className="small muted" style={{ margin: "4px 0 0" }}>{r.passage.slice(0, 420)}…</p>
                </div>
                <button className="btn sm" onClick={async () => setPage(await api(`/documents/${r.docId}/pages/${r.page}`))}>Open page</button>
              </div>
            ))}</div>
          ))}
        </Card>
      </div>
      <Card title={`Documents (${docs.data?.length ?? 0})`} flush>
        {docs.loading ? <Loading /> : (
          <DataTable rows={docs.data ?? []} empty="No documents uploaded yet" cols={[
            { key: "title", label: "Title" }, { key: "symbol", label: "Stock", render: (d: any) => d.symbol ? <Link to={`/stocks/${d.symbol}`} className="sym">{d.symbol}</Link> : "—" },
            { key: "kind", label: "Type" }, { key: "period", label: "Period", render: (d: any) => d.period || "—" }, { key: "pages", label: "Pages", num: true },
            { key: "uploaded_at", label: "Uploaded", render: (d: any) => nptDate(d.uploaded_at) },
            { key: "x", label: "", render: (d: any) => <span className="row" style={{ flexWrap: "nowrap" }}>
              <button className="btn sm" onClick={() => nav(`/analyst?q=${encodeURIComponent(`Using the uploaded document "${d.title}"${d.symbol ? ` for ${d.symbol}` : ""}: what are the key takeaways, is profitability improving, and is there anything concerning (e.g. in the auditor's report)? Cite pages.`)}`)}><I.ai /> Ask AI</button>
              <button className="btn ghost sm danger" onClick={async () => { if (confirm(`Delete "${d.title}"?`)) { await api(`/documents/${d.id}`, { method: "DELETE" }); docs.reload(); } }}><I.trash /></button></span> },
          ]} />
        )}
      </Card>
      {page && <Modal title={`${page.title} · page ${page.page}`} onClose={() => setPage(null)}><pre className="small" style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font)" }}>{page.text || "(no text on this page)"}</pre></Modal>}
    </div>
  );
}

/** Every company's latest audited financial statement: tap a company to see it. */
function AuditedList() {
  const r = useApi<any>("/reports/audited");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  if (!r.data) return <Card title="Audited financial statements"><Loading /></Card>;
  const term = q.trim().toLowerCase();
  const match = (x: any) => !term || x.symbol.toLowerCase().includes(term) || (x.name ?? "").toLowerCase().includes(term) || (x.sector ?? "").toLowerCase().includes(term);
  const rows = r.data.rows.filter(match);
  const missing = r.data.missing.filter(match);
  return (
    <Card title="Audited financial statements" sub={`${r.data.rows.length} of ${r.data.total} companies · tap a company to see its statement`} actions={<input className="input" style={{ width: 220 }} placeholder="Search company or sector" value={q} onChange={(e) => setQ(e.target.value)} />}>
      <div className="list">
        {rows.slice(0, term ? 400 : 60).map((x: any) => (
          <button key={x.symbol} className="entry-row" onClick={() => setOpen(x.symbol)}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="sym">{x.symbol}</span> <span className="small">{x.name}</span>
              <span className="tiny faint" style={{ display: "block" }}>{x.sector} · published {nptDate(x.published)}{x.n > 1 ? ` · ${x.n} years` : ""}</span>
            </span>
            <span className="badge">{x.fiscal_year ? `FY ${x.fiscal_year}` : "View"}</span>
          </button>
        ))}
      </div>
      {!term && rows.length > 60 && <p className="small muted" style={{ marginTop: 8 }}>Showing the 60 most recent. Search to find any company.</p>}
      {term && missing.length > 0 && <div style={{ marginTop: 12 }}><div className="small muted">No audited statement stored yet:</div>{missing.slice(0, 20).map((m: any) => <div key={m.symbol} className="small"><Link className="sym" to={`/stocks/${m.symbol}?tab=audit`}>{m.symbol}</Link> {m.name} {m.website && <a href={m.website} target="_blank" rel="noopener noreferrer">website</a>}</div>)}</div>}
      <p className="tiny faint" style={{ marginTop: 8 }}>{r.data.note}</p>
      {open && <Modal title={`${open} · audited financial statements`} onClose={() => setOpen(null)}><AuditViewer symbol={open} showCompanyLink /></Modal>}
    </Card>
  );
}
