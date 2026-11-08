// AI analyst: a tool-using loop over the platform's own data. The provider and
// model are configurable (AI_PROVIDER / AI_MODEL / AI_EFFORT in .env or Settings).
// Conversation history is append-only (assistant content is replayed unchanged).
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.ts";
import { TOOL_DEFS, executeTool, dataContext } from "./tools.ts";

export const SYSTEM_PROMPT = `You are the AI Stock Analyst inside Saphal Stocks, a personal financial intelligence platform for Nepal. You help one investor analyse NEPSE stocks, their portfolio, and Nepalese investment options.

How you work:
- Always retrieve data with the tools before answering any question about markets, stocks, the portfolio, or documents. Never state a price, ratio, level, date or statistic that did not come from a tool result or a calculation you show.
- If data is missing or stale, say so plainly ("Data unavailable" or "Last updated: <date>") and explain what would be needed. Do not fill gaps with guesses.
- Mention the trading date of the prices you use. NEPSE trades in Nepali Rupees (Rs.); times are Asia/Kathmandu.
- Separate clearly: Facts (from data), Calculations (show the formula or tool), Assumptions, and Predictions/opinions. Predictions are probabilistic, never certain.
- Be sector-aware: judge banks/finance on ROE, NPL, CAR, P/B; insurers on solvency and ROE; hydropower on leverage, interest cover and P/B; use the sector model the tools provide.
- Investing and trading are different. Say which horizon a view applies to. A good 5-year investment can be a poor 2-week trade and vice versa.
- NEPSE has no short selling: bearish views mean avoid / reduce / protect, not short.
- Include Nepal costs where relevant: broker commission, SEBON fee, DP charge, capital gains tax (7.5% up to 365 days, 5% after, for individuals) and 5% dividend tax. Use the calculate tool for exact numbers.
- When recommending or assessing a stock, use this structure (omit parts with no data, and say so):
  **Verdict** (with horizon) · **Scores** (fundamental, technical, valuation, financial health, risk) · **Market context** · **Bullish arguments** · **Bearish arguments** · **Entry zone** · **Support / resistance** · **Stop-loss** · **Targets** · **Risk/reward** · **What would invalidate this view** · **Data freshness and sources**.
- Rankings and screens: say which strategy model was used, its weights and filters, and how many stocks were excluded for missing data.
- For document questions, quote briefly and cite document title, period and page from search_documents results.
- For personal finance: prioritise emergency fund and high-interest debt before investing; never suggest putting all money into stocks; distinguish contractual rates from variable/historical returns; include inflation.
- You are a decision-support tool, not a licensed financial advisor. Mention uncertainty and when professional advice (tax, legal, licensed advisor) may be needed, briefly, without boilerplate on every line. Do not guarantee returns or recommend trades based only on recent price moves.
- Be concise and well organised. Use short markdown tables for comparisons. Format money as Rs. with Nepali-style grouping where natural (e.g. Rs. 12,50,000 or Rs. 12.5 lakh).`;

export interface AgentEvent { type: "status" | "tool" | "text" | "error" | "done"; data: unknown }

let fallbackSupported = true;

export function aiAvailable() {
  return config.ai.provider === "anthropic" && config.ai.hasKey;
}

export async function runAgent(history: Anthropic.MessageParam[], userId: number, emit: (e: AgentEvent) => void): Promise<{ messages: Anthropic.MessageParam[]; finalText: string; toolsUsed: string[] }> {
  const client = new Anthropic();
  const messages = [...history];
  const toolsUsed: string[] = [];
  const ctx = dataContext();
  const tools = TOOL_DEFS.map((t) => ({ ...t })) as Anthropic.Beta.BetaTool[];
  // Stable prompt first (cached), then the small volatile context block (dates change at most daily).
  const contextNote = `Today (Asia/Kathmandu): ${new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10)}. Latest stored trading date: ${ctx.latestTradingDate ?? "none"}. Quarterly reports stored: ${ctx.reportsStored?.n ?? 0} for ${ctx.reportsStored?.c ?? 0} companies.`;
  const system = [
    { type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: contextNote },
  ];

  for (let iter = 0; iter < 12; iter++) {
    emit({ type: "status", data: iter === 0 ? "Thinking" : "Analysing results" });
    const params: Record<string, unknown> = {
      model: config.ai.model,
      max_tokens: 16000,
      system,
      tools,
      thinking: { type: "adaptive" },
      output_config: { effort: config.ai.effort },
      messages,
    };
    if (fallbackSupported) { params.betas = ["server-side-fallback-2026-07-01"]; params.fallbacks = "default"; }
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = (await client.beta.messages.create(params as never)) as Anthropic.Beta.BetaMessage;
    } catch (e) {
      if (e instanceof Anthropic.BadRequestError && fallbackSupported && /fallback|beta/i.test(e.message)) {
        // Some accounts/models reject the optional refusal-fallback beta: retry once without it.
        fallbackSupported = false;
        delete params.betas; delete params.fallbacks;
        response = (await client.beta.messages.create(params as never)) as Anthropic.Beta.BetaMessage;
      } else throw e;
    }
    messages.push({ role: "assistant", content: response.content as unknown as Anthropic.ContentBlockParam[] });

    if (response.stop_reason === "refusal") {
      const text = "The model declined this request. Try rephrasing it as a question about the data.";
      emit({ type: "text", data: text });
      return { messages, finalText: text, toolsUsed };
    }
    if (response.stop_reason === "pause_turn") continue;
    const toolUses = response.content.filter((b) => b.type === "tool_use") as Anthropic.Beta.BetaToolUseBlock[];
    if (response.stop_reason !== "tool_use" || !toolUses.length) {
      const text = response.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.Beta.BetaTextBlock).text).join("\n\n");
      if (response.stop_reason === "max_tokens") emit({ type: "status", data: "Response was cut off at the length limit." });
      return { messages, finalText: text, toolsUsed };
    }
    const results: Anthropic.ToolResultBlockParam[] = await Promise.all(toolUses.map(async (tu) => {
      toolsUsed.push(tu.name);
      emit({ type: "tool", data: { name: tu.name, input: tu.input } });
      try {
        const out = await executeTool(tu.name, (tu.input || {}) as Record<string, unknown>, userId);
        let s = JSON.stringify(out);
        if (s.length > 60_000) s = s.slice(0, 60_000) + '..."[truncated: ask for a narrower query]"';
        return { type: "tool_result" as const, tool_use_id: tu.id, content: s };
      } catch (err) {
        return { type: "tool_result" as const, tool_use_id: tu.id, content: `Error: ${err instanceof Error ? err.message : String(err)}`, is_error: true };
      }
    }));
    messages.push({ role: "user", content: results });
  }
  const text = "Stopped after too many analysis steps. Please ask a narrower question.";
  return { messages, finalText: text, toolsUsed };
}
