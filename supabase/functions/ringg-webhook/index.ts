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

  const call_id = pick<string>(body, [
    "call_id", "callId", "id", "data.call_id", "data.id", "conversation_id",
  ]);

  const lead_name = pick<string>(body, [
    "custom_analysis_data.lead_name", "analysis.lead_name", "analytics.lead_name",
    "lead_name", "name", "customer_name", "contact_name", "callee_name",
    "metadata.lead_name", "metadata.name", "variables.name", "data.lead_name",
    "custom_variables.name", "custom_variables.lead_name", "custom_variables.callee_name",
  ]);

  const lead_phone = pick<string>(body, [
    "lead_phone", "phone", "phone_number", "to", "to_number", "customer_phone",
    "customer_number", "called_number", "callee_number", "mobile_number",
    "metadata.phone", "variables.phone", "data.phone",
    "custom_variables.phone", "custom_variables.lead_phone", "custom_variables.mobile_number",
  ]);

  const project = pick<string>(body, [
    "custom_analysis_data.project_interest", "analysis.project_interest",
    "project", "project_interest",
    "metadata.project", "variables.project", "data.project",
    "custom_variables.project_interest",
  ]);

  const source = pick<string>(body, [
    "source", "metadata.source", "variables.source", "data.source", "channel",
  ]);

  const lead_score_raw = pick<number | string>(body, [
    "custom_analysis_data.lead_score", "analysis.lead_score", "analytics.lead_score",
    "lead_score", "score", "metadata.score", "analytics.score", "data.score",
  ]);
  const lead_score_num = lead_score_raw == null ? null : Number(lead_score_raw);
  const lead_score = Number.isFinite(lead_score_num as number) ? lead_score_num : null;

  const duration_raw = pick<number | string>(body, [
    "call_duration", "duration_seconds", "duration", "data.duration",
  ]);
  const duration_num = duration_raw == null ? null : Number(duration_raw);
  const duration_seconds = Number.isFinite(duration_num as number) ? Math.round(duration_num as number) : null;

  const outcome = pick<string>(body, [
    "outcome", "disposition", "result", "status", "call_status", "data.outcome",
  ]);

  const rawTranscript = pick(body, [
    "transcript", "transcripts", "messages", "conversation", "data.transcript",
  ]);
  const transcript = normalizeTranscript(rawTranscript);

  const summary = pick<string>(body, [
    "custom_analysis_data.call_summary", "analysis.call_summary",
    "summary", "call_summary", "data.summary",
  ]);

  const language = pick<string>(body, [
    "custom_analysis_data.language_spoken", "analysis.language_spoken",
    "language", "language_spoken",
  ]);

  const analysisRaw = pick<Record<string, unknown>>(body, [
    "custom_analysis_data", "analysis", "analytics",
  ]);
  const analysis = analysisRaw && typeof analysisRaw === "object" ? analysisRaw : null;

  const row: Record<string, unknown> = {
    call_id,
    lead_name,
    lead_phone,
    project,
    source,
    lead_score,
    score_label: scoreLabel(lead_score),
    duration_seconds,
    outcome,
    summary,
    language,
    transcript,
    analysis,
  };

  const { error } = call_id
    ? await supabase.from("calls").upsert(row, { onConflict: "call_id" })
    : await supabase.from("calls").insert(row);

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
