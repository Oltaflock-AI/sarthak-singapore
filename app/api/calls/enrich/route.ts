import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { openai } from "@/lib/openai";
import { getCalBookingOutcome } from "@/lib/elevenlabs";

const ENRICH_PROMPT = `You are a senior real-estate sales analyst. Read this Sarthak Singapore voice-call transcript between an AI sales agent and a prospective buyer and produce a DEEP, evidence-based analysis. Quote or paraphrase actual transcript moments as evidence — never invent.

Return ONLY this JSON object:

{
  "lead_name": string | null,
  "project": "Singapore Miracle",   // the only project Sarthak Singapore is calling about — always this value
  "buyer_type": "end_use" | "investment" | null,
  "residency": "local" | "nri" | null,
  "timeline": string | null,
  "budget": string | null,
  "lead_score": number,        // 0-100 overall lead quality
  "score_label": "HOT" | "WARM" | "COLD",
  "summary": string,           // 2-3 sentence English summary of the whole call
  "outcome": string,           // e.g., "Site visit booked · Saturday 11am", "Qualified · awaiting brochure", "Not interested"
  "language": string | null,   // "hi", "en", "hi-en", etc.
  "site_visit_booked": boolean,
  "site_visit_datetime": string | null,   // ISO 8601 (Asia/Kolkata) of the agreed visit slot if a specific day/time was set, else null
  "next_action": string | null,

  "sentiment": {
    "overall": "positive" | "neutral" | "negative" | "mixed",
    "score": number,                 // 0-100, 100 = extremely positive/enthusiastic, 50 = neutral, 0 = hostile
    "trajectory": "improving" | "declining" | "steady" | "volatile",  // how mood moved across the call
    "emotions": string[],            // 2-5 specific emotions observed, e.g. ["curious","price-anxious","reassured"]
    "rationale": string,             // 2-3 sentences explaining the read, citing what the buyer said
    "moments": [                     // 2-4 pivotal emotional moments
      { "quote": string, "read": string }   // quote = paraphrased buyer line, read = what it signals
    ]
  },

  "motivation": {
    "score": number,                 // 0-100 — how strongly motivated to actually buy soon
    "level": "very_high" | "high" | "moderate" | "low" | "unclear",
    "urgency": "immediate" | "weeks" | "months" | "exploratory" | "unclear",
    "buying_stage": "unaware" | "researching" | "comparing" | "ready_to_visit" | "ready_to_buy",
    "signals": [                     // 3-6 concrete motivation signals, each with evidence + weight
      { "signal": string, "evidence": string, "weight": "strong" | "medium" | "weak" }
    ],
    "objections": [                  // buyer concerns/blockers; [] if none
      { "objection": string, "severity": "high" | "medium" | "low", "handled": boolean }
    ],
    "drivers": string[]              // 2-4 core reasons this person would buy (e.g. "school proximity for kids")
  },

  "coaching": {
    "what_went_well": string[],      // 1-3 things the agent did well
    "what_to_improve": string[],     // 1-3 misses or follow-up gaps
    "recommended_next_step": string  // single sharpest next action for the human sales team
  },

  "key_points": string[],            // 3-6 factual bullets a salesperson must know before follow-up
  "action_items": string[]           // 2-5 concrete to-dos
}

Rules:
- Use null / [] for genuinely unknown fields. Do NOT invent facts.
- lead_score 80+ = HOT (clear intent + budget + timeline), 60-79 = WARM (engaged, vague on one dimension), <60 = COLD.
- sentiment.score and motivation.score are independent of lead_score — a buyer can be warm but anxious, or cold but polite.
- Be specific and quote real moments in evidence/rationale/moments.
- Reply ONLY with the JSON object, no prose around it.`;

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

  // Anchor relative dates ("tomorrow 2pm") to the call's real IST timestamp so the
  // model resolves site_visit_datetime to an actual calendar date, not a guess.
  const callIst = new Date(call.created_at as string).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  const dateContext = `This call took place on ${callIst} IST. Resolve any relative dates the caller mentions (e.g. "tomorrow", "Saturday", "agle hafte") against THIS date when filling site_visit_datetime — output a full absolute ISO 8601 timestamp with the correct year. Never guess the year.\n\nTranscript:\n`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ENRICH_PROMPT },
        { role: "user", content: dateContext + transcriptText },
      ],
      max_tokens: 1600,
      temperature: 0.2,
    });
    const parsed = JSON.parse(response.choices[0].message.content ?? "{}");

    // Authoritative booking truth comes ONLY from the actual cal.com tool result
    // (calcom_create_booking) — never GPT's transcript reading, which marks
    // failed attempts and even no-booking conversations as "booked". If we can't
    // verify a real booking, the call is NOT booked. We never invent the fact.
    const calBooking = call.call_id
      ? await getCalBookingOutcome(String(call.call_id))
      : null;
    const isBooked = calBooking?.booked === true;
    // Real booked start from cal.com when present; the model's extracted slot is
    // only trustworthy once a booking is actually confirmed.
    const bookedDatetime = isBooked
      ? (calBooking?.startUtc ?? parsed.site_visit_datetime ?? null)
      : null;

    const update: Record<string, unknown> = {};
    if (parsed.lead_name) update.lead_name = parsed.lead_name;
    // Only one project in this campaign — set it deterministically, never let
    // the model pick (or invent) another.
    update.project = "Singapore Miracle";
    if (typeof parsed.lead_score === "number") update.lead_score = parsed.lead_score;
    if (parsed.score_label) update.score_label = parsed.score_label;
    if (parsed.summary) update.summary = parsed.summary;
    if (parsed.outcome) {
      // Don't let GPT's prose assert a booking the cal.com result didn't confirm.
      const claimsBooking = /\bbook(ed|ing)?\b/i.test(String(parsed.outcome));
      update.outcome = !isBooked && claimsBooking
        ? "Spoke with lead · no site visit booked"
        : parsed.outcome;
    }
    if (parsed.language) update.language = parsed.language;

    // Merge onto the existing Ringg analysis so recording_url, platform_summary,
    // classification etc. survive re-enrichment.
    const prevAnalysis = (call.analysis ?? {}) as Record<string, unknown>;
    update.analysis = {
      ...prevAnalysis,
      intent: parsed.buyer_type ?? prevAnalysis.intent ?? null,
      budget_range: parsed.budget ?? prevAnalysis.budget_range ?? null,
      timeline: parsed.timeline ?? prevAnalysis.timeline ?? null,
      nri_status: parsed.residency ?? prevAnalysis.nri_status ?? null,
      // Authoritative: only the real cal.com booking result, never GPT's guess.
      site_visit_booked: isBooked,
      site_visit_datetime: bookedDatetime,
      next_action: parsed.next_action ?? prevAnalysis.next_action ?? null,
      sentiment: parsed.sentiment ?? prevAnalysis.sentiment ?? null,
      motivation: parsed.motivation ?? prevAnalysis.motivation ?? null,
      coaching: parsed.coaching ?? prevAnalysis.coaching ?? null,
      key_points: Array.isArray(parsed.key_points) && parsed.key_points.length
        ? parsed.key_points
        : (prevAnalysis.key_points ?? []),
      action_items: Array.isArray(parsed.action_items) && parsed.action_items.length
        ? parsed.action_items
        : (prevAnalysis.action_items ?? []),
    };

    const { data: updated, error: upErr } = await supabase
      .from("calls")
      .update(update)
      .eq("id", call.id)
      .select()
      .single();
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    // Booking truth (calBooking / isBooked) was resolved above from the real
    // cal.com tool result — reused here for the leads + site_visits writes.
    // Also upsert into leads CRM table so it shows up on /leads.
    // Canonicalize to +E.164 so this matches the webhook's key and never forks
    // into a second (unprefixed) lead row. Collapse any legacy unprefixed row.
    if (call.lead_phone) {
      const digits = String(call.lead_phone).replace(/[^\d]/g, "");
      const phone = digits ? `+${digits}` : String(call.lead_phone);
      const legacyPhone = phone.replace(/^\+/, "");

      const { data: rows } = await supabase
        .from("leads")
        .select("*")
        .in("phone", [phone, legacyPhone]);
      const existingLead =
        rows?.find((r) => r.phone === phone) ??
        rows?.find((r) => r.phone === legacyPhone) ??
        null;
      // Drop the legacy unprefixed duplicate before writing the canonical row.
      if (legacyPhone !== phone) {
        await supabase.from("leads").delete().eq("phone", legacyPhone);
      }

      let status = existingLead?.status ?? "new";
      if (isBooked) status = "booked";
      else if (parsed.buyer_type || parsed.timeline || parsed.budget) status = "qualified";

      await supabase.from("leads").upsert({
        phone,
        name: parsed.lead_name ?? existingLead?.name ?? null,
        project: "Singapore Miracle",
        buyer_type: parsed.buyer_type ?? existingLead?.buyer_type ?? null,
        residency: parsed.residency ?? existingLead?.residency ?? null,
        timeline: parsed.timeline ?? existingLead?.timeline ?? null,
        budget: parsed.budget ?? existingLead?.budget ?? null,
        lead_score: Math.max(parsed.lead_score ?? 50, existingLead?.lead_score ?? 0),
        score_label: parsed.score_label ?? existingLead?.score_label ?? "WARM",
        source: existingLead?.source ?? "voice_agent",
        status,
      }, { onConflict: "phone" });

      // Mirror genuine bookings into site_visits (shown on /site-visits). Driven by
      // the authoritative cal.com tool result when available — so failed attempts
      // (e.g. slot unavailable) never create a row, and the time is cal.com's real
      // booked start, not GPT's guess. Idempotent on call_id.
      const callKey = String(call.call_id ?? call.id);
      if (isBooked) {
        // Prefer cal.com's actual start; fall back to the model's extracted datetime.
        const startSrc = calBooking?.startUtc ?? parsed.site_visit_datetime ?? null;
        const whenIso = startSrc && Number.isFinite(Date.parse(startSrc))
          ? new Date(startSrc).toISOString()
          : null;
        const visitRow: Record<string, unknown> = {
          call_id: callKey,
          lead_phone: phone,
          status: "pending",
          notes: calBooking?.uid
            ? `Booked via cal.com · ${calBooking.uid}`
            : (parsed.outcome ?? "Booked via voice agent"),
        };
        if (parsed.lead_name ?? existingLead?.name) visitRow.lead_name = parsed.lead_name ?? existingLead?.name;
        visitRow.project = "Singapore Miracle";
        if (whenIso) visitRow.scheduled_for = whenIso;
        // Human-readable IST for the dashboard (e.g. "Fri 5 Jun, 2:00 PM").
        if (whenIso) {
          visitRow.scheduled_for_text = new Date(whenIso).toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata", weekday: "short", day: "numeric",
            month: "short", hour: "numeric", minute: "2-digit", hour12: true,
          });
        } else if (startSrc) {
          visitRow.scheduled_for_text = startSrc;
        }
        const { error: visitErr } = await supabase
          .from("site_visits")
          .upsert(visitRow, { onConflict: "call_id" });
        if (visitErr) console.error("[enrich] site_visits upsert error", visitErr, visitRow);
      } else if (calBooking != null) {
        // We inspected the conversation and found no real cal.com booking →
        // remove any stale/false-positive row. (When calBooking is null we
        // couldn't verify, so we leave existing rows untouched.)
        await supabase.from("site_visits").delete().eq("call_id", callKey);
      }
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
