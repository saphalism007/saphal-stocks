// Trade planner: position size from your capital and risk per trade, and the exact NPR outcome at
// each target and at the stop after broker commission, SEBON fee, DP charge and capital gains tax.
// Also works as a free profit/loss and risk calculator (all fields are editable).
import { useEffect, useMemo, useState } from "react";
import { NumInput, Notice } from "./ui.tsx";
import { roundTrip, buyCost, DEFAULT_FEES, type FeeConfig } from "../../../shared/costs.ts";
import { rs, num, compact } from "../lib/format.ts";

const KEY = "ss-trade-settings";
interface Settings { capital: number; riskPct: number; maxPositionPct: number }
const load = (): Settings => { try { return { capital: 200000, riskPct: 1, maxPositionPct: 25, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { capital: 200000, riskPct: 1, maxPositionPct: 25 }; } };

export function TradePlanner({ entry: e0, stop: s0, targets: t0 = [], holdingDays = 30, fees = DEFAULT_FEES, onQty }: { entry?: number | null; stop?: number | null; targets?: number[]; holdingDays?: number; fees?: FeeConfig; onQty?: (q: number, entry: number) => void }) {
  const [st, setSt] = useState<Settings>(load);
  const [entry, setEntry] = useState<number>(e0 ?? 0);
  const [stop, setStop] = useState<number>(s0 ?? 0);
  const [targets, setTargets] = useState<number[]>(t0.length ? t0 : [0]);
  const [days, setDays] = useState(holdingDays);
  const [manualQty, setManualQty] = useState<number | null>(null);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ } }, [st]);
  const calc = useMemo(() => {
    if (!(entry > 0)) return { error: "Enter an entry price." };
    if (stop > 0 && stop >= entry) return { error: "The stop-loss must be below the entry price." };
    const perShare = stop > 0 ? entry - stop : null;
    // Size by risk (if a stop is set), capped by the maximum position size and by capital including charges.
    let byRisk = perShare ? Math.floor((st.capital * st.riskPct / 100) / (perShare * 1.01)) : Infinity;
    let byCap = Math.floor((st.capital * st.maxPositionPct / 100) / entry);
    let qty = manualQty ?? Math.max(0, Math.min(byRisk, byCap));
    if (!Number.isFinite(qty)) qty = byCap;
    while (qty > 0 && buyCost(qty, entry, fees).net > st.capital) qty--;
    if (qty <= 0) return { error: perShare ? "Your risk amount is smaller than the risk of one share. Raise capital or risk %, or tighten the stop." : "Capital is too small for one share at this price." };
    const buy = buyCost(qty, entry, fees);
    const atStop = stop > 0 ? roundTrip(qty, entry, stop, days, fees) : null;
    const outs = targets.filter((t) => t > entry).map((t) => ({ price: t, ...roundTrip(qty, entry, t, days, fees) }));
    const risk = atStop ? -atStop.netProfit : null;
    return { qty, buy, atStop, outs, risk, limitedBy: manualQty != null ? "your quantity" : byRisk <= byCap ? `your ${st.riskPct}% risk per trade` : `your ${st.maxPositionPct}% maximum position`, breakeven: roundTrip(qty, entry, entry, days, fees).breakevenPrice };
  }, [entry, stop, targets, days, st, manualQty, fees]);
  useEffect(() => { if ("qty" in calc && calc.qty) onQty?.(calc.qty, entry); }, [calc, entry]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="form-grid tight">
        <label className="field">Trading capital (Rs.)<NumInput value={st.capital} min={0} onChange={(e) => setSt({ ...st, capital: Number(e.target.value) || 0 })} /></label>
        <label className="field">Max risk per trade (%)<NumInput value={st.riskPct} min={0} max={10} onChange={(e) => setSt({ ...st, riskPct: Math.min(10, Number(e.target.value) || 0) })} /></label>
        <label className="field">Max position size (% of capital)<NumInput value={st.maxPositionPct} min={1} max={100} onChange={(e) => setSt({ ...st, maxPositionPct: Math.min(100, Number(e.target.value) || 0) })} /></label>
        <label className="field">Holding period (days)<NumInput value={days} min={1} onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))} /></label>
        <label className="field">Entry price<NumInput value={entry} min={0} onChange={(e) => setEntry(Number(e.target.value) || 0)} /></label>
        <label className="field">Stop-loss<NumInput value={stop} min={0} onChange={(e) => setStop(Number(e.target.value) || 0)} /></label>
        {targets.map((t, i) => <label key={i} className="field">Target {i + 1}<NumInput value={t} min={0} onChange={(e) => { const x = [...targets]; x[i] = Number(e.target.value) || 0; setTargets(x); }} /></label>)}
        <label className="field">Quantity (blank = auto)<NumInput value={manualQty ?? ""} min={0} placeholder={"qty" in calc ? String(calc.qty) : ""} onChange={(e) => setManualQty(e.target.value === "" ? null : Math.floor(Number(e.target.value) || 0))} /></label>
      </div>
      {"error" in calc ? <Notice tone="warn">{calc.error}</Notice> : (
        <>
          <div className="plan-grid">
            <div><span>Buy</span><strong>{calc.qty.toLocaleString("en-IN")} shares</strong><em>limited by {calc.limitedBy}</em></div>
            <div><span>Total cost</span><strong>{rs(calc.buy.net, 0)}</strong><em>incl. charges {rs(calc.buy.net - calc.buy.amount, 0)}</em></div>
            <div><span>Risk if stopped</span><strong className="down">{calc.risk != null ? rs(calc.risk, 0) : "Set a stop"}</strong><em>{calc.risk != null ? `${num((calc.risk / st.capital) * 100, 2)}% of capital` : ""}</em></div>
            <div><span>Breakeven</span><strong>{rs(calc.breakeven)}</strong><em>covers buy + sell charges</em></div>
          </div>
          <table className="t small">
            <thead><tr><th>If you sell at</th><th className="num">Charges</th><th className="num">CGT</th><th className="num">Net P/L</th><th className="num">Return</th></tr></thead>
            <tbody>
              {calc.outs.map((o, i) => <tr key={i}><td>Target {i + 1}, {rs(o.price)}</td><td className="num">{rs(o.buy.net - o.buy.amount + (o.sell.amount - o.sell.net), 0)}</td><td className="num">{rs(o.cgt, 0)}</td><td className="num up">{rs(o.netProfit, 0)}</td><td className="num up">{num(o.netReturnPct, 2)}%</td></tr>)}
              {calc.atStop && <tr><td>Stop, {rs(stop)}</td><td className="num">{rs(calc.atStop.buy.net - calc.atStop.buy.amount + (calc.atStop.sell.amount - calc.atStop.sell.net), 0)}</td><td className="num">-</td><td className="num down">{rs(calc.atStop.netProfit, 0)}</td><td className="num down">{num(calc.atStop.netReturnPct, 2)}%</td></tr>}
            </tbody>
          </table>
          {calc.outs[0] && calc.risk ? <p className="small">Reward to risk after all costs: <strong>{num(calc.outs[0].netProfit / calc.risk, 2)} : 1</strong> at target 1{calc.outs.length > 1 ? `, ${num(calc.outs[calc.outs.length - 1].netProfit / calc.risk, 2)} : 1 at target ${calc.outs.length}` : ""}. Capital {compact(st.capital)}.</p> : null}
          <p className="tiny faint">Charges use your fee settings (broker slab, SEBON {num(fees.sebonFeeRate * 100, 3)}%, DP Rs. {fees.dpChargePerScrip}); CGT {num(fees.cgtShortTerm * 100, 1)}% up to {fees.holdingDaysForLongTerm} days, {num(fees.cgtLongTerm * 100, 1)}% after. Your capital and risk settings are remembered on this device.</p>
        </>
      )}
    </div>
  );
}
