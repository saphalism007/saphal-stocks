// Bonus-share price adjustment. NEPSE prices drop mechanically when a stock
// goes ex-bonus (price / (1 + bonus%)). Unadjusted, that gap looks like a crash
// and breaks indicators. We only apply an adjustment when the price history
// itself shows the expected gap near the book-close date (evidence-based).
import type { Bar } from "./types.ts";

export interface BonusEvent { bookCloseDate: string; bonusPct: number; fiscalYear?: string }
export interface AppliedAdjustment extends BonusEvent { exDate: string; factor: number; observedRatio: number }

export function adjustForBonus(bars: Bar[], events: BonusEvent[]): { bars: Bar[]; applied: AppliedAdjustment[]; skipped: (BonusEvent & { reason: string })[] } {
  const applied: AppliedAdjustment[] = [];
  const skipped: (BonusEvent & { reason: string })[] = [];
  const factors = new Array(bars.length).fill(1);
  for (const ev of events) {
    if (!(ev.bonusPct > 0)) continue;
    const expected = 1 / (1 + ev.bonusPct / 100);
    const t = Date.parse(ev.bookCloseDate);
    if (Number.isNaN(t)) { skipped.push({ ...ev, reason: "Invalid book-close date" }); continue; }
    // Look at sessions from 7 days before to 10 days after book close for the gap.
    let best = -1;
    let bestErr = Infinity;
    let bestRatio = 1;
    for (let i = 1; i < bars.length; i++) {
      const d = Date.parse(bars[i].date);
      if (d < t - 7 * 86_400_000 || d > t + 10 * 86_400_000) continue;
      const ratio = bars[i].open / bars[i - 1].close;
      const err = Math.abs(ratio - expected);
      if (err < bestErr) { bestErr = err; best = i; bestRatio = ratio; }
    }
    if (best < 0) { skipped.push({ ...ev, reason: "No price data around book close" }); continue; }
    // Require the observed gap to be much closer to the expected ratio than to "no gap".
    if (bestErr > Math.abs(1 - expected) * 0.5) { skipped.push({ ...ev, reason: `No matching price gap found (closest open/prev-close ratio ${bestRatio.toFixed(3)} vs expected ${expected.toFixed(3)})` }); continue; }
    for (let i = 0; i < best; i++) factors[i] *= expected;
    applied.push({ ...ev, exDate: bars[best].date, factor: expected, observedRatio: Math.round(bestRatio * 1000) / 1000 });
  }
  const out = bars.map((b, i) => {
    const f = factors[i];
    if (f === 1) return b;
    return { ...b, open: b.open * f, high: b.high * f, low: b.low * f, close: b.close * f, volume: b.volume / f };
  });
  return { bars: out, applied, skipped };
}

// ---------- Right shares ----------
// Ex-rights theoretical price: TERP = (P + r x S) / (1 + r), where r = new shares per
// existing share and S = issue price. Book closure comes a few weeks before the
// subscription opens, so we look for the matching gap in the 100 days before opening.
export interface RightEvent { ratio: string; issuePrice: number; openingDate: string }
export interface AppliedRight extends RightEvent { exDate: string; r: number; expectedRatio: number; observedRatio: number; factor: number }

export function parseRightRatio(ratio: string): number | null {
  const m = ratio.replace(/\s/g, "").match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const held = Number(m[1]), offered = Number(m[2]);
  return held > 0 && offered > 0 ? offered / held : null;
}

export function adjustForRights(bars: Bar[], events: RightEvent[]): { bars: Bar[]; applied: AppliedRight[]; skipped: (RightEvent & { reason: string })[] } {
  const applied: AppliedRight[] = [];
  const skipped: (RightEvent & { reason: string })[] = [];
  const factors = new Array(bars.length).fill(1);
  for (const ev of events) {
    const r = parseRightRatio(ev.ratio);
    const t = Date.parse(ev.openingDate);
    if (r == null || !(ev.issuePrice > 0) || Number.isNaN(t)) { skipped.push({ ...ev, reason: "Missing ratio, price or date" }); continue; }
    let best = -1, bestErr = Infinity, bestObs = 1, bestExp = 1;
    for (let i = 1; i < bars.length; i++) {
      const d = Date.parse(bars[i].date);
      if (d < t - 100 * 86_400_000 || d > t + 5 * 86_400_000) continue;
      const prev = bars[i - 1].close;
      const expected = (prev + r * ev.issuePrice) / (1 + r) / prev;
      if (expected >= 0.97) continue; // rights priced near market cause no visible gap
      const obs = bars[i].open / prev;
      const err = Math.abs(obs - expected);
      if (err < bestErr) { bestErr = err; best = i; bestObs = obs; bestExp = expected; }
    }
    if (best < 0) { skipped.push({ ...ev, reason: "No price data before subscription, or the issue price was close to market price" }); continue; }
    if (bestErr > Math.abs(1 - bestExp) * 0.5) { skipped.push({ ...ev, reason: `No matching ex-rights gap (closest ${bestObs.toFixed(3)} vs expected ${bestExp.toFixed(3)})` }); continue; }
    for (let i = 0; i < best; i++) factors[i] *= bestExp;
    applied.push({ ...ev, exDate: bars[best].date, r, expectedRatio: Math.round(bestExp * 1000) / 1000, observedRatio: Math.round(bestObs * 1000) / 1000, factor: bestExp });
  }
  const out = bars.map((b, i) => (factors[i] === 1 ? b : { ...b, open: b.open * factors[i], high: b.high * factors[i], low: b.low * factors[i], close: b.close * factors[i], volume: b.volume / factors[i] }));
  return { bars: out, applied, skipped };
}
