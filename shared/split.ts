// Shared expenses: who paid what, who each payment is for, and the fewest transfers that settle everyone up.
// All sums are done in whole paisa, so shares always add up exactly to what was paid. When a bill does not divide
// evenly, the leftover paisa go one each to the first people in the split (in the order the people are listed).

export interface SplitPerson { id: string; name: string }
export interface SplitExpense {
  id: string; title: string; date?: string;
  amount: number; // Rs., the whole bill
  payers: { personId: string; amount: number }[]; // who paid, adding up to the bill
  mode: "equal" | "shares" | "exact";
  among: string[]; // person ids sharing this bill
  shares?: Record<string, number>; // mode "shares": weights (2 = twice as much); mode "exact": Rs. each
}
export interface SplitGroup { id: string; name: string; people: SplitPerson[]; expenses: SplitExpense[]; updatedAt?: string }

export interface PersonBalance { id: string; name: string; paid: number; share: number; balance: number } // balance > 0: gets money back
export interface Transfer { from: string; to: string; fromName: string; toName: string; amount: number }
export interface SplitResult { total: number; people: PersonBalance[]; transfers: Transfer[]; issues: string[]; perExpense: { id: string; shares: Record<string, number> }[] }

const P = (rs: number) => Math.round(rs * 100);
const R = (paisa: number) => paisa / 100;

/** Splits `total` paisa by weights with the largest-remainder rule (ties go to the earlier person). */
function byWeights(total: number, ids: string[], w: (id: string) => number): Record<string, number> {
  const sum = ids.reduce((t, id) => t + Math.max(0, w(id)), 0);
  const out: Record<string, number> = {};
  if (!ids.length || sum <= 0) return out;
  const raw = ids.map((id, i) => ({ id, i, exact: (total * Math.max(0, w(id))) / sum }));
  let given = 0;
  for (const r of raw) { out[r.id] = Math.floor(r.exact + 1e-9); given += out[r.id]; }
  const left = total - given;
  [...raw].sort((a, b) => (b.exact - Math.floor(b.exact + 1e-9)) - (a.exact - Math.floor(a.exact + 1e-9)) || a.i - b.i).slice(0, left).forEach((r) => { out[r.id] += 1; });
  return out;
}

export function settle(g: SplitGroup): SplitResult {
  const issues: string[] = [];
  const order = g.people.map((p) => p.id);
  const name = (id: string) => g.people.find((p) => p.id === id)?.name ?? "?";
  const paid: Record<string, number> = {}, owed: Record<string, number> = {};
  for (const id of order) { paid[id] = 0; owed[id] = 0; }
  let total = 0;
  const perExpense: SplitResult["perExpense"] = [];
  for (const e of g.expenses) {
    const A = P(e.amount);
    if (!(A > 0)) { issues.push(`"${e.title || "Untitled"}" has no amount.`); continue; }
    const among = order.filter((id) => e.among.includes(id));
    if (!among.length) { issues.push(`"${e.title || "Untitled"}" is not shared with anyone.`); continue; }
    // Payers: one payer pays the whole bill; several payers must add up to it.
    const payers = e.payers.filter((x) => order.includes(x.personId));
    if (!payers.length) { issues.push(`"${e.title || "Untitled"}" has no payer.`); continue; }
    if (payers.length === 1) paid[payers[0].personId] += A;
    else {
      const ps = payers.reduce((t, x) => t + P(x.amount), 0);
      if (ps !== A) issues.push(`"${e.title || "Untitled"}": the payers add up to Rs. ${R(ps).toFixed(2)}, not the bill Rs. ${R(A).toFixed(2)}.`);
      for (const x of payers) paid[x.personId] += P(x.amount);
    }
    let shares: Record<string, number>;
    if (e.mode === "exact") {
      shares = Object.fromEntries(among.map((id) => [id, P(e.shares?.[id] ?? 0)]));
      const s = Object.values(shares).reduce((t, x) => t + x, 0);
      if (s !== A) issues.push(`"${e.title || "Untitled"}": the exact amounts add up to Rs. ${R(s).toFixed(2)}, not Rs. ${R(A).toFixed(2)}.`);
    } else shares = byWeights(A, among, (id) => (e.mode === "shares" ? e.shares?.[id] ?? 1 : 1));
    for (const [id, v] of Object.entries(shares)) owed[id] += v;
    perExpense.push({ id: e.id, shares: Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, R(v)])) });
    total += A;
  }
  const people: PersonBalance[] = order.map((id) => ({ id, name: name(id), paid: R(paid[id]), share: R(owed[id]), balance: R(paid[id] - owed[id]) }));
  // Fewest transfers (greedy): the person owing most pays the person owed most, until everyone is even.
  const cred = order.map((id) => ({ id, v: paid[id] - owed[id] })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v || order.indexOf(a.id) - order.indexOf(b.id));
  const debt = order.map((id) => ({ id, v: owed[id] - paid[id] })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v || order.indexOf(a.id) - order.indexOf(b.id));
  const transfers: Transfer[] = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const m = Math.min(debt[i].v, cred[j].v);
    if (m > 0) transfers.push({ from: debt[i].id, to: cred[j].id, fromName: name(debt[i].id), toName: name(cred[j].id), amount: R(m) });
    debt[i].v -= m; cred[j].v -= m;
    if (debt[i].v === 0) i++;
    if (cred[j].v === 0) j++;
  }
  return { total: R(total), people, transfers, issues, perExpense };
}

/** Plain-text summary to share in a chat. */
export function summaryText(g: SplitGroup, r: SplitResult): string {
  const rs = (x: number) => `Rs. ${x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const lines = [`${g.name}: total ${rs(r.total)}`, ""];
  for (const e of g.expenses) lines.push(`- ${e.title || "Expense"}: ${rs(e.amount)} paid by ${e.payers.map((x) => g.people.find((p) => p.id === x.personId)?.name ?? "?").join(" + ")}, shared by ${e.among.length === g.people.length ? "all" : e.among.map((id) => g.people.find((p) => p.id === id)?.name ?? "?").join(", ")}`);
  lines.push("", "Settle up:");
  if (!r.transfers.length) lines.push("Everyone is even.");
  for (const t of r.transfers) lines.push(`${t.fromName} pays ${t.toName} ${rs(t.amount)}`);
  return lines.join("\n");
}
