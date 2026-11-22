import { describe, it, expect } from "vitest";
import { smartMoney, brokerFavourites, type BrokerRow } from "../shared/smartMoney.ts";
import { macro, tagNews } from "../shared/macro.ts";
import type { Bar } from "../shared/types.ts";

const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
const bar = (i: number, close: number, volume: number, wick = 0.01, closeAt = 0.5): Bar => {
  const high = close * (1 + wick), low = close * (1 - wick);
  return { date: day(i), open: close, high, low, close: low + (high - low) * closeAt, volume, amount: close * volume };
};

describe("smart money", () => {
  it("flags a pump: sharp run-up on heavy volume with repeated limit-up days", () => {
    const bars: Bar[] = [];
    for (let i = 0; i < 150; i++) bars.push(bar(i, 300, 10_000));
    let p = 300;
    for (let i = 150; i < 160; i++) { p *= i < 154 ? 1.1 : 1.02; bars.push(bar(i, p, 60_000, 0.01, 0.9)); }
    const s = smartMoney({ bars, listedShares: 2_000_000, floor: [], brokers: [] });
    expect(s.risk).toBe("High");
    expect(s.blocksBuy).toMatch(/operator/);
    expect(s.riskWhy.join(" ")).toMatch(/upper limit/);
    expect(s.verdict).toBe("negative");
  });

  it("sees accumulation: sideways near the lows with buying volume dominating", () => {
    const bars: Bar[] = [];
    for (let i = 0; i < 100; i++) bars.push(bar(i, 500 - i * 2, 20_000));
    for (let i = 100; i < 140; i++) bars.push(bar(i, 300 + (i % 2 ? 4 : -2), i % 2 ? 40_000 : 10_000, 0.02, 0.85));
    const s = smartMoney({ bars, listedShares: 50_000_000, floor: [], brokers: [] });
    expect(s.phase).toBe("Accumulation");
    expect(s.risk).toBe("Low");
  });

  it("reads concentrated broker buying as accumulation and the reverse as distribution", () => {
    const bars: Bar[] = Array.from({ length: 120 }, (_, i) => bar(i, 400, 20_000));
    const rows = (bigSide: "buy" | "sell"): BrokerRow[] => {
      const out: BrokerRow[] = [];
      for (let d = 0; d < 5; d++) {
        const date = day(200 + d);
        // Two big brokers on one side, twenty small brokers on the other.
        for (const b of [1, 2]) out.push({ date, broker: b, buyQty: bigSide === "buy" ? 5000 : 0, sellQty: bigSide === "sell" ? 5000 : 0 });
        for (let b = 10; b < 30; b++) out.push({ date, broker: b, buyQty: bigSide === "sell" ? 500 : 0, sellQty: bigSide === "buy" ? 500 : 0 });
      }
      return out;
    };
    const acc = smartMoney({ bars, listedShares: 1e8, floor: [], brokers: rows("buy") });
    expect(acc.brokerRead).toBe("Accumulation");
    expect(acc.topBuyers[0].netDays).toBe(5);
    const dist = smartMoney({ bars, listedShares: 1e8, floor: [], brokers: rows("sell") });
    expect(dist.brokerRead).toBe("Distribution");
    expect(dist.blocksBuy).toMatch(/net sellers/);
  });

  it("needs at least 3 sessions before calling broker flow", () => {
    const bars: Bar[] = Array.from({ length: 120 }, (_, i) => bar(i, 400, 20_000));
    const s = smartMoney({ bars, listedShares: 1e8, floor: [], brokers: [{ date: "2026-11-20", broker: 1, buyQty: 9000, sellQty: 0 }, { date: "2026-11-20", broker: 2, buyQty: 0, sellQty: 9000 }] });
    expect(s.brokerRead).toBe("Not enough data");
    expect(s.reasons.join(" ")).toMatch(/too few/);
  });

  it("warns about heavy crossing (same broker on both sides)", () => {
    const bars: Bar[] = Array.from({ length: 120 }, (_, i) => bar(i, 400, 20_000));
    const s = smartMoney({ bars, listedShares: 1e8, floor: [{ date: "2026-11-20", qty: 10_000, amount: 4e6, trades: 50, buyers: 5, sellers: 5, crossQty: 4000 }], brokers: [] });
    expect(s.metrics.crossPct).toBe(40);
    expect(s.riskWhy.join(" ")).toMatch(/crossing/);
  });

  it("lists the stocks the biggest brokers net bought and sold, skipping small turnover", () => {
    const rows = [
      { symbol: "AAA", broker: 1, buyAmt: 9e7, sellAmt: 1e7 }, { symbol: "AAA", broker: 2, buyAmt: 0, sellAmt: 8e7 },
      { symbol: "BBB", broker: 1, buyAmt: 1e7, sellAmt: 6e7 }, { symbol: "BBB", broker: 3, buyAmt: 5e7, sellAmt: 0 },
      { symbol: "TINY", broker: 1, buyAmt: 1e6, sellAmt: 0 },
    ];
    const f = brokerFavourites(rows, 1);
    expect(f.buy.map((x) => x.symbol)).toEqual(["AAA"]);
    expect(f.sell.map((x) => x.symbol)).toEqual(["BBB"]);
  });
});

describe("economy, policy and politics", () => {
  const report = {
    title: "Current Macroeconomic and Financial Situation (Three Months Data (Ending Mid-October) of 2026/27)", published: "2026-11-19", inflation: 6.37, url: "u",
    highlights: [
      "Gross foreign exchange reserves stood at Rs. 4161.14 billion. Such reserve remained 27.39 billion in USD terms. The reserve is sufficient to cover the prospective merchandise and services imports of 17.2 months.",
      "Remittances increased 27.2 percent in NPR terms and 16.7 percent in USD terms.",
      "Deposits at the BFIs increased by 2.8 percent and private sector credit increased by 3.1 percent. On y-o-y basis, deposits increased by 13.7 percent and private sector credit increased by 8.3 percent.",
      "The weighted average inter-bank rate among the BFIs stood at 2.75 percent, while the weighted average rate for 91-day Treasury bills stood at 1.01 percent.",
      "Weighted average deposit rate of commercial banks stood at 3.07 percent and lending rate stood at 6.31 percent.",
    ],
  };
  it("reads NRB's report figures and judges liquidity", () => {
    const m = macro({ reports: [report, { ...report, published: "2026-10-15", inflation: 6.34, highlights: ["lending rate stood at 6.38 percent."] }], policyRate: { value: 4.25, asOf: "2025-12-02", prev: 4.5, prevAsOf: "2025-07-17" }, news: [], today: "2026-11-22" });
    const v = (l: string) => m.points.find((p) => p.label === l)!;
    expect(v("Bank lending rate").value).toBe("6.31% (was 6.38%)");
    expect(v("Interbank rate").effect).toBe("positive");
    expect(v("Foreign exchange reserves").value).toBe("17.2 months of imports");
    expect(v("Inflation").effect).toBe("neutral");
    expect(m.verdict).toBe("positive");
    expect(m.sectorNotes["Commercial Bank"][0]).toMatch(/margins/);
  });
  it("tags headlines by theme and tone and skips company dividend news", () => {
    expect(tagNews({ date: "2026-11-20", title: "NRB Tightens Margin Lending Limit", url: null })).toMatchObject({ theme: "Policy", tone: "negative" });
    expect(tagNews({ date: "2026-11-19", title: "Hydropower Licence Period Set to Extend Up to 50 Years Under Proposed Electricity Act Amendment", url: null })).toMatchObject({ theme: "Policy", tone: "positive", sectors: ["Hydropower"] });
    expect(tagNews({ date: "2026-11-20", title: "Laxmi Laghubitta Proposes 5% Dividend for FY 2082/83", url: null })).toBeNull();
  });
  it("turns negative when news and policy turn against shares", () => {
    const bad = ["Protest Turns Violent in Kathmandu", "NRB Hikes Policy Rate", "Government Raises Tax on Share Profits", "Political Crisis Deepens as Coalition Collapses", "Remittance Inflow Declines"].map((t) => ({ date: "2026-11-20", title: t, url: null }));
    const m = macro({ reports: [], policyRate: { value: 5, asOf: "2026-11-01", prev: 4.25, prevAsOf: "2025-12-02" }, news: bad, today: "2026-11-22" });
    expect(m.verdict).toBe("negative");
  });
});
