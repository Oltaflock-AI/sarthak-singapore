// Server-side ElevenLabs Conversational AI client — outbound calls over the
// VoBiz SIP trunk + phone-number listing. NEVER import from a client component
// (uses ELEVENLABS_API_KEY).

import { DEFAULT_AGENT } from "@/lib/agents";

const API_BASE = "https://api.elevenlabs.io/v1/convai";

// Default agent — "Sarthak Miracle". The full per-property registry lives in
// lib/agents.ts (client-safe); this re-export keeps existing imports working.
// Pinned in code, NOT env-driven, on purpose: after the account migration Vercel
// still held ELEVENLABS_AGENT_ID = the OLD agent (agent_7701kt6yb510f5hrpm1tsmjx61w4),
// which overrode the env fallback and failed every call with "agent not found".
export const AGENT_ID = DEFAULT_AGENT.agentId;

function apiKey(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error("ELEVENLABS_API_KEY is not set");
  return k;
}

export interface ElevenPhoneNumber {
  phone_number_id: string;
  phone_number: string;
  label?: string;
  provider?: string; // twilio | exotel | sip_trunk
  assigned_agent?: { agent_id?: string; agent_name?: string } | null;
}

export interface Subscription {
  tier: string;
  character_count: number | null;
  character_limit: number | null;
  next_character_count_reset_unix: number | null;
}

// Account plan/quota. ElevenLabs bills everything (TTS *and* Conversational AI)
// out of one credit pool; the API still calls it "characters", so
// character_count = credits spent this billing period and character_limit =
// the plan's credit quota.
export async function getSubscription(): Promise<Subscription> {
  const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
    headers: { "xi-api-key": apiKey() },
    cache: "no-store",
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`subscription ${res.status}: ${t.slice(0, 200)}`);
  }
  const d = await res.json();
  return {
    tier: String(d?.tier ?? ""),
    character_count: d?.character_count ?? null,
    character_limit: d?.character_limit ?? null,
    next_character_count_reset_unix: d?.next_character_count_reset_unix ?? null,
  };
}

// ── Credits ─────────────────────────────────────────────────────────────────
// Two ElevenLabs endpoints, different permissions:
//   /v1/user/subscription        → needs `user_read` on the key. Gives the plan
//                                  quota + credits spent this billing period.
//   /v1/usage/character-stats    → works on a restricted key. Gives credits
//                                  spent over an arbitrary window, optionally
//                                  broken down (product_type = convai / tts / …).
// We read both so a key without `user_read` still yields a usage number.

export interface CreditsSpent {
  total: number;
  byProduct: Record<string, number>;
}

// Credits spent in [startMs, endMs). Times are UNIX **milliseconds** — that's
// what this endpoint wants despite the `_unix` param names.
export async function getCreditsSpent(
  startMs: number,
  endMs: number,
): Promise<CreditsSpent> {
  const qs = new URLSearchParams({
    start_unix: String(Math.round(startMs)),
    end_unix: String(Math.round(endMs)),
    aggregation_interval: "day",
    metric: "credits",
    breakdown_type: "product_type",
  });
  const res = await fetch(`https://api.elevenlabs.io/v1/usage/character-stats?${qs}`, {
    headers: { "xi-api-key": apiKey() },
    cache: "no-store",
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`usage ${res.status}: ${t.slice(0, 200)}`);
  }
  const d = await res.json();
  // Shape: { time: number[], usage: { "<bucket>": number[] } }
  const byProduct: Record<string, number> = {};
  let total = 0;
  for (const [bucket, series] of Object.entries(d?.usage ?? {})) {
    const points: unknown[] = Array.isArray(series) ? series : [];
    let sum = 0;
    for (const n of points) if (typeof n === "number" && Number.isFinite(n)) sum += n;
    byProduct[bucket] = sum;
    total += sum;
  }
  return { total, byProduct };
}

export interface CreditUsage {
  used: number | null;        // credits spent this billing period
  total: number | null;       // plan quota
  remaining: number | null;
  tier: string | null;
  resets_at: string | null;   // ISO — next quota reset
  convai_used: number | null; // Conversational AI slice of `used`, if known
  window_start: string | null;
  source: "subscription" | "usage-stats";
  warning: string | null;     // why a field is null, for the dashboard
}

// Plan quota fallback for keys that can't read /v1/user/subscription.
const PLAN_CREDITS = Number(process.env.ELEVENLABS_PLAN_CREDITS) || 0;

// One credits reading for the dashboard. Never throws unless BOTH endpoints
// fail — a partial answer still beats an empty KPI.
export async function getCreditUsage(): Promise<CreditUsage> {
  let subError: string | null = null;
  let usageError: string | null = null;

  const sub = await getSubscription().catch((e: unknown) => {
    subError = e instanceof Error ? e.message : String(e);
    return null;
  });

  // Billing window: from the previous reset (next reset − 1 month) to now.
  const now = Date.now();
  const resetMs = sub?.next_character_count_reset_unix
    ? sub.next_character_count_reset_unix * 1000
    : null;
  const windowStart = (() => {
    if (resetMs) {
      const d = new Date(resetMs);
      d.setMonth(d.getMonth() - 1);
      return d.getTime();
    }
    return now - 30 * 24 * 60 * 60 * 1000; // no reset date → trailing 30 days
  })();

  const spent = await getCreditsSpent(windowStart, now).catch((e: unknown) => {
    usageError = e instanceof Error ? e.message : String(e);
    return null;
  });

  if (!sub && !spent) {
    throw new Error(`credits unavailable — ${subError ?? "?"} / ${usageError ?? "?"}`);
  }

  const convai = spent
    ? Object.entries(spent.byProduct)
        .filter(([k]) => k.toLowerCase().includes("convai") || k.toLowerCase().includes("agent"))
        .reduce((a, [, v]) => a + v, 0)
    : null;

  const used = sub?.character_count ?? spent?.total ?? null;
  const total = sub?.character_limit ?? (PLAN_CREDITS || null);

  return {
    used: used == null ? null : Math.round(used),
    total: total == null ? null : Math.round(total),
    remaining: used != null && total != null ? Math.max(0, Math.round(total - used)) : null,
    tier: sub?.tier || null,
    resets_at: resetMs ? new Date(resetMs).toISOString() : null,
    convai_used: convai == null ? null : Math.round(convai),
    window_start: new Date(windowStart).toISOString(),
    source: sub ? "subscription" : "usage-stats",
    warning: sub
      ? null
      : `plan quota unavailable (${subError ?? "no subscription access"})${PLAN_CREDITS ? " — using ELEVENLABS_PLAN_CREDITS" : ""}`,
  };
}

export async function listPhoneNumbers(): Promise<ElevenPhoneNumber[]> {
  const res = await fetch(`${API_BASE}/phone-numbers`, {
    headers: { "xi-api-key": apiKey() },
    cache: "no-store",
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`phone-numbers ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : (data?.phone_numbers ?? []);
}

export interface OutboundResult {
  success: boolean;
  message?: string;
  conversation_id: string | null;
  sip_call_id: string | null;
}

// Normalise an Indian number to E.164. 10 digits → +91; bare digits with a
// country code → prefix '+'. Anything already starting with '+' is kept.
export function normalisePhone(raw: string): string {
  const trimmed = (raw || "").trim();
  if (trimmed.startsWith("+")) return "+" + trimmed.slice(1).replace(/[^\d]/g, "");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length === 10) return "+91" + digits;
  if (digits.length === 12 && digits.startsWith("91")) return "+" + digits;
  if (digits.length === 11 && digits.startsWith("0")) return "+91" + digits.slice(1);
  return "+" + digits;
}

export interface CalBookingOutcome {
  attempted: boolean;   // the calcom_create_booking tool was invoked
  booked: boolean;      // it returned success with a real booking uid
  uid: string | null;
  startUtc: string | null;  // Cal.com's actual booked start (ISO 8601)
  error: string | null;
}

// Authoritative booking truth: inspect a conversation's calcom_create_booking
// tool result. Returns null if the conversation can't be fetched (caller falls
// back to the transcript-derived guess).
export async function getCalBookingOutcome(
  conversationId: string,
): Promise<CalBookingOutcome | null> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(conversationId)}`, {
      headers: { "xi-api-key": apiKey() },
      cache: "no-store",
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data || !Array.isArray(data.transcript)) return null;

  const out: CalBookingOutcome = { attempted: false, booked: false, uid: null, startUtc: null, error: null };
  for (const turn of data.transcript) {
    for (const r of turn?.tool_results ?? []) {
      const name = String(r?.tool_name ?? "").toLowerCase();
      if (!name.includes("cal") || !name.includes("book")) continue;
      out.attempted = true;
      if (r?.is_error) {
        out.error = typeof r?.result_value === "string" ? r.result_value.slice(0, 300) : "booking failed";
        continue;
      }
      try {
        const parsed = typeof r?.result_value === "string" ? JSON.parse(r.result_value) : r?.result_value;
        const d = parsed?.data ?? {};
        if (d?.uid) {
          out.booked = true;
          out.uid = String(d.uid);
          out.startUtc = d?.start ? String(d.start) : null;
          out.error = null;
        }
      } catch {
        /* leave as not-booked */
      }
    }
  }
  return out;
}

// ── Live call status ────────────────────────────────────────────────────────
// Poll a conversation to drive the dialer's live indicator. ElevenLabs status
// flow for an outbound SIP call:
//   initiated   → call placed, ringing (no answer yet)
//   in-progress → callee picked up; metadata.accepted_time_unix_secs is set
//   processing  → call ended, post-call analysis running
//   done        → finished
//   failed      → busy / no-answer / error
export type CallPhase = "ringing" | "connected" | "ended" | "failed" | "unknown";

export interface LiveCallStatus {
  conversation_id: string;
  status: string; // raw ElevenLabs status
  phase: CallPhase; // collapsed, UI-friendly
  accepted: boolean; // callee has answered
  start_unix: number | null;
  accepted_unix: number | null; // when the callee picked up
  duration_secs: number | null; // final duration once ended
  termination_reason: string | null;
}

function phaseFor(status: string, accepted: boolean): CallPhase {
  switch (status) {
    case "initiated":
      return accepted ? "connected" : "ringing";
    case "in-progress":
      return "connected";
    case "processing":
    case "done":
      return "ended";
    case "failed":
      return "failed";
    default:
      return "unknown";
  }
}

export async function getLiveCallStatus(
  conversationId: string,
): Promise<LiveCallStatus> {
  const res = await fetch(`${API_BASE}/conversations/${conversationId}`, {
    headers: { "xi-api-key": apiKey() },
    cache: "no-store",
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`conversation ${res.status}: ${t.slice(0, 200)}`);
  }
  const d = await res.json();
  const m = d?.metadata ?? {};
  const status: string = d?.status ?? "unknown";
  const accepted_unix: number | null = m?.accepted_time_unix_secs ?? null;
  const accepted = accepted_unix != null || status === "in-progress";
  return {
    conversation_id: conversationId,
    status,
    phase: phaseFor(status, accepted),
    accepted,
    start_unix: m?.start_time_unix_secs ?? null,
    accepted_unix,
    duration_secs: m?.call_duration_secs ?? null,
    termination_reason: m?.termination_reason ?? null,
  };
}

// The default first message asks "…{{callee_name}} जी से बात हो रही है?". For a
// lead with no name we send THIS instead (per-call first_message override), so
// the agent just introduces itself and never says "Unknown जी" / "ग्राहक जी".
// Requires `first_message` to be allowed in the agent's overrides.
export const UNKNOWN_FIRST_MESSAGE =
  "नमस्ते, मैं प्रिया बोल रही हूँ Sarthak Singapore Group से।";

// Greeting params for an outbound call. Named lead → pass callee_name and let
// the agent's default first message greet them by name. No name → name-less
// first message override.
export function greetingFor(leadName: string | null | undefined): {
  dynamicVars: Record<string, string>;
  firstMessageOverride?: string;
} {
  const name = (leadName ?? "").trim();
  if (name) return { dynamicVars: { callee_name: name, lead_name: name } };
  return { dynamicVars: {}, firstMessageOverride: UNKNOWN_FIRST_MESSAGE };
}

export async function placeOutboundCall(opts: {
  agentPhoneNumberId: string;
  toNumber: string;
  agentId?: string; // property agent (lib/agents.ts); defaults to Miracle
  dynamicVars?: Record<string, string>;
  firstMessageOverride?: string;
  ringingTimeoutSecs?: number; // how long ElevenLabs lets it ring (their default: 60)
}): Promise<OutboundResult> {
  const body: Record<string, unknown> = {
    agent_id: opts.agentId ?? AGENT_ID,
    agent_phone_number_id: opts.agentPhoneNumberId,
    to_number: normalisePhone(opts.toNumber),
  };
  if (opts.ringingTimeoutSecs && Number.isFinite(opts.ringingTimeoutSecs)) {
    body.telephony_call_config = {
      ringing_timeout_secs: Math.min(120, Math.max(10, Math.round(opts.ringingTimeoutSecs))),
    };
  }
  const vars = opts.dynamicVars
    ? Object.fromEntries(
        Object.entries(opts.dynamicVars).filter(([, v]) => v != null && v !== ""),
      )
    : {};
  const cicd: Record<string, unknown> = {};
  if (Object.keys(vars).length) cicd.dynamic_variables = vars;
  if (opts.firstMessageOverride) {
    cicd.conversation_config_override = { agent: { first_message: opts.firstMessageOverride } };
  }
  if (Object.keys(cicd).length) {
    body.conversation_initiation_client_data = cicd;
  }

  const res = await fetch(`${API_BASE}/sip-trunk/outbound-call`, {
    method: "POST",
    headers: { "xi-api-key": apiKey(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json?.detail?.message || json?.message || `outbound-call ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return {
    success: json?.success ?? true,
    message: json?.message,
    conversation_id: json?.conversation_id ?? null,
    sip_call_id: json?.sip_call_id ?? null,
  };
}
