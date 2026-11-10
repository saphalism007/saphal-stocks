// Shows a company's audited financial statements (the official published statement images / PDFs).
// Tap an image to open it full size, where you can pinch to zoom.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../lib/api.ts";
import { Loading, Empty, ErrorBox, Seg } from "./ui.tsx";
import { I } from "./icons.tsx";
import { nptDate } from "../lib/format.ts";

interface Doc { url: string; fiscal_year: string | null; title: string; published: string; images: string[]; pdfs: string[] }
interface AuditData { symbol: string; name: string; sector: string | null; website: string | null; docs: Doc[]; source: string }

export function AuditViewer({ symbol, showCompanyLink = false }: { symbol: string; showCompanyLink?: boolean }) {
  const a = useApi<AuditData>(`/stocks/${symbol}/audit`, [symbol]);
  const [i, setI] = useState(0);
  if (a.error) return <ErrorBox error={a.error} onRetry={a.reload} />;
  if (!a.data) return <Loading label="Loading audited statements" />;
  const d = a.data;
  if (!d.docs.length) return (
    <Empty title="No audited statement stored for this company yet">
      Companies publish audited results before their AGM (usually October-January for the year ending mid-July). {d.website ? <><a href={d.website} target="_blank" rel="noopener noreferrer">Company website</a> has the full annual report.</> : null}
    </Empty>
  );
  const doc = d.docs[Math.min(i, d.docs.length - 1)];
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row between">
        <div>
          <strong>{doc.fiscal_year ? `FY ${doc.fiscal_year}` : "Audited statement"}</strong> <span className="small muted">published {nptDate(doc.published)}</span>
          {showCompanyLink && <div className="small"><Link to={`/stocks/${d.symbol}`}>{d.symbol}, {d.name}</Link></div>}
        </div>
        {d.docs.length > 1 && <Seg value={String(i)} onChange={(k) => setI(Number(k))} options={d.docs.slice(0, 4).map((x, k) => ({ key: String(k), label: x.fiscal_year ?? nptDate(x.published) }))} />}
      </div>
      <div className="small muted">{doc.title}</div>
      {doc.pdfs.map((p, k) => <a key={p} className="btn primary" href={p} target="_blank" rel="noopener noreferrer"><I.reports /> Open audit report PDF{doc.pdfs.length > 1 ? ` ${k + 1}` : ""}</a>)}
      {doc.images.map((src, k) => (
        <a key={src} href={src} target="_blank" rel="noopener noreferrer" className="audit-img" title="Open full size (pinch to zoom)">
          <img src={src} alt={`${d.symbol} audited financial statement ${doc.fiscal_year ?? ""} page ${k + 1}`} loading="lazy" />
        </a>
      ))}
      <div className="row small">
        <a href={doc.url} target="_blank" rel="noopener noreferrer"><I.external /> Original announcement</a>
        {d.website && <a href={d.website} target="_blank" rel="noopener noreferrer"><I.external /> Company website (full annual report)</a>}
      </div>
      <p className="tiny faint">Tap the statement to open it full size and pinch to zoom. Published by the company; source: ShareSansar.</p>
    </div>
  );
}
