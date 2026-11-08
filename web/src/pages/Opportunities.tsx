import { Fragment } from "react";
import { useMemo, useState } from "react";
import { api, useApi } from "../lib/api.ts";
import { Card, Loading, Badge, Notice, Modal, Tabs, Empty } from "../components/ui.tsx";
import { I } from "../components/icons.tsx";
import { nptDate } from "../lib/format.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const RT: Record<string, { label: string; tone: "up" | "blue" | "warn" | "" }> = {
  contractual: { label: "Contractual rate", tone: "up" }, variable: { label: "Variable", tone: "warn" }, historical: { label: "Historical only", tone: "blue" }, projected: { label: "Projected", tone: "warn" }, unknown: { label: "Not an investment return", tone: "" },
};

export default function Opportunities() {
  const products = useApi<any[]>("/products");
  const resources = useApi<any[]>("/resources");
  const links = useApi<any>("/resources/link-status");
  const [tab, setTab] = useState<"products" | "directory">("products");
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const cats = useMemo(() => [...new Set((products.data ?? []).map((p) => p.category))], [products.data]);
  const status = (url: string) => links.data?.results?.find((r: any) => r.url === url);
  const shown = (products.data ?? []).filter((p) => (!cat || p.category === cat) && (!q || JSON.stringify(p).toLowerCase().includes(q.toLowerCase())));
  const check = async () => { setChecking(true); try { await api("/resources/check-links", { body: {} }); links.reload(); } finally { setChecking(false); } };
  const LinkStatus = ({ url }: { url: string }) => { const s = status(url); return s ? <span title={s.error || `HTTP ${s.status}`} className={`tiny ${s.ok ? "up" : "down"}`}>{s.ok ? "● reachable" : "● check failed"}</span> : null; };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Investment Opportunities in Nepal</h1><p>Shares, IPOs, mutual funds, government bonds, debentures, deposits, retirement schemes and insurance, with links to official sources.</p></div>
        <div className="row"><button className="btn" onClick={check} disabled={checking}>{checking ? <span className="spinner" /> : <I.refresh />} Check all links</button>{links.data && <span className="tiny faint">Last checked {nptDate(links.data.at, true)}</span>}</div>
      </div>
      <Notice tone="warn">Rates change. Contractual rates (FDs, bonds, debentures) are fixed only once you invest; variable and historical returns are not promises. This directory deliberately does not invent current rates: check the official source, then use <strong>Record rate</strong> to save the figure and the date you verified it.</Notice>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "products", label: `Investment products (${products.data?.length ?? 0})` }, { key: "directory", label: `Official resources (${resources.data?.length ?? 0})` }]} />
      {tab === "products" && (
        <>
          <div className="row">
            <input className="input" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
            <div className="pill-tabs"><button className="chip" style={!cat ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined} onClick={() => setCat("")}>All</button>{cats.map((c) => <button key={c} className="chip" style={cat === c ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined} onClick={() => setCat(c)}>{c}</button>)}</div>
            <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setEdit({ category: "Bank deposits", name: "", return_type: "contractual" })}><I.plus /> Add product</button>
          </div>
          {products.loading ? <Loading /> : (
            <div className="grid g2">
              {shown.map((p) => (
                <Card key={p.id} title={p.name} sub={`${p.category} · ${p.provider ?? ""}`} actions={<Badge tone={p.risk?.toLowerCase().includes("high") ? "down" : p.risk?.toLowerCase().includes("low") ? "up" : "warn"}>Risk: {p.risk}</Badge>}>
                  <p className="small">{p.description}</p>
                  <div className="row" style={{ margin: "6px 0" }}><Badge tone={RT[p.return_type]?.tone}>{RT[p.return_type]?.label ?? "Return"}</Badge><span className="small">{p.return_text}</span></div>
                  {p.verified_on && <div className="small up">Recorded by you: verified {p.verified_on} {p.source && p.source !== "Curated (Saphal Stocks seed); verify on the official site" ? `· ${p.source}` : ""}</div>}
                  <details className="small" style={{ marginTop: 6 }}>
                    <summary className="muted">Eligibility, minimum, lock-in, liquidity, tax, how to apply</summary>
                    <dl className="kv" style={{ marginTop: 8, gridTemplateColumns: "140px 1fr" }}>
                      {[["Eligibility", p.eligibility], ["Minimum", p.min_investment], ["Lock-in", p.lock_in], ["Duration", p.duration], ["Liquidity", p.liquidity], ["Tax", p.tax], ["Conditions", p.conditions], ["How to apply", p.how_to_apply]].map(([k, v]) => v ? <Fragment key={k}><dt>{k}</dt><dd style={{ textAlign: "left", fontFamily: "var(--font)" }}>{v}</dd></Fragment> : null)}
                    </dl>
                  </details>
                  <div className="row" style={{ marginTop: 8 }}>
                    {p.official_url && <a className="btn sm" href={p.official_url} target="_blank" rel="noopener noreferrer"><I.external /> Official site</a>}
                    {p.info_url && <a className="btn sm" href={p.info_url} target="_blank" rel="noopener noreferrer"><I.external /> Apply / info</a>}
                    {p.official_url && <LinkStatus url={p.official_url} />}
                    <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={() => setEdit(p)}>Record rate / edit</button>
                  </div>
                </Card>
              ))}
              {!shown.length && <Empty title="No matching products" />}
            </div>
          )}
        </>
      )}
      {tab === "directory" && (
        <div className="grid g2">
          {resources.data?.map((r) => (
            <Card key={r.id} title={r.name} sub={r.category}>
              <p className="small">{r.description}</p>
              <div className="row">
                <a className="btn sm" href={r.url} target="_blank" rel="noopener noreferrer"><I.external /> {new URL(r.url).host}</a><LinkStatus url={r.url} />
                {r.links.map((l: any) => <a key={l.url} className="btn sm" href={l.url} target="_blank" rel="noopener noreferrer"><I.external /> {l.label}</a>)}
              </div>
            </Card>
          ))}
        </div>
      )}
      {edit && <ProductModal p={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); products.reload(); }} />}
    </div>
  );
}

function ProductModal({ p, onClose, onDone }: { p: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ ...p, verified_on: p.verified_on ?? new Date().toISOString().slice(0, 10) });
  const [err, setErr] = useState<string | null>(null);
  const fields: [string, string, boolean?][] = [["name", "Name"], ["category", "Category"], ["provider", "Provider"], ["return_text", "Return / rate (as published)", true], ["min_investment", "Minimum investment"], ["lock_in", "Lock-in"], ["liquidity", "Liquidity"], ["tax", "Tax", true], ["official_url", "Official URL"], ["info_url", "Application / info URL"], ["source", "Where you verified it"], ["description", "Description", true]];
  const save = async () => {
    const body: Record<string, unknown> = {};
    for (const [k] of fields) body[k] = f[k] === "" ? null : f[k];
    body.return_type = f.return_type; body.verified_on = f.verified_on;
    try { if (p.id) await api(`/products/${p.id}`, { method: "PUT", body }); else await api("/products", { body }); onDone(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <Modal title={p.id ? `Edit: ${p.name}` : "Add product"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="col">
        <div className="grid g2">
          <label className="field">Return type<select className="input" value={f.return_type ?? "unknown"} onChange={(e) => setF({ ...f, return_type: e.target.value })}>{Object.entries(RT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
          <label className="field">Verified on<input className="input" type="date" value={f.verified_on} onChange={(e) => setF({ ...f, verified_on: e.target.value })} /></label>
        </div>
        {fields.map(([k, label, long]) => <label key={k} className="field">{label}{long ? <textarea className="input" value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} style={{ minHeight: 50 }} /> : <input className="input" value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</label>)}
        {err && <Notice tone="warn">{err}</Notice>}
      </div>
    </Modal>
  );
}
