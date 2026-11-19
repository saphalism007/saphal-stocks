import { describe, it, expect } from "vitest";
import { ticksFor, intradayBars } from "../shared/intraday.ts";

const day = "11:01:00|AAA:100:10,CFCL:590:100\n11:02:00|CFCL:592:150\n11:03:00|AAA:101:20\n11:06:00|CFCL:589:300\n11:17:00|CFCL:595:400,AAA:102:30\n";
describe("intraday candles", () => {
  it("reads one stock's recorded prices, not its neighbours'", () => {
    expect(ticksFor(day, "CFCL").map((t) => t.price)).toEqual([590, 592, 589, 595]);
    expect(ticksFor(day, "AAA").map((t) => t.price)).toEqual([100, 101, 102]);
    expect(ticksFor(day, "CF")).toEqual([]);
  });
  it("builds candles with the right open, high, low, close and volume", () => {
    const b = intradayBars(ticksFor(day, "CFCL"), 5, "2026-11-19");
    expect(b.length).toBe(3); // 11:00, 11:05, 11:15
    expect(b[0]).toMatchObject({ open: 590, high: 592, low: 590, close: 592, volume: 150 });
    expect(b[1]).toMatchObject({ open: 592, high: 592, low: 589, close: 589, volume: 150 });
    expect(new Date(Number(b[0].date) * 1000).toISOString()).toBe("2026-11-19T11:00:00.000Z"); // Nepal time on the axis
  });
});
