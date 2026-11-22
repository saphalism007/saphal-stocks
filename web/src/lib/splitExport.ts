// Settlement sheet exports for Split Expenses: PDF, image (PNG), Excel, CSV and plain text.
// The PDF and image are drawn with the device's own fonts, so names in any script (Nepali too) come out right.
import { settle, summaryText, type SplitGroup, type SplitResult } from "../../../shared/split.ts";
import { xlsx, csv, pdfFromCanvases, deliver, type Cell } from "./fileOut.ts";
import { nptDate } from "./format.ts";

const W = 1240, PAGE_H = 1754, M = 80; // A4 at 150 dpi, 80 px margins
const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", "Noto Sans Devanagari", Roboto, Helvetica, Arial, sans-serif`;
const C = { text: "#0f172a", muted: "#64748b", line: "#e2e8f0", soft: "#f1f5f9", accent: "#047857", up: "#047857", down: "#be123c" };
const rs = (x: number) => `Rs. ${x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const stamp = () => new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10);
const fileBase = (g: SplitGroup) => `${(g.name || "Expenses").replace(/[^\p{L}\p{N} _-]+/gu, "").trim().replace(/\s+/g, "-") || "Expenses"}-settlement-${stamp()}`;

interface Block { h: number; draw: (c: CanvasRenderingContext2D, y: number) => void; keepWithNext?: boolean }

function wrap(c: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.split(/\s+/), lines: string[] = [];
  let cur = "";
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (c.measureText(t).width > width && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function blocks(g: SplitGroup, r: SplitResult): Block[] {
  const m = document.createElement("canvas").getContext("2d")!;
  const font = (px: number, bold = false) => `${bold ? "700" : "400"} ${px}px ${FONT}`;
  const out: Block[] = [];
  const name = (id: string) => g.people.find((p) => p.id === id)?.name ?? "?";
  const inner = W - 2 * M;
  // Header
  out.push({ h: 150, draw: (c, y) => {
    c.fillStyle = C.accent; c.font = font(22, true); c.fillText("EXPENSE SETTLEMENT", M, y + 30);
    c.fillStyle = C.text; c.font = font(46, true); c.fillText(g.name || "Expenses", M, y + 88);
    c.fillStyle = C.muted; c.font = font(22); c.fillText(`${g.people.length} people, ${g.expenses.length} expense${g.expenses.length === 1 ? "" : "s"}, prepared ${nptDate(stamp())}`, M, y + 128);
    c.textAlign = "right"; c.fillStyle = C.muted; c.font = font(20); c.fillText("TOTAL SPENT", W - M, y + 50);
    c.fillStyle = C.text; c.font = font(40, true); c.fillText(rs(r.total), W - M, y + 96); c.textAlign = "left";
  } });
  out.push({ h: 30, draw: (c, y) => { c.fillStyle = C.line; c.fillRect(M, y + 10, inner, 2); } });
  // Who pays whom
  const section = (t: string) => out.push({ h: 70, keepWithNext: true, draw: (c, y) => { c.fillStyle = C.text; c.font = font(30, true); c.fillText(t, M, y + 48); } });
  section("Who pays whom");
  if (!r.transfers.length) out.push({ h: 60, draw: (c, y) => { c.fillStyle = C.muted; c.font = font(24); c.fillText("Everyone is even. Nobody needs to pay.", M, y + 36); } });
  for (const t of r.transfers) out.push({ h: 78, draw: (c, y) => {
    c.fillStyle = C.soft; c.beginPath(); c.roundRect(M, y + 6, inner, 64, 12); c.fill();
    c.fillStyle = C.text; c.font = font(28, true); c.fillText(t.fromName, M + 24, y + 48);
    const w1 = c.measureText(t.fromName).width;
    c.fillStyle = C.muted; c.font = font(24); c.fillText("pays", M + 40 + w1, y + 48);
    const w2 = c.measureText("pays").width;
    c.fillStyle = C.text; c.font = font(28, true); c.fillText(t.toName, M + 56 + w1 + w2, y + 48);
    c.textAlign = "right"; c.fillStyle = C.accent; c.font = font(30, true); c.fillText(rs(t.amount), W - M - 24, y + 49); c.textAlign = "left";
  } });
  out.push({ h: 24, draw: () => undefined });
  // Table helper
  const table = (cols: { label: string; w: number; right?: boolean }[], rows: { cells: string[]; colors?: (string | undefined)[] }[], fontPx = 22) => {
    const x: number[] = []; let acc = M; for (const col of cols) { x.push(acc); acc += col.w * inner; }
    const lineH = fontPx * 1.35;
    out.push({ h: 50, keepWithNext: true, draw: (c, y) => {
      c.fillStyle = C.muted; c.font = font(fontPx - 2, true);
      cols.forEach((col, i) => { c.textAlign = col.right ? "right" : "left"; c.fillText(col.label.toUpperCase(), col.right ? x[i] + col.w * inner - 8 : x[i], y + 34); });
      c.textAlign = "left"; c.fillStyle = C.line; c.fillRect(M, y + 46, inner, 2);
    } });
    for (const row of rows) {
      m.font = font(fontPx);
      const wrapped = row.cells.map((t, i) => wrap(m, t, cols[i].w * inner - 16));
      const h = Math.max(...wrapped.map((l) => l.length)) * lineH + 22;
      out.push({ h, draw: (c, y) => {
        wrapped.forEach((lines, i) => { c.font = font(fontPx, i === 0); c.fillStyle = row.colors?.[i] ?? C.text; c.textAlign = cols[i].right ? "right" : "left"; lines.forEach((ln, k) => c.fillText(ln, cols[i].right ? x[i] + cols[i].w * inner - 8 : x[i], y + 14 + fontPx + k * lineH)); });
        c.textAlign = "left"; c.fillStyle = C.line; c.fillRect(M, y + h - 1, inner, 1);
      } });
    }
    out.push({ h: 30, draw: () => undefined });
  };
  section("Each person");
  table([{ label: "Person", w: 0.34 }, { label: "Paid", w: 0.2, right: true }, { label: "Share", w: 0.2, right: true }, { label: "Balance", w: 0.26, right: true }],
    r.people.map((p) => ({ cells: [p.name, rs(p.paid), rs(p.share), p.balance > 0 ? `gets ${rs(p.balance)}` : p.balance < 0 ? `owes ${rs(-p.balance)}` : "even"], colors: [undefined, undefined, undefined, p.balance > 0 ? C.up : p.balance < 0 ? C.down : C.muted] })));
  section("Expenses");
  table([{ label: "Expense", w: 0.27 }, { label: "Amount", w: 0.17, right: true }, { label: "Paid by", w: 0.22 }, { label: "Shared by", w: 0.34 }],
    g.expenses.map((e) => ({ cells: [
      `${e.title || "Expense"}${e.date ? ` (${nptDate(e.date)})` : ""}`, rs(e.amount),
      e.payers.map((x) => `${name(x.personId)}${e.payers.length > 1 ? ` ${rs(x.amount)}` : ""}`).join(", "),
      `${e.among.length === g.people.length ? `Everyone (${e.among.length})` : e.among.map(name).join(", ")}${e.mode === "shares" ? ", by shares" : e.mode === "exact" ? ", exact amounts" : ""}`,
    ] })), 20);
  out.push({ h: 70, draw: (c, y) => { c.fillStyle = C.muted; c.font = font(18); c.fillText("Shares are worked out in whole paisa; any leftover paisa go to the first people listed, so everything adds up exactly.", M, y + 30); c.fillText("Made with Saphal Stocks", M, y + 56); } });
  return out;
}

/** One tall image (paged = false) or A4 pages (paged = true). */
export function renderSheet(g: SplitGroup, r: SplitResult, paged: boolean): HTMLCanvasElement[] {
  const bl = blocks(g, r);
  const newCanvas = (h: number) => { const cv = document.createElement("canvas"); cv.width = W; cv.height = h; const c = cv.getContext("2d")!; c.fillStyle = "#ffffff"; c.fillRect(0, 0, W, h); c.textBaseline = "alphabetic"; return cv; };
  if (!paged) {
    const h = M + bl.reduce((t, b) => t + b.h, 0) + M / 2;
    const cv = newCanvas(h), c = cv.getContext("2d")!;
    let y = M; for (const b of bl) { b.draw(c, y); y += b.h; }
    return [cv];
  }
  const pages: HTMLCanvasElement[] = [];
  let cv = newCanvas(PAGE_H), c = cv.getContext("2d")!, y = M;
  for (let i = 0; i < bl.length; i++) {
    const b = bl[i], need = b.h + (b.keepWithNext && bl[i + 1] ? bl[i + 1].h : 0);
    if (y + need > PAGE_H - M && y > M) { pages.push(cv); cv = newCanvas(PAGE_H); c = cv.getContext("2d")!; y = M; }
    b.draw(c, y); y += b.h;
  }
  pages.push(cv);
  // Page numbers when there is more than one page.
  if (pages.length > 1) pages.forEach((p, i) => { const pc = p.getContext("2d")!; pc.fillStyle = C.muted; pc.font = `400 18px ${FONT}`; pc.textAlign = "right"; pc.fillText(`Page ${i + 1} of ${pages.length}`, W - M, PAGE_H - 40); });
  return pages;
}

export type ExportKind = "pdf" | "png" | "xlsx" | "csv" | "txt";
/** Makes the file. Hand it over with deliver() from a tap, so the share sheet is allowed on iPhone and iPad. */
export async function buildSettlementFile(g: SplitGroup, kind: ExportKind): Promise<File> {
  const r = settle(g);
  const base = fileBase(g);
  const name = (id: string) => g.people.find((p) => p.id === id)?.name ?? "?";
  let file: File;
  if (kind === "pdf") file = new File([await pdfFromCanvases(renderSheet(g, r, true))], `${base}.pdf`, { type: "application/pdf" });
  else if (kind === "png") { const cv = renderSheet(g, r, false)[0]; file = new File([await new Promise<Blob>((res) => cv.toBlob((b) => res(b as Blob), "image/png"))], `${base}.png`, { type: "image/png" }); }
  else if (kind === "xlsx") {
    const B = (v: string) => ({ v, bold: true }), $ = (v: number, bold = false) => ({ v: Math.round(v * 100) / 100, money: true, bold });
    const settleRows: Cell[][] = [[B(g.name || "Expenses")], [`Prepared ${nptDate(stamp())} (${stamp()})`], ["Total spent", $(r.total, true)], [], [B("Who pays"), B("To whom"), B("Amount (Rs.)")], ...r.transfers.map((t) => [t.fromName, t.toName, $(t.amount)])];
    if (!r.transfers.length) settleRows.push(["Everyone is even."]);
    const people: Cell[][] = [[B("Person"), B("Paid (Rs.)"), B("Share (Rs.)"), B("Balance (Rs.)"), B("Status")], ...r.people.map((p) => [p.name, $(p.paid), $(p.share), $(p.balance), p.balance > 0 ? "gets back" : p.balance < 0 ? "owes" : "even"]),
      [B("Total"), $(r.people.reduce((t, p) => t + p.paid, 0), true), $(r.people.reduce((t, p) => t + p.share, 0), true)]];
    const share = new Map(r.perExpense.map((x) => [x.id, x.shares]));
    const exp: Cell[][] = [[B("Date"), B("Expense"), B("Amount (Rs.)"), B("Paid by"), B("Split"), ...g.people.map((p) => B(`${p.name} share`))],
      ...g.expenses.map((e) => [e.date ?? "", e.title || "Expense", $(e.amount), e.payers.map((x) => `${name(x.personId)}${e.payers.length > 1 ? ` (${x.amount})` : ""}`).join(", "), e.mode === "equal" ? "equally" : e.mode === "shares" ? "by shares" : "exact amounts", ...g.people.map((p) => { const v = share.get(e.id)?.[p.id]; return v != null ? $(v) : null; })])];
    file = new File([xlsx([{ name: "Settlement", rows: settleRows, widths: [24, 24, 16] }, { name: "Each person", rows: people, widths: [22, 14, 14, 14, 12] }, { name: "Expenses", rows: exp, widths: [12, 28, 14, 26, 14, ...g.people.map(() => 14)] }])], `${base}.xlsx`, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  } else if (kind === "csv") {
    file = new File([csv([[g.name || "Expenses"], ["Total spent", r.total.toFixed(2)], [], ["Who pays", "To whom", "Amount (Rs.)"], ...r.transfers.map((t) => [t.fromName, t.toName, t.amount.toFixed(2)]), [], ["Person", "Paid", "Share", "Balance"], ...r.people.map((p) => [p.name, p.paid.toFixed(2), p.share.toFixed(2), p.balance.toFixed(2)]), [], ["Date", "Expense", "Amount", "Paid by", "Shared by"], ...g.expenses.map((e) => [e.date ?? "", e.title || "Expense", e.amount.toFixed(2), e.payers.map((x) => name(x.personId)).join(" + "), e.among.map(name).join(", ")])])], `${base}.csv`, { type: "text/csv" });
  } else file = new File([summaryText(g, r)], `${base}.txt`, { type: "text/plain" });
  return file;
}
export { deliver };
