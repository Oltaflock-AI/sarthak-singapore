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

// Authoritative booking truth from the post-call transcript's tool results.
// A site visit counts as booked ONLY when the cal.com booking tool actually
// returned a real booking uid — never the agent's `site_visit_booked`
// data-collection guess, which fires on mere intent or failed attempts.
// booked=false when unverifiable: we never invent the fact.
function bookingFromTranscript(
  raw: unknown,
): { booked: boolean; startUtc: string | null; uid: string | null } {
  const out = { booked: false, startUtc: null as string | null, uid: null as string | null };
  if (!Array.isArray(raw)) return out;
  for (const turn of raw as Array<Record<string, unknown>>) {
    const results = turn?.tool_results;
    for (const r of (Array.isArray(results) ? results : []) as Array<Record<string, unknown>>) {
      const name = String(r?.tool_name ?? "").toLowerCase();
      if (!name.includes("cal") || !name.includes("book")) continue;
      if (r?.is_error) continue;
      try {
        const parsed = typeof r?.result_value === "string"
          ? JSON.parse(r.result_value as string)
          : r?.result_value;
        const d = (parsed as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
        if (d?.uid) {
          out.booked = true;
          out.uid = String(d.uid);
          out.startUtc = d?.start ? String(d.start) : null;
        }
      } catch { /* leave as not-booked */ }
    }
  }
  return out;
}

// data_collection_results entries are { value, rationale, ... }. Unwrap the value.
function collected(dcr: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const entry: unknown = dcr[k];
    if (entry && typeof entry === "object" && "value" in entry) {
      const v = (entry as Record<string, unknown>).value;
      if (v !== undefined && v !== null && v !== "") return v;
    } else if (entry !== undefined && entry !== null && entry !== "") {
      return entry; // already a scalar
    }
  }
  return null;
}

// Did the agent hand this call to a human? True when the transfer_to_number
// system tool fired (same tool-result scan as bookingFromTranscript) or the
// call terminated via transfer.
function transferredFromTranscript(raw: unknown, terminationReason = ""): boolean {
  if (/transfer/i.test(terminationReason)) return true;
  if (!Array.isArray(raw)) return false;
  for (const turn of raw as Array<Record<string, unknown>>) {
    const results = turn?.tool_results;
    for (const r of (Array.isArray(results) ? results : []) as Array<Record<string, unknown>>) {
      if (String(r?.tool_name ?? "").toLowerCase().includes("transfer") && !r?.is_error) return true;
    }
  }
  return false;
}

// Best-effort "why" for the handoff brief, from the caller's own words.
function transferReason(transcript: TranscriptTurn[]): string {
  let said = transcript
    .filter((t) => /user|caller|customer|lead|human/i.test(`${t.speaker} ${t.side}`))
    .map((t) => t.text.toLowerCase()).join(" ");
  if (!said.trim()) said = transcript.map((t) => t.text.toLowerCase()).join(" ");
  const price = /price|rate|cost|budget|lakh|crore|प्राइस|रेट|कीमत|दाम|बजट|कितने|कितना/.test(said);
  const timeline = /possession|timeline|ready|complete|पजेशन|तैयार|रेडी|कब तक|कब बन/.test(said);
  if (price && timeline) return "Pricing & possession timeline";
  if (price) return "Pricing / rate";
  if (timeline) return "Possession / timeline";
  return "Wants to speak with the team";
}

const dash = (v: string) => (v && v.trim() ? v.trim() : "—");

// Display an Indian number as +91XXXXXXXXXX (last 10 digits), or "—" if empty.
function dispPhone(raw: string): string {
  const d = (raw || "").replace(/\D/g, "");
  return d ? "+91" + d.slice(-10) : "—";
}

// Format a UTC ISO instant as a readable IST string, e.g. "Sun, 12 Jul 2026, 4:30 PM IST".
function formatWhenIST(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + 330 * 60_000); // shift to IST, then read UTC fields
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let h = d.getUTCHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return `${days[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${h}:${mm} ${ampm} IST`;
}

// Low-level Interakt (WhatsApp BSP) template send. Recipient is normalised to a
// 10-digit +91 number. Non-fatal: a WhatsApp failure must never break call
// recording, so this only logs on error. `tag` labels the log line.
async function sendInteraktMessage(
  to: string,
  templateName: string,
  bodyValues: string[],
  tag = "whatsapp",
): Promise<void> {
  const key = Deno.env.get("INTERAKT_API_KEY");
  const num = (to || "").replace(/\D/g, "").slice(-10);
  if (!key || num.length !== 10) {
    console.warn(`[${tag}] missing INTERAKT_API_KEY or valid recipient — skipping WhatsApp`);
    return;
  }
  const payload = {
    countryCode: "+91",
    phoneNumber: num,
    type: "Template",
    template: { name: templateName, languageCode: "en", bodyValues },
  };
  try {
    const res = await fetch("https://api.interakt.ai/v1/public/message/", {
      method: "POST",
      headers: { Authorization: `Basic ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j?.result === false) {
      console.error(`[${tag}] Interakt send failed`, res.status, JSON.stringify(j).slice(0, 300));
    } else {
      console.log(`[${tag}] Interakt sent to`, num, JSON.stringify(j).slice(0, 200));
    }
  } catch (e) {
    console.error(`[${tag}] Interakt error`, String(e));
  }
}

// Send the sales team a WhatsApp brief via Interakt, using the approved
// lead_transfer_alert template (6 body vars: name, phone, project, reason,
// budget, timeline). Recipient by project — one manager per project as they grow.
async function sendInteraktHandoff(p: {
  name: string; phone: string; project: string; reason: string; budget: string; timeline: string;
}): Promise<void> {
  const byProject: Record<string, string | undefined> = {
    "Singapore Miracle": Deno.env.get("WHATSAPP_HANDOFF_MIRACLE"),
    "Singapore One Street": Deno.env.get("WHATSAPP_HANDOFF_ONE_STREET"),
    "The Grand Virasat": Deno.env.get("WHATSAPP_HANDOFF_VIRASAT"),
  };
  const to = byProject[p.project] ?? Deno.env.get("WHATSAPP_HANDOFF_DEFAULT") ?? "";
  await sendInteraktMessage(
    to,
    Deno.env.get("WHATSAPP_HANDOFF_TEMPLATE") ?? "lead_transfer_alert",
    [dash(p.name), dash(p.phone), dash(p.project), dash(p.reason), dash(p.budget), dash(p.timeline)],
    "handoff",
  );
}

// On a CONFIRMED site-visit booking (real cal.com uid), WhatsApp BOTH parties,
// each with its own approved template:
//   • sales team → ai_ssg_site_visit_booked      (Lead, Phone, Project, When, Status)
//   • the client → aiclient_ssg_sitevisit_booked (Name, Project, When, Member, Contact)
// The client is messaged on their own lead phone; the sales recipient and the
// "team member" name/contact shown to the client come from env (falling back to
// the existing handoff number). Non-fatal.
async function sendSiteVisitWhatsApps(p: {
  name: string; phone: string; project: string; whenText: string;
}): Promise<void> {
  const salesTo =
    Deno.env.get("WHATSAPP_SITEVISIT_SALES") ??
    Deno.env.get("WHATSAPP_HANDOFF_MIRACLE") ??
    Deno.env.get("WHATSAPP_HANDOFF_DEFAULT") ??
    "";
  const memberName = Deno.env.get("SITEVISIT_SALES_NAME") ?? "Sarthak Singapore team";
  const memberContact =
    Deno.env.get("SITEVISIT_SALES_CONTACT") ??
    Deno.env.get("WHATSAPP_SITEVISIT_SALES") ??
    Deno.env.get("WHATSAPP_HANDOFF_MIRACLE") ??
    "";

  // 1) Sales team notification.
  await sendInteraktMessage(
    salesTo,
    Deno.env.get("WHATSAPP_SITEVISIT_SALES_TEMPLATE") ?? "ai_ssg_site_visit_booked",
    [dash(p.name), dispPhone(p.phone), dash(p.project), dash(p.whenText), "Confirmed"],
    "sitevisit-sales",
  );

  // 2) Client confirmation (to the lead's own number).
  await sendInteraktMessage(
    p.phone,
    Deno.env.get("WHATSAPP_SITEVISIT_CLIENT_TEMPLATE") ?? "aiclient_ssg_sitevisit_booked",
    [dash(p.name), dash(p.project), dash(p.whenText), dash(memberName), dispPhone(memberContact)],
    "sitevisit-client",
  );
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

  // Only store calls from THIS dashboard's agents. Other agents in the same
  // ElevenLabs workspace share this workspace-level post-call webhook, but their
  // calls must not pollute the Sarthak dashboard. ElevenLabs has no per-agent
  // webhook off switch (a null agent override = inherit workspace), so filter here.
  // One agent per property; keep in lockstep with lib/agents.ts. Pinned in code,
  // not env (a stale env broke the 2026-07 migration).
  const SARTHAK_AGENTS: Record<string, string> = {
    agent_6801kwrchx5yfnha0jechj2t67pm: "Singapore Miracle",
    agent_7201kxbkvpsrejxsvjpk0nt94yg6: "Singapore One Street",
    agent_7701kxbkvr04ef19snxed4hzk93e: "The Grand Virasat",
  };
  const incomingAgentId = pick<string>(data, ["agent_id"]);
  if (incomingAgentId && !(incomingAgentId in SARTHAK_AGENTS)) {
    return json({ ok: true, ignored: "other agent", agent_id: incomingAgentId });
  }

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
    const canonicalPhone = failPhone
      ? (() => { const d = String(failPhone).replace(/[^\d]/g, ""); return d ? `+${d}` : String(failPhone); })()
      : null;

    // The call never connected, so there's no transcript to name the lead.
    // Recover the identity we already know: the dialer wrote it onto the
    // call_queue row (keyed by this conversation_id) when it placed the call;
    // dynamic vars in the payload and an existing leads row are fallbacks.
    // Without this every missed call shows on the dashboard as "Unknown caller".
    let failName = pick<string>(dyn, ["lead_name", "user_name", "name"]); // not callee_name (defaults to "ग्राहक")
    let failProject = pick<string>(dyn, ["project"]) ??
      (incomingAgentId ? SARTHAK_AGENTS[incomingAgentId] : undefined);
    const { data: queued } = await supabase
      .from("call_queue").select("lead_name, project").eq("conversation_id", call_id).maybeSingle();
    if (!failName && queued?.lead_name) failName = String(queued.lead_name);
    if (!failProject && queued?.project) failProject = String(queued.project);

    let existingStatus: string | null = null;
    if (canonicalPhone) {
      const { data: lead } = await supabase
        .from("leads").select("name, status").eq("phone", canonicalPhone).maybeSingle();
      if (!failName && lead?.name) failName = String(lead.name);
      existingStatus = (lead?.status as string) ?? null;
    }

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
    if (failName) row.lead_name = failName;
    if (failProject) row.project = failProject;

    const { error } = await supabase.from("calls").upsert(row, { onConflict: "call_id" });
    if (error) {
      console.error("[elevenlabs-webhook] failure upsert error", error, row);
      return json({ ok: false, error: error.message }, 500);
    }
    // Mirror a thin lead so missed contacts still surface in /leads — now with
    // the recovered name. Never downgrade a lead already tracked at a higher
    // status (qualified/booked); only mark no_answer for a brand-new contact.
    if (canonicalPhone) {
      const leadRow: Record<string, unknown> = {
        phone: canonicalPhone,
        source: "voice_agent",
        updated_at: new Date().toISOString(),
      };
      if (failName) leadRow.name = failName;
      if (failProject) leadRow.project = failProject;
      if (!existingStatus) leadRow.status = "no_answer";
      await supabase.from("leads").upsert(leadRow, { onConflict: "phone" });
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
  // One project per agent — derive from the agent id, never from the transcript.
  const project = SARTHAK_AGENTS[incomingAgentId ?? ""] ?? "Singapore Miracle";
  const language = pick<string>(initCfg, ["conversation_config_override.agent.language"]) ??
    (collected(dcr, ["language", "language_spoken"]) as string | null);
  const timeline = collected(dcr, ["timeline", "purchase_timeline"]);
  const budget = collected(dcr, ["budget", "budget_range"]);
  const intentRaw = collected(dcr, ["intent", "buyer_type", "use_type"]);
  const intent = String(intentRaw ?? "").toLowerCase();
  // Booking is authoritative: only a real cal.com tool result counts as booked.
  // The agent's `site_visit_booked` data-collection field is an LLM guess that
  // fires on mere intent or failed attempts, so it's NOT used for the fact.
  const booking = bookingFromTranscript(pick(data, ["transcript"]));
  const siteVisit = booking.booked;
  // Only trust a slot once the booking is confirmed — use cal.com's real start.
  const visitWhen = siteVisit ? booking.startUtc : null;
  const visitWhenIso = (() => {
    if (!visitWhen) return null;
    const ms = Date.parse(visitWhen);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  })();

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

  // Handoff: did the agent transfer the call to a human? Idempotent — a webhook
  // retry must not re-send the WhatsApp, so we flag it on the calls row.
  // Primary signal is ElevenLabs' own features_usage.transfer_to_number.used
  // (authoritative — the transcript may narrate a transfer that never executed);
  // the tool-result / termination scan is a fallback.
  const featuresUsage = (pick<Record<string, unknown>>(metadata, ["features_usage"]) ?? {}) as Record<string, unknown>;
  const transferUsed = (featuresUsage.transfer_to_number as Record<string, unknown> | undefined)?.used === true;
  const transferred = transferUsed || transferredFromTranscript(
    pick(data, ["transcript"]),
    String(pick(metadata, ["termination_reason"]) ?? ""),
  );
  // Idempotency: a webhook retry must not re-send WhatsApp. We flag both the
  // transfer handoff and the site-visit notify on the calls row's analysis.
  const { data: priorCall } = (transferred || siteVisit)
    ? await supabase.from("calls").select("analysis").eq("call_id", call_id).maybeSingle()
    : { data: null };
  const priorAnalysis = (priorCall?.analysis as Record<string, unknown> | undefined) ?? {};
  const alreadyHandedOff = Boolean(priorAnalysis.handoff_sent);
  const alreadySiteVisitNotified = Boolean(priorAnalysis.sitevisit_whatsapp_sent);

  const analysis: Record<string, unknown> = {
    call_successful,
    evaluation_criteria_results: Object.keys(evals).length ? evals : undefined,
    data_collection_results: Object.keys(dcr).length ? dcr : undefined,
    direction,
    agent_id: pick(data, ["agent_id"]),
    termination_reason: pick(metadata, ["termination_reason"]) || undefined,
    handoff_sent: transferred || undefined,
    sitevisit_whatsapp_sent: siteVisit || undefined,
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

  // ── WhatsApp handoff brief to the sales team, only on a real transfer ──
  if (transferred && !alreadyHandedOff) {
    await sendInteraktHandoff({
      name: String(lead_name ?? ""),
      phone: String(lead_phone ?? ""),
      project,
      reason: transferReason(transcript),
      budget: String(budget ?? ""),
      timeline: String(timeline ?? ""),
    });
  }

  // ── Site-visit booked: WhatsApp both the sales team and the client ──
  if (siteVisit && !alreadySiteVisitNotified) {
    await sendSiteVisitWhatsApps({
      name: String(lead_name ?? ""),
      phone: String(lead_phone ?? ""),
      project,
      whenText: formatWhenIST(visitWhen),
    });
  }

  // ── Mirror into leads CRM (canonical +E.164, dedupes legacy unprefixed) ──
  if (lead_phone) {
    const digits = String(lead_phone).replace(/[^\d]/g, "");
    const canonicalPhone = digits ? `+${digits}` : String(lead_phone);
    const legacyPhone = canonicalPhone.replace(/^\+/, "");
    if (legacyPhone && legacyPhone !== canonicalPhone) {
      const { data: legacyRow } = await supabase
        .from("leads").select("id").eq("phone", legacyPhone).maybeSingle();
      if (legacyRow) await supabase.from("leads").delete().eq("phone", legacyPhone);
    }

    // Status is sticky upward (booked > qualified > new): a later non-booking
    // call must never downgrade a lead that already booked a verified visit.
    const { data: existingLead } = await supabase
      .from("leads").select("status").eq("phone", canonicalPhone).maybeSingle();
    const prevStatus = existingLead?.status ?? null;
    let status: string | null = prevStatus;
    if (siteVisit) status = "booked";
    else if (prevStatus !== "booked" && lead_score != null && lead_score >= 60) status = "qualified";

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

    // ── Record the booked site visit so it surfaces in /site-visits ──
    // One row per call, idempotent on retries via the call_id unique key.
    if (siteVisit) {
      const visitRow: Record<string, unknown> = {
        call_id,
        lead_phone: canonicalPhone,
        // A real cal.com booking IS a confirmed appointment — not "pending".
        // ("done" is set later when the visit actually happens; "cancelled" on cancel.)
        status: "confirmed",
        notes: booking.uid ? `Booked via cal.com · ${booking.uid}` : "Booked via voice agent (cal.com)",
      };
      if (lead_name) visitRow.lead_name = lead_name;
      if (project) visitRow.project = project;
      if (visitWhenIso) visitRow.scheduled_for = visitWhenIso;
      if (visitWhen) visitRow.scheduled_for_text = visitWhen;

      const { error: visitErr } = await supabase
        .from("site_visits")
        .upsert(visitRow, { onConflict: "call_id" });
      if (visitErr) console.error("[elevenlabs-webhook] site_visits upsert error", visitErr, "row=", visitRow);
    }
  }

  return json({ ok: true, call_id });
});
