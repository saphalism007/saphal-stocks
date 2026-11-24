// What to do next with each stock you hold (and each one you sold): one clear action, the price to exit at if wrong,
// where to take profit, whether and where to add more, and your break-even. Built only from the stored prices, the
// daily signal (shared/opportunities.ts, set on closing prices) and the company's fundamentals. Rule-based and
// educational: it never invents levels; when a level cannot be measured it says so.
import { sellCost, buyCost, cgtRate, DEFAULT_FEES, type FeeConfig } from "./costs.ts";
import type { Opportunity, FundamentalInput, LiveCheck } from "./opportunities.ts";

export type PlanAction = "ADD" | "HOLD" | "BOOK PROFIT" | "REDUCE" | "SELL" | "REVIEW";
export interface PlanLevel { price: number; basis: string }
export interface PlanTarget extends PlanLevel { netProfit: number; netPct: number }
export interface PositionPlan {
  symbol: string; name: string; sector: string;
  action: PlanAction; tone: "up" | "down" | "warn" | "blue";
  headline: string; steps: string[];
  quantity: number; wacc: number; costBasis: number; price: number | null; priceDate: string | null; live: boolean;
  pnl: number | null; pnlPct: number | null;
  breakeven: number | null; toBreakevenPct: number | null;
  stop: PlanLevel | null; targets: PlanTarget[];
  addZone: { low: number; high: number; basis: string; example: { qty: number; price: number; newWacc: number; newBreakeven: number } } | null;
  holdingDays: number | null; longTermInDays: number | null;
  signal: { action: string; headline: string; since: string | null; entryLow: number | null; entryHigh: number | null; stop: number | null; t1: number | null; asOf: string | null };
  atPurchase: { date: string; action: string; entryLow: number | null; entryHigh: number | null; stop: number | null; t1: number | null } | null;
  technical: string[]; fundamental: string[]; risks: string[];
  scores: { fundamental: number | null; technical: number | null };
  style: "trade" | "invest";
  follows: "original" | "portfolio";
  /** What you would get: selling everything today, if the stop is hit, at the first sell zone (all after charges and CGT). */
  scenarios: { label: string; price: number; receive: number; profit: number }[];
  /** Rs. you would give back from here if the stop is hit, and Rs. more you would make at the first sell zone. */
  riskReward: { risk: number; reward: number; ratio: number | null } | null;
  /** Dated things to wait for or act on. */
  timing: { date: string | null; label: string; detail: string }[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const f = (x: number) => `Rs. ${r2(x).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Sell price at which selling `qty` gives back exactly `cost` after all selling charges. */
export function breakevenPrice(qty: number, cost: number, cfg: FeeConfig = DEFAULT_FEES): number | null {
  if (qty <= 0 || cost <= 0) return null;
  let lo = (cost / qty) * 0.5, hi = (cost / qty) * 1.5 + 50;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (sellCost(qty, m, cfg).net < cost) lo = m; else hi = m; }
  return Math.ceil(hi * 100 - 1e-9) / 100; // rounded up, so selling at this price never leaves you short
}

export interface PlanInput {
  holding: { symbol: string; quantity: number; wacc: number; costBasis: number; lots: { date: string; qty: number; costPerShare: number }[] };
  name: string; sector: string;
  opp: (Opportunity & { signalSince?: string | null; live?: LiveCheck | null }) | null;
  price: number | null; priceDate: string | null; live: boolean;
  fa: FundamentalInput | null; technicalScore: number | null;
  atPurchase?: PositionPlan["atPurchase"];
  today: string; fees?: FeeConfig;
  /** "invest" (long-term, dividend, value, growth portfolios) uses long-term stops; "trade" uses the daily signal's. */
  style?: "trade" | "invest";
  dividend?: { fiscalYear: string; cashPct: number | null; bonusPct: number | null; bookCloseDate: string } | null;
  faceValue?: number | null;
  high52?: number | null;
  /** The recommendation this holding was bought on, and whether to follow it (default) or the portfolio's strategy. */
  anchor?: { label: string; date: string | null; entryLow: number | null; entryHigh: number | null; stop: number | null; t1: number | null; t2: number | null; holdDays: number | null } | null;
  follow?: "original" | "portfolio";
}

export function positionPlan(inp: PlanInput): PositionPlan {
  const cfg = inp.fees ?? DEFAULT_FEES;
  const h = inp.holding, o = inp.opp, fa = inp.fa;
  const p = inp.price ?? o?.price ?? null;
  const qty = h.quantity;
  const be = breakevenPrice(qty, h.costBasis, cfg);
  const firstLot = h.lots[0]?.date ?? null;
  const held = firstLot ? Math.max(0, days(firstLot, inp.today)) : null;
  const ltDays = held != null && held <= cfg.holdingDaysForLongTerm ? cfg.holdingDaysForLongTerm + 1 - held : null;
  const technical = [...(o?.techReasons ?? [])].slice(0, 5);
  const fundamental = [...(o?.fundReasons ?? [])].slice(0, 5);
  const risks: string[] = [...(o?.invalidation ?? [])].slice(0, 3);
  const base = {
    symbol: h.symbol, name: inp.name, sector: inp.sector, quantity: qty, wacc: r2(h.wacc), costBasis: r2(h.costBasis), price: p, priceDate: inp.priceDate ?? o?.priceDate ?? null, live: inp.live,
    breakeven: be, holdingDays: held, longTermInDays: ltDays,
    signal: { action: o?.action ?? "-", headline: o?.headline ?? "No signal: not enough price history.", since: o?.signalSince ?? null, entryLow: o?.entryLow ?? null, entryHigh: o?.entryHigh ?? null, stop: o?.stop ?? null, t1: o?.targets[0]?.price ?? null, asOf: o?.priceDate ?? null },
    atPurchase: inp.atPurchase ?? null, technical, fundamental, risks,
    scores: { fundamental: fa?.score ?? null, technical: inp.technicalScore },
    style: inp.style ?? "trade",
    follows: (inp.anchor?.stop != null && inp.follow !== "portfolio" ? "original" : "portfolio") as "original" | "portfolio",
  };
  if (p == null) {
    return { ...base, action: "REVIEW", tone: "warn", headline: "No recent price for this stock, so no plan can be made.", steps: ["Check the symbol, or whether the company was merged, renamed or suspended."], pnl: null, pnlPct: null, toBreakevenPct: null, stop: null, targets: [], addZone: null, scenarios: [], riskReward: null, timing: [] };
  }
  const value = qty * p;
  const pnl = r2(sellCost(qty, p, cfg).net - h.costBasis);
  const pnlPct = h.costBasis ? r2((pnl / h.costBasis) * 100) : null;
  const toBe = be != null ? r2(((be - p) / p) * 100) : null;
  const sup = (o?.supports ?? []).filter((x) => x < p * 0.995).sort((a, b) => b - a);
  const res = (o?.resistances ?? []).filter((x) => x > p * 1.005).sort((a, b) => a - b);
  const trend = o?.indicators.trend ?? null;
  const faScore = fa?.score ?? null;
  const goodBiz = faScore != null && faScore >= 50 && (fa?.redFlags.length ?? 0) < 2;
  const weakBiz = faScore != null && faScore < 40;
  const inProfit = pnl > 0;

  // Stop-loss: protect profit once well ahead (never below break-even then); otherwise the signal's stop or the
  // nearest support below the price.
  let stop: PlanLevel | null = null;
  const nearSup = sup[0] ?? null;
  const invest = inp.style === "invest";
  const s200 = o?.indicators.sma200 ?? null;
  if (invest) {
    // Long-term holding: judged on a weekly close below the 200-day average or the deepest support, not daily noise.
    const lt = s200 != null && s200 < p ? s200 * 0.97 : sup.length ? sup[sup.length - 1] * 0.98 : p * 0.85;
    const lock = be != null && p > be * 1.25 ? Math.max(be, lt) : lt;
    stop = { price: r2(lock), basis: lock === be ? "Break-even: well in profit, so this holding should not turn into a loss" : s200 != null && s200 < p ? "Long-term stop: a weekly close 3% below the 200-day average" : sup.length ? "Long-term stop: below the deepest support measured" : "Long-term stop: about 15% below the price (no support measured)" };
  } else if (be != null && p > be * 1.08) {
    const trail = Math.max(be, nearSup != null ? nearSup * 0.99 : be);
    stop = { price: r2(trail), basis: trail > be ? `Trailing stop just under support ${f(nearSup as number)}: locks in a profit` : "Break-even: from here this trade should not turn into a loss" };
  } else if (o?.stop != null && o.stop < p) stop = { price: r2(o.stop), basis: "The daily signal's stop / invalidation level" };
  else if (nearSup != null) stop = { price: r2(nearSup * 0.98), basis: `2% under the nearest support ${f(nearSup)}` };
  else stop = { price: r2(p * 0.9), basis: "About 10% below the price (no support level measured below)" };

  // Following the original recommendation: its stop holds, and can only be raised (to lock in profit), never lowered.
  const anc = inp.anchor ?? null;
  const original = base.follows === "original" && anc?.stop != null;
  if (original) {
    const o0 = anc!.stop as number, when = anc!.date ? ` of ${anc!.date}` : "";
    if (stop.price > o0 && be != null && p > be * 1.08) stop = { price: stop.price, basis: `${stop.basis} (raised from the original stop ${f(o0)})` };
    else stop = { price: r2(o0), basis: `Original stop from the ${anc!.label.toLowerCase()}${when}` };
  }
  const weekly = invest && !original;
  // Profit targets: break-even first when in loss, then the signal's targets and resistances above.
  const cands: PlanLevel[] = [];
  if (be != null && be > p * 1.005) cands.push({ price: be, basis: "Break-even: your money back after all charges" });
  // In a loss, levels below break-even would still lose money, so sell zones start at break-even.
  const floor = be != null && be > p ? be * 0.999 : p * 1.01;
  if (original) { if (anc!.t1 != null && anc!.t1 > floor) cands.push({ price: anc!.t1, basis: "Original target 1 from the recommendation" }); if (anc!.t2 != null && anc!.t2 > floor) cands.push({ price: anc!.t2, basis: "Original target 2 from the recommendation" }); }
  if (!original) {
    for (const t of o?.targets ?? []) if (t.price > floor) cands.push({ price: t.price, basis: t.basis });
    for (const r of res) if (r > floor) cands.push({ price: r, basis: "Resistance (sellers appeared here before)" });
  }
  if (!original && inp.high52 != null && inp.high52 > floor && !cands.some((c) => Math.abs(c.price - inp.high52!) / inp.high52! < 0.015)) cands.push({ price: inp.high52, basis: "52-week high (sellers often appear near it)" });
  const uniq: PlanLevel[] = [];
  for (const c of cands.sort((a, b) => a.price - b.price)) if (!uniq.length || c.price > uniq[uniq.length - 1].price * 1.015) uniq.push({ price: r2(c.price), basis: c.basis });
  const sellDate = inp.today;
  const targets: PlanTarget[] = uniq.slice(0, 3).map((t) => {
    const net = sellCost(qty, t.price, cfg).net, gain = net - h.costBasis;
    const tax = gain > 0 ? gain * cgtRate(held ?? 0, "individual", cfg, sellDate) : 0;
    return { ...t, netProfit: r2(gain - tax), netPct: h.costBasis ? r2(((gain - tax) / h.costBasis) * 100) : 0 };
  });

  // Where adding more makes sense: only for a sound business that is not in a downtrend.
  let addZone: PositionPlan["addZone"] = null;
  if (goodBiz && trend !== "downtrend" && o?.action !== "SELL" && o?.action !== "AVOID") {
    let low: number | null = null, high: number | null = null, basis = "";
    if (o?.entryLow != null && o.entryHigh != null && o.entryLow < p * 1.03) { low = o.entryLow; high = o.entryHigh; basis = `The signal's buy range (${o.setupType ?? "setup"})`; }
    else if (nearSup != null && nearSup > p * 0.85) { low = r2(nearSup * 0.99); high = r2(nearSup * 1.015); basis = `Around support ${f(nearSup)}`; }
    if (low != null && high != null) {
      const ap = r2((low + high) / 2), add = Math.max(10, Math.round(qty / 2));
      const cost = buyCost(add, ap, cfg).net, newQty = qty + add, newCost = h.costBasis + cost;
      addZone = { low: r2(low), high: r2(high), basis, example: { qty: add, price: ap, newWacc: r2(newCost / newQty), newBreakeven: breakevenPrice(newQty, newCost, cfg) ?? 0 } };
    }
  }

  // One action.
  let action: PlanAction = "HOLD", tone: PositionPlan["tone"] = "blue", headline = "";
  const t1 = targets.find((t) => t.basis !== "Break-even: your money back after all charges") ?? null;
  // Booking profit is suggested only for a meaningful gain (8% or more) right at a resistance.
  const nearT1 = t1 != null && p >= t1.price * 0.985 && (pnlPct ?? 0) >= 8;
  if (original && p <= stop.price) { action = "SELL"; tone = "down"; headline = `The original stop ${f(stop.price)} has been hit: exit as planned.`; }
  else if (o?.action === "SELL") { action = "SELL"; tone = "down"; headline = `Sell or reduce: ${o.headline.replace(/^.*?: /, "")}`; }
  else if (!original && (o?.live?.status === "stop-hit" || (o?.stop != null && p < o.stop && (o.action === "BUY" || o.action === "WATCH")))) { action = "REVIEW"; tone = "warn"; headline = "The setup has failed: price is below the signal's stop."; }
  else if (o?.action === "AVOID" || (trend === "downtrend" && weakBiz)) { action = "REDUCE"; tone = "down"; headline = `Reduce on strength: ${trend === "downtrend" ? "downtrend" : "high risk"}${weakBiz ? " with weak fundamentals" : ""}.`; }
  else if (inProfit && nearT1) { action = "BOOK PROFIT"; tone = "up"; headline = `Near resistance ${f(t1!.price)}: book part of the profit.`; }
  else if (addZone && p <= addZone.high * 1.01 && p >= addZone.low * 0.98 && (o?.action === "BUY" || o?.action === "HOLD" || trend === "uptrend")) { action = "ADD"; tone = "up"; headline = `Good business at a buy level: you can add between ${f(addZone.low)} and ${f(addZone.high)}.`; }
  else if (t1 != null && p >= t1.price * 0.985) { action = "HOLD"; tone = "blue"; headline = `Hold: price is at resistance ${f(t1.price)}. Let it break above on volume, or book part if it turns down from here.`; }
  else { action = "HOLD"; tone = "blue"; headline = trend === "uptrend" ? "Hold: the uptrend is intact." : trend === "downtrend" ? "Hold with care: the trend is down; respect the stop." : "Hold: no clear move yet."; }

  // Plain next steps, in order.
  const steps: string[] = [];
  if (action === "SELL") steps.push(`Sell all or most of your ${qty} kitta${t1 ? `; if you keep some, exit the rest below ${f(stop.price)}` : ""}.`);
  if (action === "REVIEW") steps.push(`Decide today: either exit, or keep only if you hold for the business (fundamental score ${faScore ?? "-"}/100).`);
  if (action === "REDUCE") steps.push(`Sell part on any bounce${targets[0] ? ` toward ${f(targets[0].price)}` : ""}; do not add more.`);
  if (action === "BOOK PROFIT" && t1) steps.push(`Sell about one third (${Math.max(1, Math.round(qty / 3))} kitta) near ${f(t1.price)} (net about ${f(t1.netProfit * (1 / 3))} on that part); hold the rest.`);
  if (action === "ADD" && addZone) steps.push(`Add only between ${f(addZone.low)} and ${f(addZone.high)}. Example: ${addZone.example.qty} more at ${f(addZone.example.price)} makes your WACC ${f(addZone.example.newWacc)} and break-even ${f(addZone.example.newBreakeven)}.`);
  steps.push(`Exit if a ${weekly ? "week" : "day"} closes below ${f(stop.price)} (${stop.basis.charAt(0).toLowerCase()}${stop.basis.slice(1)}).`);
  if (targets.length) steps.push(`Sell zones: ${targets.map((t) => `${f(t.price)} (${t.netProfit >= 0 ? "+" : ""}${f(t.netProfit).replace("Rs. -", "-Rs. ")} net)`).join(", ")}.`);
  if (original && anc!.t1 != null) { const mid = res.find((r) => r > p * 1.01 && r < anc!.t1! * 0.99); if (mid != null) steps.push(`On the way to target 1, sellers appeared near ${f(mid)} before (resistance). If the price stalls there, booking a part is reasonable.`); }
  const wall = be != null && be > p ? res.find((r) => r < be) : undefined;
  if (wall != null) steps.push(`Expect selling pressure near ${f(wall)} on the way back to break-even.`);
  if (!inProfit && be != null) steps.push(`You are ${f(Math.abs(pnl))} down; break-even is ${f(be)} (${toBe != null ? `${toBe > 0 ? "+" : ""}${toBe}% from here` : ""}). Do not average down unless the price holds a support and the business is sound.`);
  if (action === "HOLD" && addZone && !steps.some((s) => s.startsWith("Add"))) steps.push(`To accumulate, wait for ${f(addZone.low)}-${f(addZone.high)} (${addZone.basis.charAt(0).toLowerCase()}${addZone.basis.slice(1)}).`);
  if (ltDays != null && ltDays <= 90) steps.push(`In ${ltDays} days this holding becomes long term: capital gains tax drops to ${r2(cgtRate(400, "individual", cfg, sellDate) * 100)}% from ${r2(cgtRate(0, "individual", cfg, sellDate) * 100)}%. If you plan to sell a profit, waiting may save tax.`);
  if (weakBiz) risks.unshift(`Weak fundamentals (score ${faScore}/100).`);
  if (trend === "downtrend") risks.unshift("Price is in a downtrend.");
  void value;
  // What-if outcomes, after selling charges and capital gains tax.
  const outcome = (price: number) => { const net = sellCost(qty, price, cfg).net, gain = net - h.costBasis, tax = gain > 0 ? gain * cgtRate(held ?? 0, "individual", cfg, sellDate) : 0; return { receive: r2(net - tax), profit: r2(gain - tax) }; };
  const now = outcome(p);
  const scenarios = [{ label: "Sell everything today", price: p, ...now }, { label: "If the stop is hit", price: stop.price, ...outcome(stop.price) }, ...(t1 ? [{ label: "At the first sell zone", price: t1.price, ...outcome(t1.price) }] : [])];
  const riskReward = t1 ? { risk: r2(Math.max(0, now.profit - outcome(stop.price).profit)), reward: r2(Math.max(0, t1.netProfit - now.profit)), ratio: null as number | null } : null;
  if (riskReward && riskReward.risk > 0) riskReward.ratio = r2(riskReward.reward / riskReward.risk);
  if (!weekly && riskReward && riskReward.ratio != null && riskReward.ratio < 1 && (action === "HOLD" || action === "ADD")) steps.push(`From here you risk ${f(riskReward.risk)} to make ${f(riskReward.reward)} more (1 : ${riskReward.ratio}). The odds no longer favour holding all of it; consider booking part.`);
  // Dates to wait for.
  const timing: PositionPlan["timing"] = [];
  const dv = inp.dividend;
  if (dv && dv.bookCloseDate >= inp.today) {
    const fv = inp.faceValue && inp.faceValue > 0 ? inp.faceValue : 100;
    const cash = dv.cashPct ? (dv.cashPct / 100) * fv * qty : 0, bonus = dv.bonusPct ? Math.floor((dv.bonusPct / 100) * qty) : 0;
    timing.push({ date: dv.bookCloseDate, label: "Book closure", detail: `Hold until the book closure to receive ${[cash ? `about ${f(cash)} cash dividend (before 5% tax)` : "", bonus ? `${bonus} bonus shares` : ""].filter(Boolean).join(" and ")} for ${dv.fiscalYear}. The price is adjusted down after it, so do not buy only for the dividend.${action === "SELL" || action === "REDUCE" ? " The plan says sell or reduce: if the stop is hit first, the stop matters more than the dividend." : ""}` });
  }
  if (firstLot && ltDays != null) {
    const d = new Date(Date.parse(firstLot) + (cfg.holdingDaysForLongTerm + 1) * 86_400_000).toISOString().slice(0, 10);
    timing.push({ date: d, label: "Long-term tax", detail: `From this date your first lot is held over a year: CGT on a profit drops to ${r2(cgtRate(400, "individual", cfg, sellDate) * 100)}% from ${r2(cgtRate(0, "individual", cfg, sellDate) * 100)}%.${inProfit && action !== "SELL" ? ` On today's profit that saves about ${f(Math.max(0, (sellCost(qty, p, cfg).net - h.costBasis) * (cgtRate(0, "individual", cfg, sellDate) - cgtRate(400, "individual", cfg, sellDate))))}; worth waiting for unless the stop is hit.` : ""}` });
  }
  if (original && anc!.holdDays && firstLot) {
    // Count NEPSE trading days (Sunday to Thursday) from the purchase.
    let d = new Date(Date.parse(firstLot)), n = 0;
    while (n < anc!.holdDays) { d = new Date(d.getTime() + 86_400_000); const wd = d.getUTCDay(); if (wd !== 5 && wd !== 6) n++; }
    const by = d.toISOString().slice(0, 10);
    timing.push({ date: by, label: "Sell by", detail: `This was a ${anc!.holdDays}-session trade: if neither target is reached, sell around this date (time stop), as planned when you bought.` });
  }
  if (!weekly && !original && o?.reviewBy && o.reviewBy >= inp.today) timing.push({ date: o.reviewBy, label: "Review", detail: "The current setup should have moved toward its target by now. If not, the plan is re-checked (time stop)." });
  if (o?.waitFor && (action === "HOLD")) timing.push({ date: null, label: "Wait for", detail: `Before adding more: ${o.waitFor}.` });
  timing.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
  return { ...base, action, tone, headline, steps, pnl, pnlPct, toBreakevenPct: toBe, stop, targets, addZone, scenarios, riskReward, timing };
}

export interface ReentryPlan { symbol: string; name: string; soldDate: string | null; soldPrice: number | null; price: number | null; changeSinceSalePct: number | null; action: string; headline: string; zone: { low: number; high: number } | null; stop: number | null; t1: number | null }
/** For stocks you sold: whether and where buying back makes sense now. */
export function reentryPlan(symbol: string, name: string, lastSell: { date: string; price: number } | null, o: Opportunity | null, price: number | null): ReentryPlan {
  const ch = lastSell && price != null ? r2(((price - lastSell.price) / lastSell.price) * 100) : null;
  let headline: string;
  if (!o) headline = "No signal: not enough price history.";
  else if (o.action === "BUY") headline = `Buy-back signal: ${o.setupType ?? "setup"} with entry ${f(o.entryLow ?? 0)}-${f(o.entryHigh ?? 0)}, stop ${f(o.stop ?? 0)}.`;
  else if (o.action === "WATCH" && o.entryLow != null) headline = `Watch: a buy-back could come in ${f(o.entryLow)}-${f(o.entryHigh ?? o.entryLow)}. ${o.waitFor ? `Wait for ${o.waitFor}.` : ""}`;
  else if (o.action === "SELL" || o.action === "AVOID") headline = "Stay out: the signal is still negative. Selling was right for now.";
  else if (o.action === "HOLD") headline = "No buy-back entry now: the uptrend continues without a fresh setup. Wait for a pullback to support or a new BUY signal.";
  else if (o.action === "WATCH") headline = `No buy-back yet. ${o.waitFor ? `Wait for ${o.waitFor}.` : "Wait for a clear setup."}`;
  else headline = o.headline;
  if (ch != null && lastSell) headline += ` You sold at ${f(lastSell.price)}; the price is ${ch >= 0 ? "up" : "down"} ${Math.abs(ch)}% since.`;
  return { symbol, name, soldDate: lastSell?.date ?? null, soldPrice: lastSell?.price ?? null, price, changeSinceSalePct: ch, action: o?.action ?? "-", headline, zone: o?.entryLow != null && o.entryHigh != null ? { low: o.entryLow, high: o.entryHigh } : null, stop: o?.stop ?? null, t1: o?.targets[0]?.price ?? null };
}
