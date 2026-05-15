import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TranscriptTurn = { speaker: string; time: string; text: string; side: string };

function scoreLabel(score: number | null): string | null {
  if (score == null) return null;
  if (score >= 80) return "HOT";
  if (score >= 60) return "WARM";
  return "COLD";
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
    return raw.map((t: any) => {
      const speaker = String(t.speaker ?? t.role ?? t.from ?? "speaker");
      const text = String(t.text ?? t.message ?? t.content ?? "");
      const time = String(t.time ?? t.timestamp ?? "");
      const side = /agent|assistant|bot/i.test(speaker) ? "agent" : "user";
      return { speaker, time, text, side };
    });
  }
  return [];
}

function pick<T = any>(obj: any, keys: string[]): T | null {
  for (const k of keys) {
    const v = k.split(".").reduce((o, p) => (o == null ? o : o[p]), obj);
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return null;
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const call_id = pick<string>(body, [
    "call_id", "callId", "id", "data.call_id", "data.id", "conversation_id",
  ]);

  const lead_name = pick<string>(body, [
    "lead_name", "name", "customer_name", "contact_name",
    "metadata.lead_name", "metadata.name", "variables.name", "data.lead_name",
  ]);

  const lead_phone = pick<string>(body, [
    "lead_phone", "phone", "phone_number", "to", "to_number", "customer_phone",
    "metadata.phone", "variables.phone", "data.phone",
  ]);

  const project = pick<string>(body, [
    "project", "metadata.project", "variables.project", "data.project",
  ]);

  const source = pick<string>(body, [
    "source", "metadata.source", "variables.source", "data.source", "channel",
  ]);

  const lead_score_raw = pick<number | string>(body, [
    "lead_score", "score", "metadata.score", "analytics.score", "data.score",
  ]);
  const lead_score = lead_score_raw == null ? null : Number(lead_score_raw);

  const duration_raw = pick<number | string>(body, [
    "duration_seconds", "duration", "call_duration", "data.duration",
  ]);
  const duration_seconds = duration_raw == null ? null : Math.round(Number(duration_raw));

  const outcome = pick<string>(body, [
    "outcome", "disposition", "result", "status", "call_status", "data.outcome",
  ]);

  const rawTranscript = pick(body, [
    "transcript", "transcripts", "messages", "conversation", "data.transcript",
  ]);
  const transcript = normalizeTranscript(rawTranscript);

  const row = {
    call_id,
    lead_name,
    lead_phone,
    project,
    source,
    lead_score: Number.isFinite(lead_score as number) ? lead_score : null,
    score_label: scoreLabel(Number.isFinite(lead_score as number) ? (lead_score as number) : null),
    duration_seconds: Number.isFinite(duration_seconds as number) ? duration_seconds : null,
    outcome,
    transcript,
  };

  const { error } = call_id
    ? await supabase.from("calls").upsert(row, { onConflict: "call_id" })
    : await supabase.from("calls").insert(row);

  if (error) {
    console.error("[ringg webhook] supabase error", error, "row=", row);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, call_id });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "ringg-webhook" });
}
