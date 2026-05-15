// Supabase Edge Function: ringg-webhook
// Receives Ringg.ai post-call payloads and upserts into `calls` table.
// Deploy: supabase functions deploy ringg-webhook --no-verify-jwt
// URL:    https://<project-ref>.functions.supabase.co/ringg-webhook

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type TranscriptTurn = { speaker: string; time: string; text: string; side: string };

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

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

function normalizeTranscript(raw: unknown): TranscriptTurn[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    return raw.split(/\r?\n/).filter(Boolean).map((line) => {
      const m = line.match(/^\s*(agent|user|assistant|caller|bot|customer)\s*[:\-]\s*(.+)$/i);
      const speaker = m ? m[1] : "speaker";
      const text = m ? m[2] : line;
      const side = /agent|assistant|bot/i.test(speaker) ? "agent" : "user";
      return { speaker, time: "", text, side };
    });
  }
  if (Array.isArray(raw)) {
    return raw.map((t: Record<string, unknown>) => {
      // Ringg shorthand: {bot: "..."} or {user: "..."}
      let speaker: string;
      let text: string;
      if (typeof t.bot === "string") { speaker = "bot"; text = t.bot; }
      else if (typeof t.user === "string") { speaker = "user"; text = t.user; }
      else if (typeof t.agent === "string") { speaker = "agent"; text = t.agent; }
      else {
        speaker = String(t.speaker ?? t.role ?? t.from ?? "speaker");
        text = String(t.text ?? t.message ?? t.content ?? "");
      }
      const time = String(t.time ?? t.timestamp ?? "");
      const side = /agent|assistant|bot/i.test(speaker) ? "agent" : "user";
      return { speaker, time, text, side };
    });
  }
  return [];
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ ok: true, service: "ringg-webhook" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: corsHeaders });
  }

  const expectedSecret = Deno.env.get("RINGG_WEBHOOK_SECRET");
  if (expectedSecret) {
    const got = req.headers.get("x-webhook-secret");
    if (got !== expectedSecret) {
      console.warn("[ringg-webhook] unauthorized — bad/missing X-Webhook-Secret");
      return new Response(
        JSON.stringify({ ok: false, error: "unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "invalid json" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  console.log("[ringg-webhook] received", JSON.stringify(body));

  const call_id = pick<string>(body, ["call_id", "callId", "id", "data.call_id"]);
  if (!call_id) {
    return new Response(
      JSON.stringify({ ok: false, error: "missing call_id" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const event_type = pick<string>(body, ["event_type"]);

  // Ringg emits 6 events per call. Each carries different slices of data.
  // client_analysis / platform_analysis live either at top-level (all_processing_completed)
  // or under analysis_data (client_analysis_completed / platform_analysis_completed).
  const client_analysis = (pick<Record<string, unknown>>(body, [
    "client_analysis",
    event_type === "client_analysis_completed" ? "analysis_data" : "__nope__",
  ]) ?? {}) as Record<string, unknown>;

  const platform_analysis = (pick<Record<string, unknown>>(body, [
    "platform_analysis",
    event_type === "platform_analysis_completed" ? "analysis_data" : "__nope__",
  ]) ?? {}) as Record<string, unknown>;

  const custom_args = (pick<Record<string, unknown>>(body, ["custom_args_values"]) ?? {}) as Record<string, unknown>;

  const lead_name = pick<string>(body, [
    "client_analysis.callee_name", "custom_args_values.callee_name",
  ]) ?? (client_analysis.callee_name as string | undefined) ?? null;

  const lead_phone = pick<string>(body, [
    "to_number", "custom_args_values.mobile_number",
  ]) ?? null;

  const project_raw = pick<string>(body, [
    "client_analysis.project_interest", "custom_args_values.project_interest",
  ]);
  const project = project_raw ? String(project_raw) : null;

  const duration_raw = pick<number | string>(body, ["call_duration", "recording_duration", "duration"]);
  const duration_num = duration_raw == null ? null : Number(duration_raw);
  const duration_seconds = Number.isFinite(duration_num as number) ? Math.round(duration_num as number) : null;

  const outcome = pick<string>(body, ["status", "outcome"]);

  const rawTranscript = pick(body, ["transcript", "messages", "conversation"]);
  const transcript = normalizeTranscript(rawTranscript);

  const summary = pick<string>(body, [
    "client_analysis.call_summary", "platform_analysis.summary",
  ]);

  const language = pick<string>(body, ["client_analysis.language_spoken"]);

  const recording_url = pick<string>(body, ["recording_url"]);

  // Heuristic lead_score (Ringg doesn't return one)
  let lead_score: number | null = null;
  if (Object.keys(client_analysis).length > 0 || Object.keys(platform_analysis).length > 0) {
    let s = 30;
    if (client_analysis.site_visit_booked === true) s += 40;
    if (platform_analysis.classification === "site_visit_booked") s += 10;
    const tl = String(client_analysis.timeline ?? "").toLowerCase();
    if (tl.includes("immediate") || tl.includes("month")) s += 15;
    if (typeof client_analysis.budget_range === "string" && client_analysis.budget_range.trim()) s += 10;
    const intent = String(client_analysis.intent ?? "").toLowerCase();
    if (intent === "site_visit" || intent === "buying" || intent === "purchase") s += 5;
    const next = String(client_analysis.next_action ?? "").toLowerCase();
    if (next.includes("hot_transfer") || next.includes("site_visit")) s += 5;
    lead_score = Math.min(100, s);
  }

  // Merged analysis blob — combines client + platform + identifiers + recording
  const analysis: Record<string, unknown> = {
    ...(Object.keys(client_analysis).length ? client_analysis : {}),
    ...(Object.keys(platform_analysis).length
      ? {
          platform_summary: platform_analysis.summary,
          classification: platform_analysis.classification,
          key_points: platform_analysis.key_points,
          action_items: platform_analysis.action_items,
        }
      : {}),
    ...(recording_url ? { recording_url } : {}),
    custom_args: Object.keys(custom_args).length ? custom_args : undefined,
  };
  const hasAnalysis = Object.values(analysis).some((v) => v !== undefined && v !== null);

  // Build row including ONLY non-null fields so later events don't nuke earlier ones.
  const row: Record<string, unknown> = { call_id, source: "ringg" };
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
    console.error("[ringg-webhook] supabase error", error, "row=", row);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ ok: true, call_id }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
