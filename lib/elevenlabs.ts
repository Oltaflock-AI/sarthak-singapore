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

// Account plan/quota. NOTE: ElevenLabs exposes only TTS *character* credits here
// — never Conversational AI *minutes* — so callers derive minutes from the tier.
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
