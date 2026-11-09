// Reads deposit rates from a bank's or finance company's official interest-rate notice image.
// Banks publish these notices as images only, so the rates are read by Claude (with your API key)
// into a fixed JSON schema, then saved with the notice link and method "ai" so you can check them.
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.ts";

export interface ExtractedRate { product: string; depositor: "individual" | "institutional" | "remittance" | "senior" | "other"; tenor_months: number | null; rate: number }
export interface NoticeExtraction { institution: string; effective_from: string | null; rates: ExtractedRate[]; saving_rate_max: number | null; base_rate: number | null }

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["institution", "effective_from", "rates", "saving_rate_max", "base_rate"],
  properties: {
    institution: { type: "string", description: "Institution name as printed on the notice" },
    effective_from: { type: ["string", "null"], description: "Effective date in AD as YYYY-MM-DD if printed (convert from BS only if the AD date is also printed), else null" },
    rates: {
      type: "array",
      description: "Every fixed or recurring deposit rate printed on the notice. Do not include loan rates.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["product", "depositor", "tenor_months", "rate"],
        properties: {
          product: { type: "string", description: "Product or tenor label as printed, e.g. 'Fixed Deposit 1 Year'" },
          depositor: { type: "string", enum: ["individual", "institutional", "remittance", "senior", "other"] },
          tenor_months: { type: ["integer", "null"], description: "Tenor in months (use the lower bound of a range, e.g. '3 to 9 Months' = 3); null if not stated" },
          rate: { type: "number", description: "Annual rate in percent, e.g. 3.5 for 3.50%" },
        },
      },
    },
    saving_rate_max: { type: ["number", "null"], description: "Highest savings-account rate printed, else null" },
    base_rate: { type: ["number", "null"], description: "Base rate printed for the latest month, else null" },
  },
};

export async function extractNoticeRates(imageUrl: string): Promise<NoticeExtraction> {
  const key = (config.ai as { apiKey?: string }).apiKey;
  if (!config.ai.hasKey) throw Object.assign(new Error("Add your Anthropic API key in Settings → AI to read rate notices."), { status: 400 });
  const client = key ? new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true }) : new Anthropic();
  const params: Record<string, unknown> = {
    model: config.ai.model,
    max_tokens: 4000,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "url", url: imageUrl } },
        { type: "text", text: "This is an official interest-rate notice from a Nepali bank or finance company. Extract the deposit rates exactly as printed. Never estimate or fill in a rate that is not printed." },
      ],
    }],
  };
  const res = await client.beta.messages.create(params as never) as Anthropic.Beta.BetaMessage;
  if (res.stop_reason === "refusal") throw new Error("The model declined to read this notice.");
  const text = res.content.find((b) => b.type === "text") as { text: string } | undefined;
  if (!text) throw new Error("No result from the model.");
  const out = JSON.parse(text.text) as NoticeExtraction;
  out.rates = out.rates.filter((r) => Number.isFinite(r.rate) && r.rate > 0 && r.rate < 20);
  return out;
}
