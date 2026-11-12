import { describe, expect, it } from "vitest";
import { INDICATORS, defaults } from "../shared/ta.ts";
import type { Bar } from "../shared/types.ts";

// 400 synthetic sessions with a trend, a cycle and noise (deterministic).
const bars: Bar[] = Array.from({ length: 400 }, (_, i) => {
  const base = 500 + i * 0.6 + 40 * Math.sin(i / 15) + 8 * Math.sin(i * 1.7);
  const open = base + 3 * Math.sin(i * 2.3), close = base + 3 * Math.cos(i * 1.9);
  return { date: new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), open, high: Math.max(open, close) + 4 + (i % 5), low: Math.min(open, close) - 4 - (i % 3), close, volume: 10_000 + 3000 * Math.sin(i / 7) + 500 * (i % 11), amount: close * (10_000 + 3000 * Math.sin(i / 7)) };
});

describe("100 indicators", () => {
  it("there are 100 with unique ids", () => {
    expect(INDICATORS.length).toBe(100);
    expect(new Set(INDICATORS.map((d) => d.id)).size).toBe(100);
  });
  it("every indicator computes finite values aligned to the bars", () => {
    for (const d of INDICATORS) {
      const out = d.compute(bars, defaults(d));
      for (const o of d.outputs) {
        const s = out[o.key];
        expect(s, `${d.id}.${o.key}`).toBeDefined();
        expect(s.length, d.id).toBe(bars.length);
        const vals = s.filter((x): x is number => x != null);
        expect(vals.length, `${d.id}.${o.key} has values`).toBeGreaterThan(0);
        expect(vals.every((x) => Number.isFinite(x)), `${d.id}.${o.key} finite`).toBe(true);
      }
    }
  });
  it("bounded oscillators stay in range", () => {
    const get = (id: string, k = "v") => { const d = INDICATORS.find((x) => x.id === id)!; return d.compute(bars, defaults(d))[k].filter((x): x is number => x != null); };
    for (const id of ["stc", "crsi", "imi", "psy", "rvi"]) { const v = get(id); expect(Math.min(...v), id).toBeGreaterThanOrEqual(0); expect(Math.max(...v), id).toBeLessThanOrEqual(100.0001); }
    const c = get("cmo"); expect(Math.min(...c)).toBeGreaterThanOrEqual(-100); expect(Math.max(...c)).toBeLessThanOrEqual(100);
    const l = get("lrsi"); expect(Math.min(...l)).toBeGreaterThanOrEqual(0); expect(Math.max(...l)).toBeLessThanOrEqual(1);
  });
});

import { GUIDE, interpret } from "../shared/indicatorGuide.ts";
describe("indicator guide", () => {
  it("has a guide and a plain reading for every indicator", () => {
    const bars = Array.from({ length: 300 }, (_, i) => { const c = 100 + 10 * Math.sin(i / 9) + i * 0.1; return { date: `d${i}`, open: c - 0.5, high: c + 1.5, low: c - 1.5, close: c, volume: 10_000 + 3000 * Math.sin(i / 7), amount: c * (10_000 + 3000 * Math.sin(i / 7)) }; });
    for (const d of INDICATORS) {
      expect(GUIDE[d.id], d.id).toBeTruthy();
      const p = Object.fromEntries(d.params.map((x) => [x.key, x.def]));
      const r = interpret(d, d.compute(bars as never, p), bars.at(-1)!.close);
      expect(r.text.length, d.id).toBeGreaterThan(10);
      expect(r.text, d.id).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
});
