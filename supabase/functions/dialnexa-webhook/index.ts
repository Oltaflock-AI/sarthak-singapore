// Supabase Edge Function: dialnexa-webhook
// Receives DialNexa post-call webhook events and upserts into `calls` + `leads`.
// Deploy: supabase functions deploy dialnexa-webhook --no-verify-jwt --project-ref yhwoqmhnvzpfgacfaidg
// URL:    https://yhwoqmhnvzpfgacfaidg.functions.supabase.co/dialnexa-webhook
//
// Auth: DialNexa signs every POST with HMAC-SHA256 (header `X-DialNexa-Signature`).
// Docs conflict on WHAT is signed (raw body vs inner `payload` object) and on the
// header format (`sha256=<hex>` vs bare `<hex>`), so we accept ANY of those forms.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type TranscriptTurn = { speaker: string; time: string; text: string; side: string };

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const WEBHOOK_SECRET = Deno.env.get("DIALNEXA_WEBHOOK_SECRET") ?? "";

// ── HMAC-SHA256 helpers (Web Crypto; Deno has no node:crypto timingSafeEqual) ──
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

// Verify against every documented signing scheme. Returns true if any matches.
async function verifySignature(rawBody: string, header: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) return true; // no secret configured → open (set the env var to enforce)
  if (!header) return false;
  const received = header.startsWith("sha256=") ? header.slice(7) : header;

  // Scheme A: HMAC over the raw request body.
  const overRaw = await hmacHex(WEBHOOK_SECRET, rawBody);
  if (constantTimeEqual(received, overRaw)) return true;

  // Scheme B: HMAC over the JSON-stringified inner `payload` object only.
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && "payload" in parsed) {
      const overPayload = await hmacHex(WEBHOOK_SECRET, JSON.stringify(parsed.payload));
      if (constantTimeEqual(received, overPayload)) return true;
    }
  } catch { /* fall through */ }

  return false;
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

// DialNexa transcript arrives as a "Agent: ..\nUser: .." string, an array of
// {role,text} turns, or a flat {Agent: "..", User: ".."} object. Normalize all.
function normalizeTranscript(raw: unknown): TranscriptTurn[] {
  if (!raw) return [];
  const sideOf = (s: string) => (/agent|assistant|bot/i.test(s) ? "agent" : "user");

  if (typeof raw === "string") {
    return raw.split(/\r?\n/).filter(Boolean).map((line) => {
      const m = line.match(/^\s*(agent|user|assistant|caller|bot|customer)\s*[:\-]\s*(.+)$/i);
      const speaker = m ? m[1] : "speaker";
      const text = m ? m[2] : line;
      return { speaker, time: "", text, side: sideOf(speaker) };
    });
  }
  if (Array.isArray(raw)) {
    return raw.map((t: Record<string, unknown>) => {
      const speaker = String(t.role ?? t.speaker ?? t.from ?? "speaker");
      const text = String(t.text ?? t.message ?? t.content ?? "");
      return { speaker, time: String(t.time ?? t.timestamp ?? ""), text, side: sideOf(speaker) };
    });
  }
  if (typeof raw === "object") {
    // {Agent: "..", User: ".."} — role-keyed object (lossy, one turn each).
    return Object.entries(raw as Record<string, unknown>).map(([speaker, text]) => ({
      speaker,
      time: "",
      text: String(text ?? ""),
      side: sideOf(speaker),
    }));
  }
  return [];
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dialnexa-signature",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method === "GET") return json({ ok: true, service: "dialnexa-webhook" });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: corsHeaders });

  // Read raw body FIRST — signature is computed over it.
  const rawBody = await req.text();
  const signature = req.headers.get("x-dialnexa-signature") ?? "";

  if (!(await verifySignature(rawBody, signature))) {
    console.warn("[dialnexa-webhook] signature mismatch");
    return json({ ok: false, error: "invalid signature" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }

  console.log("[dialnexa-webhook] received", rawBody);

  const event_type = pick<string>(body, ["event_type", "event"]);
  // Everything useful lives under payload.call. Fall back to top-level for safety.
  const payload = (pick<Record<string, unknown>>(body, ["payload"]) ?? body) as Record<string, unknown>;
  const call = (pick<Record<string, unknown>>(payload, ["call"]) ?? payload) as Record<string, unknown>;
  const call_transfer = pick<Record<string, unknown>>(payload, ["call_transfer"]);

  const call_id = pick<string>(call, ["id", "call_id"]);
  if (!call_id) return json({ ok: false, error: "missing call id" }, 400);

  const status = pick<string>(call, ["status"]);
  const direction = (pick<string>(call, ["direction"]) ?? "outbound").toLowerCase();

  // We only persist completed calls. Acknowledge the rest with 200 so DialNexa
  // doesn't retry (call_initiated / hangup / transfer carry no durable data yet).
  if (event_type && event_type !== "call_ended" && event_type !== "call.completed") {
    return json({ ok: true, ignored: event_type, call_id });
  }
  if (status && status !== "completed") {
    return json({ ok: true, ignored_status: status, call_id });
  }

  // Lead = the human side. Outbound: we dial them (to_number). Inbound: they call us (from_number).
  const lead_phone = direction === "inbound"
    ? pick<string>(call, ["from_number"])
    : pick<string>(call, ["to_number"]);

  const duration_raw = pick<number | string>(call, ["duration_in_seconds", "duration_seconds", "duration"]);
  const duration_num = duration_raw == null ? null : Number(duration_raw);
  const duration_seconds = Number.isFinite(duration_num as number) ? Math.round(duration_num as number) : null;

  const outcome = pick<string>(call, ["status", "hangup_reason", "disconnection_reason"]);
  const transcript = normalizeTranscript(pick(call, ["transcript", "messages", "conversation"]));
  const summary = pick<string>(call, ["summary", "post_call_analysis.summary"]);
  const recording_url = pick<string>(call, ["recording_url"]);

  const pca = (pick<Record<string, unknown>>(call, ["post_call_analysis", "analysis"]) ?? {}) as Record<string, unknown>;

  // Name/project aren't first-class webhook fields — pull from post-call analysis if the agent extracts them.
  const lead_name = pick<string>(call, ["lead_name"]) ??
    pick<string>(pca, ["callee_name", "name", "customer_name", "lead_name"]);
  const project_raw = pick<string>(pca, ["project_interest", "project", "interested_project"]);
  const project = project_raw ? String(project_raw) : null;
  const language = pick<string>(pca, ["language_spoken", "language"]);

  // Heuristic lead_score — DialNexa returns no numeric score.
  let lead_score: number | null = null;
  if (Object.keys(pca).length > 0) {
    let s = 30;
    const sentiment = String(pca.sentiment ?? "").toLowerCase();
    if (sentiment === "positive") s += 20;
    else if (sentiment === "negative") s -= 10;
    const intent = String(pca.intent ?? "").toLowerCase();
    if (/site_visit|buying|purchase|end_use|investment|interested/.test(intent)) s += 15;
    const resolution = String(pca.resolution ?? "").toLowerCase();
    if (/resolved|booked|qualified/.test(resolution)) s += 10;
    if (pca.qualified === true) s += 20;
    if (pca.site_visit_booked === true || pca.follow_up_booked === true || pca.appointment_booked === true) s += 25;
    const tl = String(pca.timeline ?? "").toLowerCase();
    if (tl.includes("immediate") || tl.includes("month")) s += 10;
    if (typeof pca.budget_range === "string" && pca.budget_range.trim()) s += 5;
    lead_score = Math.max(0, Math.min(100, s));
  }

  // Merged analysis blob.
  const analysis: Record<string, unknown> = {
    ...pca,
    ...(recording_url ? { recording_url } : {}),
    ...(call_transfer ? { call_transfer } : {}),
    direction,
    hangup_reason: pick(call, ["hangup_reason", "disconnection_reason"]) ?? undefined,
  };
  const hasAnalysis = Object.values(analysis).some((v) => v !== undefined && v !== null);

  // Build row with ONLY non-empty fields (idempotent upsert; never nuke prior data).
  const row: Record<string, unknown> = { call_id, source: "dialnexa" };
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
  set("outcome", outcome);
  set("transcript", transcript);
  set("summary", summary);
  set("language", language);
  if (lead_score != null) {
    row.lead_score = lead_score;
    row.score_label = scoreLabel(lead_score);
  }
  if (hasAnalysis) row.analysis = analysis;

  const { error } = await supabase.from("calls").upsert(row, { onConflict: "call_id" });
  if (error) {
    console.error("[dialnexa-webhook] supabase error", error, "row=", row);
    return json({ ok: false, error: error.message }, 500);
  }

  // ── Mirror into leads CRM table so voice leads show in /leads ──
  if (lead_phone) {
    let leadStatus: string | null = null;
    if (pca.site_visit_booked === true || pca.appointment_booked === true || pca.follow_up_booked === true) {
      leadStatus = "booked";
    } else if (lead_score != null && lead_score >= 60) {
      leadStatus = "qualified";
    }

    // Canonicalize to +E.164 so the same contact collapses to one lead row.
    const digits = String(lead_phone).replace(/[^\d]/g, "");
    const canonicalPhone = digits ? `+${digits}` : String(lead_phone);
    const legacyPhone = canonicalPhone.replace(/^\+/, "");
    if (legacyPhone && legacyPhone !== canonicalPhone) {
      const { data: legacyRow } = await supabase
        .from("leads").select("id").eq("phone", legacyPhone).maybeSingle();
      if (legacyRow) await supabase.from("leads").delete().eq("phone", legacyPhone);
    }

    const intent = String(pca.intent ?? "").toLowerCase();
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
    setLead("timeline", pca.timeline);
    setLead("budget", pca.budget_range);
    if (lead_score != null) {
      leadRow.lead_score = lead_score;
      leadRow.score_label = scoreLabel(lead_score);
    }
    if (leadStatus) leadRow.status = leadStatus;

    const { error: leadErr } = await supabase.from("leads").upsert(leadRow, { onConflict: "phone" });
    if (leadErr) console.error("[dialnexa-webhook] leads upsert error", leadErr, "row=", leadRow);
  }

  return json({ ok: true, call_id });
});
