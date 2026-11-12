import { describe, expect, it } from "vitest";
import { zoomRange } from "../web/src/terminal/zoom.ts";

describe("chart zoom", () => {
  it("keeps the candle under the pointer in place", () => {
    const r = { from: 100, to: 200 }, frac = 0.3, anchor = 100 + 0.3 * 100;
    const z = zoomRange(r, 0.5, frac, 1000);
    expect(z.to - z.from).toBeCloseTo(50);
    expect(z.from + frac * (z.to - z.from)).toBeCloseTo(anchor);
  });
  it("allows room for the future but always keeps the latest candle on screen", () => {
    const z = zoomRange({ from: 910, to: 1010 }, 0.5, 0.98, 1000); // pointer at 1008, beyond the latest candle (999)
    expect(z.from + 0.98 * (z.to - z.from)).toBeCloseTo(1008); expect(z.to).toBeGreaterThan(1005); expect(z.from).toBeLessThanOrEqual(998);
    const far = zoomRange({ from: 990, to: 1040 }, 1, 1, 1000); // a view far in the future is pulled back
    expect(far.from).toBeLessThanOrEqual(998);
  });
  it("never shows blank space before the first candle", () => { expect(zoomRange({ from: 0, to: 100 }, 1.5, 0, 1000).from).toBeGreaterThanOrEqual(-4); });
  it("stops at 6 candles zoomed in and at all history zoomed out", () => {
    expect(zoomRange({ from: 0, to: 10 }, 0.1, 0.5, 1000).to - zoomRange({ from: 0, to: 10 }, 0.1, 0.5, 1000).from).toBe(6);
    const out = zoomRange({ from: 0, to: 900 }, 5, 0.5, 1000); expect(out.to - out.from).toBe(1300); expect(out.from).toBeLessThanOrEqual(-4);
  });
});
