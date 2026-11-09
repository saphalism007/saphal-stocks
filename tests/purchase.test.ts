import { describe, expect, it } from "vitest";
import { potStatus, affordability, emiVsSave, parkWhere } from "../shared/purchase.ts";

describe("purchase planner", () => {
  const pot = { name: "TV + PS5 Pro", kind: "want" as const, items: [{ name: "TV", price: 180000 }, { name: "PS5 Pro", price: 120000 }], start: "2026-11-01", target: "2027-05-01", deposits: [{ date: "2026-11-02", amount: 50000 }] };
  it("works out monthly saving, progress and status", () => {
    const s = potStatus(pot, "2026-11-09");
    expect(s.total).toBe(300000);
    expect(s.saved).toBe(50000);
    expect(s.monthsLeft).toBe(6);
    expect(s.monthly).toBeGreaterThan(40000); expect(s.monthly).toBeLessThan(43000);
    expect(s.status).toBe("ahead");
    expect(potStatus({ ...pot, deposits: [{ date: "2026-11-02", amount: 300000 }] }, "2026-11-09").status).toBe("ready");
  });
  it("checks affordability and parking", () => {
    expect(affordability(40000, { income: 150000, cashFlow: 100000, emergencyGap: 0 }, "want").level).toBe("yes");
    expect(affordability(40000, { income: 100000, cashFlow: 30000, emergencyGap: 0 }, "want").level).toBe("no");
    expect(parkWhere(2).place).toMatch(/savings/);
    expect(parkWhere(18).place).toMatch(/deposit/);
  });
  it("EMI costs more than saving first", () => {
    const e = emiVsSave(300000, 18, 12, 2000, 6);
    expect(e.extraCost).toBeGreaterThan(30000);
    expect(e.monthsToSave).toBeLessThan(12);
  });
});
