import { describe, expect, it } from "vitest";
import { geometry, TOOLS, type Drawing, type Mapper } from "../web/src/terminal/draw.ts";

const dates = Array.from({ length: 200 }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
const idx = (t: string) => Math.max(0, dates.indexOf(t));
const m: Mapper = { x: (t) => idx(t) * 5, y: (p) => 600 - p, w: 1000, h: 600, idx, fmt: (p) => p.toFixed(2),
  closesBetween: (a, b) => { const i0 = Math.min(idx(a), idx(b)), i1 = Math.max(idx(a), idx(b)); return Array.from({ length: i1 - i0 + 1 }, (_, k) => ({ i: i0 + k, c: 300 + 20 * Math.sin(k / 5) })); } };

describe("drawing tools", () => {
  it("has 48 tools and every one draws valid shapes", () => {
    expect(TOOLS.size).toBe(48);
    for (const def of TOOLS.values()) {
      const n = Math.max(def.points, 2);
      const d: Drawing = { id: "x", tool: def.id, pts: Array.from({ length: n }, (_, i) => ({ t: dates[20 + i * 15], p: 300 + (i % 2 ? 40 : -30) + i * 5 })), color: "#2962ff", width: 2, dash: false };
      const g = geometry(d, m);
      expect(g, def.id).toBeTruthy();
      const text = JSON.stringify(g);
      expect(text, def.id).not.toMatch(/NaN|Infinity|undefined/);
      expect(g!.paths.length + g!.labels.length, def.id).toBeGreaterThan(0);
    }
  });
});
