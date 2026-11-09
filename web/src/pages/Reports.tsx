import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { Card, Loading, Empty, DataTable, Notice, Badge, Modal } from "../components/ui.tsx";
import { nptDate } from "../lib/format.ts";
import { I } from "../components/icons.tsx";

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

/** Latest audited / annual-report filing per company, with links to the company and its website. */
function AuditedList() {
  const r = useApi<any>("/reports/audited");
  const [q, setQ] = useState("");
  if (!r.data) return <Card title="Latest audited results (all companies)"><Loading /></Card>;
  const term = q.trim().toLowerCase();
  const rows = r.data.rows.filter((x: any) => !term || x.symbol.toLowerCase().includes(term) || (x.name ?? "").toLowerCase().includes(term) || (x.sector ?? "").toLowerCase().includes(term));
  return (
    <Card title="Latest audited results & annual reports" sub={`${r.data.rows.length} of ${r.data.total} companies have an audited/annual filing stored in the last 18 months`} actions={<input className="input" style={{ width: 200 }} placeholder="Search company or sector" value={q} onChange={(e) => setQ(e.target.value)} />}>
      <DataTable rows={rows} rowKey={(x: any) => x.symbol} maxHeight={420} initialSort={{ key: "published_date", dir: -1 }} cols={[
        { key: "symbol", label: "Company", render: (x: any) => <span><Link className="sym" to={`/stocks/${x.symbol}?tab=audit`}>{x.symbol}</Link> <span className="tiny faint">{x.sector}</span></span> },
        { key: "title", label: "Latest filing", render: (x: any) => <a className="small" href={x.url} target="_blank" rel="noopener noreferrer">{x.title}</a> },
        { key: "published_date", label: "Date", render: (x: any) => <span className="small">{nptDate(x.published_date)}</span> },
        { key: "web", label: "", render: (x: any) => r.data.websites[x.symbol] ? <a className="small" href={r.data.websites[x.symbol]} target="_blank" rel="noopener noreferrer">Website</a> : null },
      ]} />
      <p className="tiny faint" style={{ marginTop: 8 }}>{r.data.note} For any company, open its page → <strong>Reports & audit</strong> for its filings, auditor notices and website.</p>
    </Card>
  );
}
