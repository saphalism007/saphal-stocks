import { describe, it, expect } from "vitest";
import { settle, type SplitGroup } from "../shared/split.ts";

const people = ["Saphal", "Ujin", "Samarth", "Bigya", "Sacchyam", "Alin"].map((n) => ({ id: n.toLowerCase(), name: n }));
const g: SplitGroup = {
  id: "g", name: "Trip", people,
  expenses: [
    { id: "a", title: "Sacchyam's bill", amount: 780, payers: [{ personId: "sacchyam", amount: 780 }], mode: "equal", among: ["sacchyam", "saphal", "ujin", "alin"] },
    { id: "b", title: "Saphal's bill", amount: 4852.35, payers: [{ personId: "saphal", amount: 4852.35 }], mode: "equal", among: people.map((p) => p.id) },
  ],
};

describe("expense split", () => {
  it("settles the six-person example to the paisa", () => {
    const r = settle(g);
    expect(r.total).toBe(5632.35);
    expect(r.issues).toEqual([]);
    const t = Object.fromEntries(r.transfers.map((x) => [x.fromName, [x.toName, x.amount]]));
    expect(t).toEqual({ Ujin: ["Saphal", 1003.73], Alin: ["Saphal", 1003.72], Samarth: ["Saphal", 808.73], Bigya: ["Saphal", 808.72], Sacchyam: ["Saphal", 223.72] });
    const sum = r.transfers.reduce((s, x) => s + Math.round(x.amount * 100), 0);
    expect(sum).toBe(384862);
    expect(r.people.reduce((s, p) => s + Math.round(p.balance * 100), 0)).toBe(0); // everything balances
  });
  it("handles shares, exact amounts and several payers", () => {
    const r = settle({ id: "x", name: "x", people: people.slice(0, 3), expenses: [
      { id: "1", title: "Rent", amount: 900, payers: [{ personId: "saphal", amount: 600 }, { personId: "ujin", amount: 300 }], mode: "shares", among: ["saphal", "ujin", "samarth"], shares: { saphal: 2, ujin: 1, samarth: 0 } },
      { id: "2", title: "Food", amount: 100, payers: [{ personId: "samarth", amount: 100 }], mode: "exact", among: ["saphal", "samarth"], shares: { saphal: 70, samarth: 30 } },
    ] });
    expect(r.people.map((p) => [p.name, p.share])).toEqual([["Saphal", 670], ["Ujin", 300], ["Samarth", 30]]);
    expect(r.transfers).toEqual([{ from: "saphal", to: "samarth", fromName: "Saphal", toName: "Samarth", amount: 70 }]);
  });
  it("flags mistakes instead of guessing", () => {
    const r = settle({ id: "x", name: "x", people: people.slice(0, 2), expenses: [{ id: "1", title: "Taxi", amount: 500, payers: [{ personId: "saphal", amount: 300 }, { personId: "ujin", amount: 100 }], mode: "equal", among: ["saphal", "ujin"] }] });
    expect(r.issues[0]).toMatch(/payers add up to Rs. 400.00/);
  });
});
