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

// ── Humanizers for the WhatsApp recap message ─────────────────────────────
function humanizeWord(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === "unclear") return null;
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeBudgetMsg(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).toLowerCase().trim();
  const m = s.match(/^(\d+(?:\.\d+)?)[_\s-]*(lakh|lakhs|cr|crore|crores|k)$/i);
  if (m) {
    const n = Number(m[1]);
    const u = m[2].toLowerCase();
    if (u.startsWith("lakh")) return `₹${n} Lakh${n === 1 ? "" : "s"}`;
    if (u.startsWith("cr")) return `₹${n} Crore${n === 1 ? "" : "s"}`;
    if (u === "k") return `₹${n}K`;
  }
  return humanizeWord(v);
}

// Pull a probable site-visit date/time line from action_items if present.
function extractSiteVisitWhen(actionItems: unknown): string | null {
  if (!Array.isArray(actionItems)) return null;
  for (const item of actionItems) {
    if (typeof item !== "string") continue;
    if (/site visit|site-visit|visit/i.test(item)) {
      // Strip prefix like "Schedule site visit for "
      const cleaned = item.replace(/^(schedule|book|confirm)[a-z\s-]*site[\s-]*visit[\s-]*(for|on)?\s*/i, "").trim();
      return cleaned || item;
    }
  }
  return null;
}

function composeRecap(args: {
  name: string | null;
  project: string | null;
  summary: string | null;
  clientAnalysis: Record<string, unknown>;
  platformAnalysis: Record<string, unknown>;
}): string {
  const firstName = args.name ? args.name.split(/\s+/)[0] : "there";
  const greeting = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  const projectName = humanizeWord(args.project ?? args.clientAnalysis.project_interest);
  const siteVisitBooked = args.clientAnalysis.site_visit_booked === true ||
    args.platformAnalysis.classification === "site_visit_booked";
  const visitWhen = extractSiteVisitWhen(args.platformAnalysis.action_items);
  const address = Deno.env.get("SITE_VISIT_ADDRESS") ?? "Grand Virasat, Mhow Main Road, Indore 453441";

  const lines: string[] = [];
  lines.push(`Hi ${greeting},`);
  lines.push("");

  if (siteVisitBooked) {
    lines.push(visitWhen ? `✅ Site visit confirmed — ${visitWhen}` : "✅ Site visit confirmed");
    lines.push(`📍 ${address}`);
    lines.push("");
  }

  if (args.summary) {
    lines.push("Quick recap of our call:");
    lines.push(args.summary);
    lines.push("");
  } else if (projectName) {
    lines.push(`Thanks for your interest in ${projectName}.`);
    lines.push("");
  }

  lines.push(siteVisitBooked
    ? "We'll send directions and a reminder before the visit. Reply here with any questions."
    : "Reply here anytime if you have questions or want to book a site visit.");
  lines.push("");
  lines.push("— Sarthak Singapore Team");

  return lines.join("\n");
}

async function sendWhatsAppRecap(args: {
  phone: string;
  name: string | null;
  project: string | null;
  summary: string | null;
  analysis: Record<string, unknown>;
  clientAnalysis: Record<string, unknown>;
  platformAnalysis: Record<string, unknown>;
}): Promise<void> {
  const PHONE_ID = Deno.env.get("META_PHONE_NUMBER_ID");
  const TOKEN = Deno.env.get("META_ACCESS_TOKEN");
  if (!PHONE_ID || !TOKEN) {
    console.warn("[ringg-webhook] WA recap skipped — META env vars missing");
    return;
  }

  const message = composeRecap({
    name: args.name,
    project: args.project,
    summary: args.summary,
    clientAnalysis: args.clientAnalysis,
    platformAnalysis: args.platformAnalysis,
  });

  const toNumber = args.phone.replace(/^\+/, "");

  // Dedupe: skip if this exact recap already sent to this phone in last 24h.
  // Guards against Ringg retrying the all_processing_completed event.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: prior } = await supabase
    .from("wa_messages")
    .select("id")
    .eq("from_number", toNumber)
    .eq("text_out", message)
    .gte("created_at", since)
    .limit(1)
    .maybeSingle();
  if (prior) {
    console.log("[ringg-webhook] WA recap already sent, skipping duplicate", { to: toNumber });
    return;
  }

  const resp = await fetch(`https://graph.facebook.com/v25.0/${PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toNumber,
      type: "text",
      text: { body: message, preview_url: false },
    }),
  });

  const respBody = await resp.text();
  if (!resp.ok) {
    console.error("[ringg-webhook] WA send failed", resp.status, respBody);
    return;
  }

  let waId: string | null = null;
  try {
    const parsed = JSON.parse(respBody) as { messages?: Array<{ id?: string }> };
    waId = parsed?.messages?.[0]?.id ?? null;
  } catch { /* ignore */ }

  // Log to wa_messages so the conversation history shows the recap
  await supabase.from("wa_messages").insert({
    wa_id: waId,
    from_number: toNumber,
    name: args.name,
    text_in: null,
    text_out: message,
  });

  console.log("[ringg-webhook] WA recap sent", { to: toNumber, wa_id: waId });
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

  // NOTE: No webhook secret check. Ringg.ai does NOT support custom webhook
  // headers and does not sign payloads (see CLAUDE.md), so an X-Webhook-Secret
  // gate rejects every real call with 401 and silently drops all call data.
  // Do NOT re-add a RINGG_WEBHOOK_SECRET header check here.

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

  // ── Also upsert into leads CRM table so voice leads show in /leads ──
  if (lead_phone) {
    const intent = String(client_analysis.intent ?? "").toLowerCase();
    const buyer_type =
      intent === "end_use" || intent === "self_use" ? "end_use" :
      intent === "investment" ? "investment" : null;

    let status: string | null = null;
    if (client_analysis.site_visit_booked === true || platform_analysis.classification === "site_visit_booked") {
      status = "booked";
    } else if (lead_score != null && lead_score >= 60) {
      status = "qualified";
    }

    // Canonicalize phone to `+E.164` so the same contact across WhatsApp
    // (digits-only) and Ringg (+E.164) collapses to one lead row.
    const digits = String(lead_phone).replace(/[^\d]/g, "");
    const canonicalPhone = digits ? `+${digits}` : lead_phone;
    const legacyPhone = canonicalPhone.replace(/^\+/, "");

    // If a row exists under the legacy unprefixed key, delete it so the
    // canonical upsert doesn't create a duplicate.
    if (legacyPhone && legacyPhone !== canonicalPhone) {
      const { data: legacyRow } = await supabase
        .from("leads")
        .select("id")
        .eq("phone", legacyPhone)
        .maybeSingle();
      if (legacyRow) {
        await supabase.from("leads").delete().eq("phone", legacyPhone);
      }
    }

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
    setLead("timeline", client_analysis.timeline);
    setLead("budget", client_analysis.budget_range);
    if (lead_score != null) {
      leadRow.lead_score = lead_score;
      leadRow.score_label = scoreLabel(lead_score);
    }
    if (status) leadRow.status = status;

    const { error: leadErr } = await supabase.from("leads").upsert(leadRow, { onConflict: "phone" });
    if (leadErr) console.error("[ringg-webhook] leads upsert error", leadErr, "row=", leadRow);
  }

  // ── Send WhatsApp recap after final processing event ──
  // Fires only once per call (gated on event_type === all_processing_completed).
  if (event_type === "all_processing_completed" && lead_phone) {
    try {
      await sendWhatsAppRecap({
        phone: lead_phone,
        name: lead_name,
        project: project,
        summary,
        analysis,
        clientAnalysis: client_analysis,
        platformAnalysis: platform_analysis,
      });
    } catch (e) {
      console.error("[ringg-webhook] whatsapp recap failed", e);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, call_id }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
