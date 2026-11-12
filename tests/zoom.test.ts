import { describe, expect, it } from "vitest";
import { zoomRange } from "../web/src/terminal/zoom.ts";

describe("chart zoom", () => {
  it("keeps the candle under the pointer in place", () => {
    const r = { from: 100, to: 200 }, frac = 0.3, anchor = 100 + 0.3 * 100;
    const z = zoomRange(r, 0.5, frac, 1000);
    expect(z.to - z.from).toBeCloseTo(50);
    expect(z.from + frac * (z.to - z.from)).toBeCloseTo(anchor);
  });
  it("never leaves blank space past the newest candle", () => {
    const z = zoomRange({ from: 800, to: 1000 }, 2, 0.5, 1000);
    expect(z.to).toBeLessThanOrEqual(1003); expect(z.to - z.from).toBeCloseTo(400);
  });
  it("stops at 6 candles zoomed in and at all history zoomed out", () => {
    expect(zoomRange({ from: 0, to: 10 }, 0.1, 0.5, 1000).to - zoomRange({ from: 0, to: 10 }, 0.1, 0.5, 1000).from).toBe(6);
    const out = zoomRange({ from: 0, to: 900 }, 5, 0.5, 1000); expect(out.to - out.from).toBe(1300); expect(out.to).toBe(1003);
  });
});
