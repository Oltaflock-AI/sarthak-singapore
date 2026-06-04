// Server-side ElevenLabs Conversational AI client — outbound calls over the
// VoBiz SIP trunk + phone-number listing. NEVER import from a client component
// (uses ELEVENLABS_API_KEY).

const API_BASE = "https://api.elevenlabs.io/v1/convai";

// Known agent (overridable via env). See CLAUDE.md / deploy doc.
export const AGENT_ID =
  process.env.ELEVENLABS_AGENT_ID || "agent_7701kt6yb510f5hrpm1tsmjx61w4";

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

export async function placeOutboundCall(opts: {
  agentPhoneNumberId: string;
  toNumber: string;
  dynamicVars?: Record<string, string>;
}): Promise<OutboundResult> {
  const body: Record<string, unknown> = {
    agent_id: AGENT_ID,
    agent_phone_number_id: opts.agentPhoneNumberId,
    to_number: normalisePhone(opts.toNumber),
  };
  const vars = opts.dynamicVars
    ? Object.fromEntries(
        Object.entries(opts.dynamicVars).filter(([, v]) => v != null && v !== ""),
      )
    : {};
  if (Object.keys(vars).length) {
    body.conversation_initiation_client_data = { dynamic_variables: vars };
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
