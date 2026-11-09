import { describe, expect, it } from "vitest";
import { searchStocks, searchSectors, searchFeatures, splitIntent } from "../shared/search.ts";

const cos = [
  { symbol: "NABIL", name: "Nabil Bank Limited", sector: "Commercial Bank", status: "active" },
  { symbol: "NICA", name: "NIC Asia Bank Ltd.", sector: "Commercial Bank", status: "active" },
  { symbol: "USHL", name: "Upper Syange Hydropower Limited", sector: "Hydropower", status: "active" },
  { symbol: "USHEC", name: "Upper Solu Hydro Electric Company Limited", sector: "Hydropower", status: "active" },
  { symbol: "MFIL", name: "Manjushree Finance Limited", sector: "Finance", status: "active" },
  { symbol: "UPPER", name: "Upper Tamakoshi Hydropower Ltd", sector: "Hydropower", status: "active" },
];

describe("smart search", () => {
  it("ranks symbol matches first", () => {
    const r = searchStocks("ush", cos).map((x) => x.symbol);
    expect(r.slice(0, 2).sort()).toEqual(["USHEC", "USHL"]);
    expect(r.indexOf("MFIL")).toBeGreaterThan(1);
  });
  it("finds by any name words, initials and typos", () => {
    expect(searchStocks("upper syange", cos)[0].symbol).toBe("USHL");
    expect(searchStocks("tamakoshi", cos)[0].symbol).toBe("UPPER");
    expect(searchStocks("nic asia", cos)[0].symbol).toBe("NICA");
    expect(searchStocks("nabl", cos)[0].symbol).toBe("NABIL");
    expect(searchStocks("nabill bank", cos)[0].symbol).toBe("NABIL");
  });
  it("understands intents", () => {
    const s = splitIntent("nabil chart");
    expect(s.rest).toBe("nabil");
    expect(s.intent?.path("NABIL")).toBe("/terminal/NABIL");
    expect(splitIntent("nica dividend").intent?.path("NICA")).toBe("/stocks/NICA?tab=dividends");
  });
  it("finds sectors and app features", () => {
    expect(searchSectors("hydro", ["Hydropower", "Finance"])).toEqual(["Hydropower"]);
    expect(searchFeatures("gold")[0].to).toBe("/invest?tab=metals");
    expect(searchFeatures("sip")[0].to).toMatch(/invest/);
    expect(searchFeatures("fd rates")[0].to).toBe("/invest?tab=deposits");
    expect(searchFeatures("ipo result")[0].to).toBe("/ipo");
  });
});
