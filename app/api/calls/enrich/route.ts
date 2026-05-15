import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { openai } from "@/lib/openai";

const ENRICH_PROMPT = `Read this Sarthak Singapore voice-call transcript between an AI sales agent and a prospective buyer. Return JSON with:

{
  "lead_name": string | null,
  "project": string | null,    // one of: Grand Virasat, Singapore Pink City, Modern City, Oracle City, One Street, King Estate
  "buyer_type": "end_use" | "investment" | null,
  "residency": "local" | "nri" | null,
  "timeline": string | null,
  "budget": string | null,
  "lead_score": number,        // 0-100
  "score_label": "HOT" | "WARM" | "COLD",
  "summary": string,           // 1-2 sentence English summary
  "outcome": string,           // e.g., "Site visit booked · Saturday 11am", "Qualified · awaiting brochure", "Not interested"
  "language": string | null,   // "hi", "en", "hi-en", etc.
  "site_visit_booked": boolean,
  "next_action": string | null
}

Rules:
- Use null for genuinely unknown fields. Do NOT invent.
- score 80+ = HOT (clear intent, budget, timeline)
- score 60-79 = WARM (engaged but vague on at least one dimension)
- score <60 = COLD
- Reply ONLY with the JSON object.`;

type Turn = { speaker?: string; text?: string };

export async function POST(req: NextRequest) {
  const { call_id, id } = await req.json().catch(() => ({}));
  if (!call_id && !id) {
    return NextResponse.json({ error: "call_id or id required" }, { status: 400 });
  }

  const { data: call, error } = await supabase
    .from("calls")
    .select("*")
    .eq(id ? "id" : "call_id", id ?? call_id)
    .maybeSingle();
  if (error || !call) {
    return NextResponse.json({ error: error?.message ?? "call not found" }, { status: 404 });
  }

  const turns = (call.transcript ?? []) as Turn[];
  if (!turns.length) {
    return NextResponse.json({ error: "no transcript to analyse" }, { status: 400 });
  }

  const transcriptText = turns
    .map((t) => `${(t.speaker ?? "speaker").toUpperCase()}: ${t.text ?? ""}`)
    .join("\n");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ENRICH_PROMPT },
        { role: "user", content: transcriptText },
      ],
      max_tokens: 500,
      temperature: 0.1,
    });
    const parsed = JSON.parse(response.choices[0].message.content ?? "{}");

    const update: Record<string, unknown> = {};
    if (parsed.lead_name) update.lead_name = parsed.lead_name;
    if (parsed.project) update.project = parsed.project;
    if (typeof parsed.lead_score === "number") update.lead_score = parsed.lead_score;
    if (parsed.score_label) update.score_label = parsed.score_label;
    if (parsed.summary) update.summary = parsed.summary;
    if (parsed.outcome) update.outcome = parsed.outcome;
    if (parsed.language) update.language = parsed.language;

    // Build a rich analysis blob (CallCard already renders chips from it)
    update.analysis = {
      intent: parsed.buyer_type ?? null,
      budget_range: parsed.budget ?? null,
      timeline: parsed.timeline ?? null,
      nri_status: parsed.residency ?? null,
      site_visit_booked: parsed.site_visit_booked ?? false,
      next_action: parsed.next_action ?? null,
    };

    const { data: updated, error: upErr } = await supabase
      .from("calls")
      .update(update)
      .eq("id", call.id)
      .select()
      .single();
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    // Also upsert into leads CRM table so it shows up on /leads
    if (call.lead_phone) {
      const phone = String(call.lead_phone).replace(/^\+/, "");
      const { data: existingLead } = await supabase
        .from("leads")
        .select("*")
        .eq("phone", phone)
        .maybeSingle();

      let status = existingLead?.status ?? "new";
      if (parsed.site_visit_booked) status = "booked";
      else if (parsed.buyer_type || parsed.timeline || parsed.budget) status = "qualified";

      await supabase.from("leads").upsert({
        phone,
        name: parsed.lead_name ?? existingLead?.name ?? null,
        project: parsed.project ?? existingLead?.project ?? null,
        buyer_type: parsed.buyer_type ?? existingLead?.buyer_type ?? null,
        residency: parsed.residency ?? existingLead?.residency ?? null,
        timeline: parsed.timeline ?? existingLead?.timeline ?? null,
        budget: parsed.budget ?? existingLead?.budget ?? null,
        lead_score: Math.max(parsed.lead_score ?? 50, existingLead?.lead_score ?? 0),
        score_label: parsed.score_label ?? existingLead?.score_label ?? "WARM",
        source: existingLead?.source ?? "voice",
        status,
      }, { onConflict: "phone" });
    }

    return NextResponse.json({ ok: true, call: updated });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET() {
  // Backfill all calls with null lead_score
  const { data: pending, error } = await supabase
    .from("calls")
    .select("id,call_id,transcript")
    .is("lead_score", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const ids = (pending ?? []).filter((c) => Array.isArray(c.transcript) && c.transcript.length).map((c) => c.id);
  return NextResponse.json({ pending_count: ids.length, ids });
}
