// PDF document store with page-level text and BM25-style search (MiniSearch),
// so AI answers can cite document title, period and page number.
import MiniSearch from "minisearch";
import { extractText, getDocumentProxy } from "unpdf";
import { all, run, tx, db, nowIso } from "../db.ts";

export async function ingestPdf(userId: number, buf: Uint8Array, meta: { title: string; symbol?: string | null; kind?: string | null; period?: string | null; filename: string; sourceUrl?: string | null }) {
  const pdf = await getDocumentProxy(buf);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (text as string[]).map((t) => t.replace(/\s+\n/g, "\n").trim());
  const nonEmpty = pages.filter((p) => p.length > 30).length;
  const id = tx(() => {
    const r = run("INSERT INTO documents (user_id, symbol, title, kind, period, filename, pages, source_url, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      userId, meta.symbol?.toUpperCase() || null, meta.title, meta.kind || null, meta.period || null, meta.filename, pages.length, meta.sourceUrl || null, nowIso());
    const docId = Number(r.lastInsertRowid);
    const ins = db.prepare("INSERT INTO doc_pages (doc_id, page, text) VALUES (?, ?, ?)");
    pages.forEach((t, i) => ins.run(docId, i + 1, t));
    return docId;
  });
  index = null;
  return { id, pages: pages.length, pagesWithText: nonEmpty, scanned: nonEmpty < pages.length * 0.3 };
}

let index: { ms: MiniSearch; built: number } | null = null;

function getIndex() {
  if (index) return index.ms;
  const ms = new MiniSearch({ fields: ["text", "title"], storeFields: ["docId", "page", "title", "symbol", "period", "userId"], searchOptions: { boost: { title: 2 }, fuzzy: 0.15, prefix: true } });
  const rows = all<{ doc_id: number; page: number; text: string; title: string; symbol: string | null; period: string | null; user_id: number }>(
    "SELECT p.doc_id, p.page, p.text, d.title, d.symbol, d.period, d.user_id FROM doc_pages p JOIN documents d ON d.id = p.doc_id",
  );
  ms.addAll(rows.map((r) => ({ id: `${r.doc_id}:${r.page}`, docId: r.doc_id, page: r.page, text: r.text, title: r.title, symbol: r.symbol, period: r.period, userId: r.user_id })));
  index = { ms, built: Date.now() };
  return ms;
}

export function invalidateDocIndex() { index = null; }

export function searchDocuments(userId: number, query: string, symbol?: string, limit = 6) {
  const ms = getIndex();
  const hits = ms.search(query, { filter: (r) => r.userId === userId && (!symbol || r.symbol === symbol.toUpperCase()) }).slice(0, limit);
  if (!hits.length) return { results: [], note: "No matching passages in uploaded documents. Upload reports under Reports > Documents." };
  const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  return {
    results: hits.map((h) => {
      const text = (db.prepare("SELECT text FROM doc_pages WHERE doc_id = ? AND page = ?").get(h.docId, h.page) as { text: string }).text;
      const lower = text.toLowerCase();
      const found = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0);
      const pos = Math.max(0, (found.length ? Math.min(...found) : 0) - 300);
      return { document: h.title, symbol: h.symbol, period: h.period, page: h.page, docId: h.docId, score: Math.round(h.score * 100) / 100, passage: text.slice(pos, pos + 1500) };
    }),
  };
}
