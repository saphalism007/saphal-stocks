import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApi } from "../lib/api.ts";
import { Card, Loading, Badge, Empty, Notice } from "../components/ui.tsx";
import { nptDate } from "../lib/format.ts";
import { I } from "../components/icons.tsx";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function News() {
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const n = useApi<{ rows: any[]; categories: { category: string; n: number }[] }>(`/news?limit=200${cat ? `&category=${encodeURIComponent(cat)}` : ""}${query ? `&q=${encodeURIComponent(query)}` : ""}`, [cat, query]);
  const nav = useNavigate();
  const explain = (a: any) => nav(`/analyst?q=${encodeURIComponent(`Explain this ${a.symbol ? a.symbol + " " : ""}news/announcement for an investor: "${a.title}" (published ${a.published_date}, source ${a.source}). What happened? Why does it matter? Which sectors and listed companies might be affected, positively or negatively, short- vs long-term? What should I monitor next? Clearly separate confirmed facts from speculation.`)}`);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Financial News & Announcements</h1><p>Company disclosures and market news headlines from public sources, with dates and links. Use <strong>Explain</strong> for an AI impact analysis.</p></div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); setQuery(q); }}><input className="input" placeholder="Search headlines" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn"><I.search /></button></form>
      </div>
      <Notice>Headlines only are stored (not full articles). Open the link to read the original notice. Sources: ShareSansar company announcements and news; NEPSE, SEBON and NRB notices appear here when they are reported there. Official notices: <a href="https://www.nrb.org.np" target="_blank" rel="noopener noreferrer">NRB</a>, <a href="https://www.sebon.gov.np" target="_blank" rel="noopener noreferrer">SEBON</a>, <a href="https://www.nepalstock.com.np" target="_blank" rel="noopener noreferrer">NEPSE</a>.</Notice>
      <div className="pill-tabs">
        <button className="chip" style={!cat ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined} onClick={() => setCat("")}>All</button>
        {n.data?.categories.map((c) => <button key={c.category} className="chip" style={cat === c.category ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined} onClick={() => setCat(c.category)}>{c.category} <span className="faint">{c.n}</span></button>)}
      </div>
      <Card flush>
        {n.loading && !n.data ? <Loading /> : !n.data?.rows.length ? <Empty title="No items">Run a news refresh in Settings → Data.</Empty> : (
          <div className="list">{n.data.rows.map((a) => (
            <div key={a.id} className="list-item">
              <div style={{ flex: 1 }}>
                <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text)", fontWeight: 500 }}>{a.title}</a>
                <div className="row tiny faint" style={{ marginTop: 3 }}>
                  <span>{nptDate(a.published_date)}</span><Badge>{a.category}</Badge>
                  {a.symbol && <Link to={`/stocks/${a.symbol}`}><Badge tone="blue">{a.symbol}</Badge></Link>}{a.sector && <span>{a.sector}</span>}<span>{a.source}</span>
                </div>
              </div>
              <button className="btn sm" onClick={() => explain(a)}><I.ai /> Explain</button>
            </div>
          ))}</div>
        )}
      </Card>
    </div>
  );
}
