import { openai } from "@/lib/openai";

// One JSON-completion call, provider-agnostic.
//
// Sarvam (sarvam-105b) is the default when SARVAM_API_KEY is set: the calls are
// Hindi/Hinglish and an Indic-native model reads buyer emotion in them far more
// reliably than a general model, which flattens everything to "neutral".
// OPENAI stays as the fallback — set LLM_PROVIDER=openai to force it.
//
// Sarvam's endpoint is OpenAI-shaped (Bearer auth accepted, response_format
// supported), so this is a plain fetch — no second SDK.

const SARVAM_URL = "https://api.sarvam.ai/v1/chat/completions";
const SARVAM_MODEL = process.env.SARVAM_MODEL ?? "sarvam-105b";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

export type LlmProvider = "sarvam" | "openai";

export function activeProvider(): LlmProvider {
  const forced = (process.env.LLM_PROVIDER ?? "").toLowerCase();
  if (forced === "openai") return "openai";
  if (forced === "sarvam") return "sarvam";
  return process.env.SARVAM_API_KEY ? "sarvam" : "openai";
}

export interface JsonCompletion {
  json: Record<string, unknown>;
  provider: LlmProvider;
  model: string;
}

export async function completeJson(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<JsonCompletion> {
  const { system, user, maxTokens = 2500, temperature = 0.2 } = opts;
  const provider = activeProvider();

  if (provider === "sarvam") {
    const key = process.env.SARVAM_API_KEY;
    if (!key) throw new Error("SARVAM_API_KEY is not set");
    const res = await fetch(SARVAM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: SARVAM_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        max_tokens: maxTokens,
        temperature,
        // Thinking mode is ON by default on sarvam-105b and its reasoning_content
        // is billed against max_tokens — left on, it eats the whole budget and
        // returns `content: null`. We want the JSON, not the deliberation.
        reasoning_effort: null,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`sarvam ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      const reason = data?.choices?.[0]?.finish_reason ?? "unknown";
      throw new Error(`sarvam returned empty content (finish_reason=${reason})`);
    }
    return { json: parseJson(content), provider, model: SARVAM_MODEL };
  }

  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: maxTokens,
    temperature,
  });
  return {
    json: parseJson(response.choices[0].message.content ?? "{}"),
    provider,
    model: OPENAI_MODEL,
  };
}

// Models that reason before answering sometimes wrap the object in prose or a
// ```json fence even under response_format — recover the object rather than
// throwing away a whole call's analysis.
function parseJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error(`model returned non-JSON: ${raw.slice(0, 200)}`);
  }
}
