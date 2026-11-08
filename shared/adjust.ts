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
