import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Ringg.ai sends different event types — only persist completed calls
  const event = (body.event_type as string) ?? (body.event as string) ?? "";
  if (!["call_completed", "all_processing_completed"].includes(event)) {
    return NextResponse.json({ received: true });
  }

  const callId = (body.call_id ?? body.id) as string | undefined;
  if (!callId) return NextResponse.json({ received: true });

  // Map Ringg.ai payload → our schema
  const score = Number(body.lead_score ?? body.score ?? 0);
  const scoreLabel =
    score >= 80 ? "HOT" : score >= 60 ? "WARM" : "COLD";

  const durationRaw = body.duration_seconds ?? body.duration ?? 0;
  const durationSeconds = typeof durationRaw === "string"
    ? parseInt(durationRaw, 10)
    : Number(durationRaw);

  // Normalise transcript array — each item needs speaker, time, text, side
  const rawTranscript = Array.isArray(body.transcript) ? body.transcript : [];
  const transcript = rawTranscript.map((t: Record<string, unknown>) => ({
    speaker: t.speaker === "agent" ? "Priya (AI)" : String(t.speaker ?? "Buyer"),
    time: t.timestamp ?? t.time ?? "00:00",
    text: t.text ?? t.content ?? "",
    side: t.speaker === "agent" ? "ai" : "user",
  }));

  const row = {
    call_id: callId,
    lead_name: body.lead_name ?? body.name ?? body.contact_name ?? null,
    lead_phone: body.lead_phone ?? body.phone ?? body.to ?? null,
    project: body.project ?? (body.custom_args_values as Record<string, unknown>)?.project ?? null,
    source: body.source ?? (body.custom_args_values as Record<string, unknown>)?.source ?? null,
    lead_score: score,
    score_label: scoreLabel,
    duration_seconds: durationSeconds,
    outcome: body.outcome ?? body.call_disposition ?? null,
    transcript,
  };

  // Upsert — deduplicate on call_id
  const { error } = await supabase
    .from("calls")
    .upsert(row, { onConflict: "call_id" });

  if (error) {
    console.error("Supabase upsert error:", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
