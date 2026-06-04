// Supabase Edge Function: vobiz-webhook
// Receives VoBiz SIP-trunk callbacks (Ring / StartApp / Hangup / recording.completed)
// and upserts telephony CDR rows into `call_cdr`. SEPARATE from the ElevenLabs
// conversation layer (`calls`) — no dedup conflict.
// Deploy: supabase functions deploy vobiz-webhook --no-verify-jwt --project-ref yhwoqmhnvzpfgacfaidg
// URL:    https://yhwoqmhnvzpfgacfaidg.functions.supabase.co/vobiz-webhook
//
// Auth: VoBiz signs over the callback URL + nonce (NOT the body):
//   X-Vobiz-Signature-V3 = base64( HMAC-SHA256( key=authToken, msg=baseURL + "." + nonce ) )
// with the nonce in X-Vobiz-Signature-V3-Nonce. baseURL = callback URL minus query.
// Set VOBIZ_AUTH_TOKEN to enforce; set VOBIZ_CALLBACK_URL if the public URL differs
// from what the function sees behind Supabase's proxy.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const VOBIZ_AUTH_TOKEN = Deno.env.get("VOBIZ_AUTH_TOKEN") ?? "";
const VOBIZ_CALLBACK_URL = Deno.env.get("VOBIZ_CALLBACK_URL") ?? "";

async function hmacBase64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function baseUrlOf(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return raw;
  }
}

// Verify V3 (and V2 fallback). Signs URL+nonce, so we need the exact callback URL.
async function verifySignature(req: Request): Promise<boolean> {
  if (!VOBIZ_AUTH_TOKEN) return true; // not configured → open (set token to enforce)
  const base = baseUrlOf(VOBIZ_CALLBACK_URL || req.url).replace(/^http:/, "https:");

  const v3 = req.headers.get("x-vobiz-signature-v3") ?? "";
  const v3Nonce = req.headers.get("x-vobiz-signature-v3-nonce") ?? "";
  if (v3 && v3Nonce) {
    const expected = await hmacBase64(VOBIZ_AUTH_TOKEN, `${base}.${v3Nonce}`);
    if (constantTimeEqual(v3, expected)) return true;
  }
  const v2 = req.headers.get("x-vobiz-signature-v2") ?? "";
  const v2Nonce = req.headers.get("x-vobiz-signature-v2-nonce") ?? "";
  if (v2 && v2Nonce) {
    const expected = await hmacBase64(VOBIZ_AUTH_TOKEN, `${base}${v2Nonce}`);
    if (constantTimeEqual(v2, expected)) return true;
  }
  return false;
}

// VoBiz may send JSON or x-www-form-urlencoded; handle both.
function parseBody(raw: string, contentType: string): Record<string, unknown> {
  const t = raw.trim();
  if (!t) return {};
  if (t.startsWith("{") || contentType.includes("json")) {
    try { return JSON.parse(t); } catch { /* fall through */ }
  }
  const out: Record<string, unknown> = {};
  for (const pair of t.split("&")) {
    const [k, v] = pair.split("=");
    if (k) out[decodeURIComponent(k)] = decodeURIComponent((v ?? "").replace(/\+/g, " "));
  }
  return out;
}

function pick<T = unknown>(obj: Record<string, unknown>, keys: string[]): T | null {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return null;
}

function toInt(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-vobiz-signature-v2, x-vobiz-signature-v3, x-vobiz-signature-v2-nonce, x-vobiz-signature-v3-nonce",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method === "GET") return json({ ok: true, service: "vobiz-webhook" });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: corsHeaders });

  if (!(await verifySignature(req))) {
    console.warn("[vobiz-webhook] signature mismatch");
    return json({ ok: false, error: "invalid signature" }, 403);
  }

  const rawBody = await req.text();
  const body = parseBody(rawBody, req.headers.get("content-type") ?? "");
  console.log("[vobiz-webhook] received", rawBody);

  // CallUUID is the dedupe key. CDR-pull payloads use `uuid`/`id`.
  const call_uuid = pick<string>(body, ["CallUUID", "call_uuid", "uuid", "id"]);
  if (!call_uuid) return json({ ok: true, verified: true }); // probe / no id

  const row: Record<string, unknown> = { call_uuid, raw: body };
  const set = (k: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return;
    row[k] = v;
  };
  set("event", pick(body, ["Event", "event"]));
  set("direction", (pick<string>(body, ["Direction", "call_direction", "direction"]) ?? "").toString().toLowerCase() || null);
  set("from_number", pick(body, ["From", "from_number", "caller_id_number"]));
  set("to_number", pick(body, ["To", "to_number", "destination_number"]));
  set("status", pick(body, ["Status", "status"]));
  set("duration_seconds", toInt(pick(body, ["Duration", "duration"])));
  set("billsec", toInt(pick(body, ["billsec", "BillSec"])));
  set("ring_time", toInt(pick(body, ["ring_time", "RingTime"])));
  set("start_time", pick(body, ["StartTime", "start_time"]));
  set("answer_time", pick(body, ["AnswerTime", "answer_time"]));
  set("end_time", pick(body, ["EndTime", "end_time"]));
  set("hangup_cause", pick(body, ["hangup_cause", "HangupCause"]));
  set("hangup_cause_name", pick(body, ["hangup_cause_name"]));
  set("hangup_source", pick(body, ["hangup_source", "HangupSource"]));
  set("cost", toNum(pick(body, ["cost", "total_cost", "Cost"])));
  set("currency", pick(body, ["currency", "Currency"]));
  set("mos", toNum(pick(body, ["mos", "MOS"])));
  set("jitter", toNum(pick(body, ["jitter"])));
  set("packet_loss", toNum(pick(body, ["packet_loss"])));
  set("sip_call_id", pick(body, ["sip_call_id", "SipCallID"]));
  set("recording_url", pick(body, ["RecordingUrl", "recording_url", "recording"]));

  const { error } = await supabase.from("call_cdr").upsert(row, { onConflict: "call_uuid" });
  if (error) {
    console.error("[vobiz-webhook] supabase error", error, "row=", row);
    return json({ ok: false, error: error.message }, 500);
  }

  return json({ ok: true, call_uuid });
});
