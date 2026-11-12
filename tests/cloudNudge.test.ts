import { describe, expect, it } from "vitest";
import { dueSlot } from "../server/lib/cloudNudge.ts";

describe("cloud update times", () => {
  const at = (h: number, m: number) => dueSlot(h * 60 + m);
  it("asks before the open, every 15 minutes in trading, and after the close", () => {
    expect(at(10, 35)).toEqual({ key: "10:35", mode: "intraday" });
    expect(at(10, 50)).toBeNull();
    expect(at(11, 0)).toEqual({ key: "11:00", mode: "intraday" });
    expect(at(11, 3)?.key).toBe("11:00");
    expect(at(11, 7)).toBeNull();
    expect(at(15, 15)).toEqual({ key: "15:15", mode: "intraday" });
    expect(at(15, 30)).toBeNull();
    expect(at(15, 50)).toEqual({ key: "15:50", mode: "daily" });
    expect(at(9, 0)).toBeNull();
  });
});
