// Supabase Edge Function: elevenlabs-webhook
// Receives ElevenLabs Conversational AI post-call webhooks and upserts `calls` + `leads`.
// Deploy: supabase functions deploy elevenlabs-webhook --no-verify-jwt --project-ref yhwoqmhnvzpfgacfaidg
// URL:    https://yhwoqmhnvzpfgacfaidg.functions.supabase.co/elevenlabs-webhook
//
// Auth: ElevenLabs signs every POST with header `ElevenLabs-Signature: t=<unix>,v0=<hex>`,
// where the signed string is `<t>.<rawBody>`, HMAC-SHA256 keyed by the webhook secret
// (wsec_…). Requests older than 30 min are rejected (replay guard).
//
// Handles two event types:
//   post_call_transcription  → answered call: full transcript + analysis + score
//   call_initiation_failure  → busy / no-answer / failed: minimal missed-lead record

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type TranscriptTurn = { speaker: string; time: string; text: string; side: string };

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const WEBHOOK_SECRET = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET") ?? "";
const TOLERANCE_SECS = 30 * 60;

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Verify `ElevenLabs-Signature: t=...,v0=...` over `<t>.<rawBody>`. nowSecs is unix time.
async function verifySignature(rawBody: string, header: string, nowSecs: number): Promise<boolean> {
  if (!WEBHOOK_SECRET) return true; // no secret configured → open (set env var to enforce)
  if (!header) return false;

  let t = "";
  let v0 = "";
  for (const part of header.split(",")) {
    const [k, val] = part.split("=");
    if (k?.trim() === "t") t = val?.trim() ?? "";
    else if (k?.trim() === "v0") v0 = val?.trim() ?? "";
  }
  if (!t || !v0) return false;

  // Replay guard.
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(nowSecs - ts) > TOLERANCE_SECS) return false;

  const expected = await hmacHex(WEBHOOK_SECRET, `${t}.${rawBody}`);
  return constantTimeEqual(v0, expected);
}

function scoreLabel(score: number | null): string | null {
  if (score == null) return null;
  if (score >= 80) return "HOT";
  if (score >= 60) return "WARM";
  return "COLD";
}

function pick<T = unknown>(obj: Record<string, unknown>, keys: string[]): T | null {
  for (const k of keys) {
    const v = k.split(".").reduce<unknown>(
      (o, p) => (o == null ? o : (o as Record<string, unknown>)[p]),
      obj,
    );
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return null;
}

// ElevenLabs transcript: [{role:"agent"|"user", message, time_in_call_secs}].
function normalizeTranscript(raw: unknown): TranscriptTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t: Record<string, unknown>) => {
      const speaker = String(t.role ?? "speaker");
      const text = String(t.message ?? t.text ?? "");
      const secs = t.time_in_call_secs;
      return {
        speaker,
        time: secs == null ? "" : String(secs),
        text,
        side: /agent|assistant|bot/i.test(speaker) ? "agent" : "user",
      };
    })
    .filter((turn) => turn.text.trim() !== "");
}

// data_collection_results entries are { value, rationale, ... }. Unwrap the value.
function collected(dcr: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const entry = dcr[k] as Record<string, unknown> | undefined;
    if (entry && typeof entry === "object" && "value" in entry) {
      const v = entry.value;
      if (v !== undefined && v !== null && v !== "") return v;
    } else if (entry !== undefined && entry !== null && entry !== "") {
      return entry; // already a scalar
    }
  }
  return null;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, elevenlabs-signature",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method === "GET") return json({ ok: true, service: "elevenlabs-webhook" });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: corsHeaders });

  const rawBody = await req.text();
  const signature = req.headers.get("elevenlabs-signature") ?? "";
  const nowSecs = Math.floor(Date.now() / 1000);

  if (!(await verifySignature(rawBody, signature, nowSecs))) {
    console.warn("[elevenlabs-webhook] signature mismatch / expired");
    return json({ ok: false, error: "invalid signature" }, 401);
  }
  if (!rawBody.trim()) return json({ ok: true, verified: true });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }

  console.log("[elevenlabs-webhook] received", rawBody);

  const type = pick<string>(body, ["type"]);
  const data = (pick<Record<string, unknown>>(body, ["data"]) ?? {}) as Record<string, unknown>;
  const call_id = pick<string>(data, ["conversation_id"]);
  if (!call_id) return json({ ok: true, verified: true }); // probe / unknown shape

  const metadata = (pick<Record<string, unknown>>(data, ["metadata"]) ?? {}) as Record<string, unknown>;
  const phone = (pick<Record<string, unknown>>(metadata, ["phone_call"]) ?? {}) as Record<string, unknown>;
  const initCfg = (pick<Record<string, unknown>>(data, ["conversation_initiation_client_data"]) ?? {}) as Record<string, unknown>;
  const dyn = (pick<Record<string, unknown>>(initCfg, ["dynamic_variables"]) ?? {}) as Record<string, unknown>;

  const direction = String(pick<string>(phone, ["direction"]) ?? "outbound").toLowerCase();

  // ── call_initiation_failure: busy / no-answer / failed — record the missed lead ──
  if (type === "call_initiation_failure") {
    const failBody = (pick<Record<string, unknown>>(data, ["metadata.body"]) ?? {}) as Record<string, unknown>;
    const failure_reason = pick<string>(data, ["failure_reason"]) ?? "failed";
    const failDir = String(pick<string>(failBody, ["direction"]) ?? direction).toLowerCase();
    const failPhone = failDir === "inbound"
      ? pick<string>(failBody, ["from_number"])
      : pick<string>(failBody, ["to_number"]);

    const row: Record<string, unknown> = {
      call_id,
      source: "elevenlabs",
      outcome: failure_reason, // busy | no-answer | unknown
      duration_seconds: 0,
      lead_score: 0,
      score_label: "COLD",
      analysis: {
        call_initiation_failure: true,
        failure_reason,
        sip_status_code: failBody.sip_status_code,
        error_reason: failBody.error_reason,
        direction: failDir,
      },
    };
    if (failPhone) row.lead_phone = String(failPhone);

    const { error } = await supabase.from("calls").upsert(row, { onConflict: "call_id" });
    if (error) {
      console.error("[elevenlabs-webhook] failure upsert error", error, row);
      return json({ ok: false, error: error.message }, 500);
    }
    // Mirror a thin lead so missed contacts still surface in /leads.
    if (failPhone) {
      const digits = String(failPhone).replace(/[^\d]/g, "");
      const canonicalPhone = digits ? `+${digits}` : String(failPhone);
      await supabase.from("leads").upsert(
        { phone: canonicalPhone, source: "voice_agent", status: "no_answer", updated_at: new Date().toISOString() },
        { onConflict: "phone" },
      );
    }
    return json({ ok: true, call_id, type, failure_reason });
  }

  // ── post_call_transcription: the answered call ──
  if (type && type !== "post_call_transcription") {
    return json({ ok: true, ignored: type, call_id });
  }

  // Lead = the human side. Outbound: external_number/to_number. Inbound: from_number.
  const lead_phone = direction === "inbound"
    ? pick<string>(phone, ["from_number", "external_number"]) ??
      pick<string>(dyn, ["system__caller_id", "caller_id"])
    : pick<string>(phone, ["external_number", "to_number"]) ??
      pick<string>(dyn, ["system__called_number", "phone", "mobile_number"]);

  const duration_raw = pick<number | string>(metadata, ["call_duration_secs"]);
  const duration_num = duration_raw == null ? null : Number(duration_raw);
  const duration_seconds = Number.isFinite(duration_num as number) ? Math.round(duration_num as number) : null;

  const transcript = normalizeTranscript(pick(data, ["transcript"]));

  const analysisData = (pick<Record<string, unknown>>(data, ["analysis"]) ?? {}) as Record<string, unknown>;
  const summary = pick<string>(analysisData, ["transcript_summary"]);
  const evals = (pick<Record<string, unknown>>(analysisData, ["evaluation_criteria_results"]) ?? {}) as Record<string, unknown>;
  const dcr = (pick<Record<string, unknown>>(analysisData, ["data_collection_results"]) ?? {}) as Record<string, unknown>;
  const call_successful = String(pick<string>(analysisData, ["call_successful"]) ?? "").toLowerCase();

  // Lead attributes — agent-configured data-collection fields (best-effort key names).
  const lead_name = (collected(dcr, ["lead_name", "callee_name", "name", "customer_name"]) as string) ??
    (pick<string>(dyn, ["user_name", "lead_name", "name"]));
  const project_val = collected(dcr, ["project_interest", "project", "interested_project"]);
  const project = project_val ? String(project_val) : null;
  const language = pick<string>(initCfg, ["conversation_config_override.agent.language"]) ??
    (collected(dcr, ["language", "language_spoken"]) as string | null);
  const timeline = collected(dcr, ["timeline", "purchase_timeline"]);
  const budget = collected(dcr, ["budget", "budget_range"]);
  const intentRaw = collected(dcr, ["intent", "buyer_type", "use_type"]);
  const intent = String(intentRaw ?? "").toLowerCase();
  const siteVisit = collected(dcr, ["site_visit_booked", "appointment_booked", "follow_up_booked"]) === true;

  // Heuristic lead_score — ElevenLabs returns no numeric score.
  let lead_score: number | null = null;
  {
    let s = 30;
    if (call_successful === "success") s += 15;
    else if (call_successful === "failure") s -= 10;
    // Evaluation criteria: each { result: "success"|"failure", rationale }.
    const evalVals = Object.values(evals) as Array<Record<string, unknown>>;
    const passed = evalVals.filter((e) => String(e?.result ?? "").toLowerCase() === "success").length;
    s += Math.min(20, passed * 7);
    if (/site_visit|buying|purchase|end_use|investment|interested/.test(intent)) s += 10;
    if (siteVisit) s += 25;
    const tl = String(timeline ?? "").toLowerCase();
    if (tl.includes("immediate") || tl.includes("month")) s += 10;
    if (typeof budget === "string" && budget.trim()) s += 5;
    lead_score = Math.max(0, Math.min(100, s));
  }

  const analysis: Record<string, unknown> = {
    call_successful,
    evaluation_criteria_results: Object.keys(evals).length ? evals : undefined,
    data_collection_results: Object.keys(dcr).length ? dcr : undefined,
    direction,
    agent_id: pick(data, ["agent_id"]),
    termination_reason: pick(metadata, ["termination_reason"]) || undefined,
  };

  const row: Record<string, unknown> = { call_id, source: "elevenlabs" };
  const set = (k: string, v: unknown) => {
    if (v === null || v === undefined) return;
    if (typeof v === "string" && v.trim() === "") return;
    if (Array.isArray(v) && v.length === 0) return;
    row[k] = v;
  };
  set("lead_name", lead_name);
  set("lead_phone", lead_phone);
  set("project", project);
  set("duration_seconds", duration_seconds);
  set("outcome", call_successful || "completed");
  set("transcript", transcript);
  set("summary", summary);
  set("language", language);
  row.lead_score = lead_score;
  row.score_label = scoreLabel(lead_score);
  row.analysis = analysis;

  const { error } = await supabase.from("calls").upsert(row, { onConflict: "call_id" });
  if (error) {
    console.error("[elevenlabs-webhook] supabase error", error, "row=", row);
    return json({ ok: false, error: error.message }, 500);
  }

  // ── Mirror into leads CRM (canonical +E.164, dedupes legacy unprefixed) ──
  if (lead_phone) {
    let status: string | null = null;
    if (siteVisit) status = "booked";
    else if (lead_score != null && lead_score >= 60) status = "qualified";

    const digits = String(lead_phone).replace(/[^\d]/g, "");
    const canonicalPhone = digits ? `+${digits}` : String(lead_phone);
    const legacyPhone = canonicalPhone.replace(/^\+/, "");
    if (legacyPhone && legacyPhone !== canonicalPhone) {
      const { data: legacyRow } = await supabase
        .from("leads").select("id").eq("phone", legacyPhone).maybeSingle();
      if (legacyRow) await supabase.from("leads").delete().eq("phone", legacyPhone);
    }

    const buyer_type =
      /end_use|self_use/.test(intent) ? "end_use" :
      /investment/.test(intent) ? "investment" : null;

    const leadRow: Record<string, unknown> = {
      phone: canonicalPhone,
      source: "voice_agent",
      updated_at: new Date().toISOString(),
    };
    const setLead = (k: string, v: unknown) => {
      if (v === null || v === undefined) return;
      if (typeof v === "string" && (!v.trim() || v === "unclear")) return;
      leadRow[k] = v;
    };
    setLead("name", lead_name);
    setLead("project", project);
    setLead("buyer_type", buyer_type);
    setLead("timeline", timeline);
    setLead("budget", budget);
    leadRow.lead_score = lead_score;
    leadRow.score_label = scoreLabel(lead_score);
    if (status) leadRow.status = status;

    const { error: leadErr } = await supabase.from("leads").upsert(leadRow, { onConflict: "phone" });
    if (leadErr) console.error("[elevenlabs-webhook] leads upsert error", leadErr, "row=", leadRow);
  }

  return json({ ok: true, call_id });
});
