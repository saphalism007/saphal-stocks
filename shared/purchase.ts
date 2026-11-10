// Purchase planner: a separate "pot" for each thing you want to buy (or a bundle, e.g. TV + PS5),
// with the monthly amount to set aside, where to keep it, progress, affordability and EMI vs saving. Pure; tested.

export interface PotItem { name: string; price: number }
export interface Pot {
  name: string; items: PotItem[]; kind: "need" | "want"; start: string; target: string; // YYYY-MM-DD
  deposits: { date: string; amount: number; note?: string }[]; withdrawals?: { date: string; amount: number; note?: string }[];
  where?: string; bought?: boolean; template?: string;
}
const monthsBetween = (a: string, b: string) => Math.max(0, (Date.parse(b) - Date.parse(a)) / (30.4375 * 86_400_000));
const r0 = (x: number) => Math.round(x);

/** Where to keep money you'll spend soon: safe, separate, and earning a little. */
export function parkWhere(months: number) {
  if (months <= 3) return { place: "A separate savings account", why: "You need it within 3 months: keep it instantly available but away from your spending account." };
  if (months <= 12) return { place: "A recurring deposit (RD) or a separate savings account", why: "Set an automatic monthly transfer on salary day. An RD earns more and is harder to break on impulse." };
  return { place: "A recurring deposit or short fixed deposits", why: "Over a year away: lock it in deposits that mature just before the purchase date. Never shares, prices can be down when you need the money." };
}

export function potStatus(p: Pot, today: string) {
  const total = p.items.reduce((s, i) => s + (i.price || 0), 0);
  const saved = p.deposits.reduce((s, d) => s + d.amount, 0) - (p.withdrawals ?? []).reduce((s, d) => s + d.amount, 0);
  const remaining = Math.max(0, total - saved);
  const left = monthsBetween(today, p.target), span = Math.max(0.5, monthsBetween(p.start, p.target));
  const monthsLeft = Math.max(0, Math.ceil(left));
  const monthly = remaining <= 0 ? 0 : r0(remaining / Math.max(1, monthsLeft));
  const expected = Math.min(total, total * Math.min(1, monthsBetween(p.start, today) / span));
  const pct = total ? Math.min(100, Math.round((saved / total) * 100)) : 0;
  const status = p.bought ? "bought" : saved >= total && total > 0 ? "ready" : today > p.target ? "overdue" : saved >= expected * 1.05 ? "ahead" : saved >= expected * 0.9 ? "on-track" : "behind";
  const last = [...p.deposits].sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? null;
  return { total, saved: r0(saved), remaining: r0(remaining), monthsLeft, monthly, pct, expectedByNow: r0(expected), status, lastDeposit: last, park: parkWhere(left) };
}

/** Can my budget carry this? Compares the monthly amount with what you save each month. */
export function affordability(monthlyNeeded: number, m: { income: number; cashFlow: number; emergencyGap: number } | null, kind: "need" | "want") {
  if (!m || m.income <= 0) return { level: "unknown" as const, text: "Fill in My Money (income and spending) to check whether this fits your budget." };
  const shareOfIncome = (monthlyNeeded / m.income) * 100, shareOfSurplus = m.cashFlow > 0 ? (monthlyNeeded / m.cashFlow) * 100 : Infinity;
  if (m.cashFlow <= 0) return { level: "no" as const, text: "You currently spend all your income. Free up money in the budget first; don't fund this with loans or your emergency fund." };
  const note = m.emergencyGap > 0 && kind === "want" ? " Your emergency fund isn't full yet, fill it first, or split new savings between both." : "";
  if (shareOfSurplus <= 50) return { level: "yes" as const, text: `Uses ${Math.round(shareOfSurplus)}% of what you save each month (${shareOfIncome.toFixed(1)}% of income). Comfortable.${note}` };
  if (shareOfSurplus <= 100) return { level: "tight" as const, text: `Uses ${Math.round(shareOfSurplus)}% of your monthly savings, little left for investing or surprises. Consider a later date or a cheaper option.${note}` };
  return { level: "no" as const, text: `Needs ${Math.round(shareOfSurplus)}% of what you save each month. Move the date later (to about ${Math.ceil(monthlyNeeded / (m.cashFlow * 0.5))}x as long) or lower the budget.${note}` };
}

/** Buy now on EMI, or save first and buy later? */
export function emiVsSave(price: number, emiRatePct: number, months: number, feeRs: number, saveRatePct: number) {
  const r = emiRatePct / 100 / 12;
  const emi = r === 0 ? price / months : (price * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
  const totalEmi = emi * months + feeRs;
  // Saving the same monthly amount in an RD: how many months until you can pay cash?
  const s = saveRatePct / 100 / 12; let bal = 0, m = 0;
  while (bal < price && m < 600) { bal = bal * (1 + s) + emi; m++; }
  return { emi: r0(emi), totalWithEmi: r0(totalEmi), extraCost: r0(totalEmi - price), monthsToSave: m, savedBy: r0(totalEmi - price + Math.max(0, bal - price)) };
}

export const POT_TEMPLATES: { key: string; name: string; kind: "need" | "want"; items: PotItem[]; months: number; tip: string }[] = [
  { key: "festival", name: "Dashain & Tihar", kind: "need", items: [{ name: "Clothes, gifts, food, travel home", price: 60000 }], months: 10, tip: "Festival spending is predictable: save a little every month instead of borrowing in Ashwin." },
  { key: "school", name: "Children's school fees", kind: "need", items: [{ name: "Admission and yearly fees", price: 120000 }], months: 12, tip: "School fees count towards the new 25% (up to Rs. 25,000) income-tax deduction." },
  { key: "insurance", name: "Insurance premiums", kind: "need", items: [{ name: "Life and health premiums", price: 40000 }], months: 12, tip: "Premiums are tax-deductible up to the limits; a yearly payment is usually cheaper than monthly." },
  { key: "gadget", name: "Phone / laptop / TV", kind: "want", items: [{ name: "Item", price: 150000 }], months: 6, tip: "Prices often drop at festival sales; compare three shops and check the warranty." },
  { key: "bike", name: "Motorbike or scooter", kind: "want", items: [{ name: "Bike", price: 350000 }, { name: "Registration, insurance, helmet", price: 40000 }], months: 18, tip: "Add registration, insurance and running costs, not just the showroom price." },
  { key: "travel", name: "Holiday / travel", kind: "want", items: [{ name: "Trip", price: 100000 }], months: 8, tip: "Book early; keep this pot separate from the emergency fund." },
  { key: "wedding", name: "Wedding", kind: "need", items: [{ name: "Wedding costs", price: 800000 }], months: 24, tip: "Big and fixed-date: start early and keep it in deposits that mature before the date." },
  { key: "vehicle-service", name: "Vehicle service & tax", kind: "need", items: [{ name: "Yearly vehicle tax, service, insurance", price: 30000 }], months: 12, tip: "A small monthly amount avoids a painful bill once a year." },
];
