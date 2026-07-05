import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Conversational-AI minutes counter for the dashboard.
//
// ElevenLabs' API exposes only TTS character credits — never ConvAI minutes — so
// we compute usage ourselves: every call's duration is recorded in `calls`, so
// minutes used = sum(duration_seconds)/60 since the billing start.

// Plan allowance (denominator). Override with ELEVENLABS_PLAN_MINUTES.
const TOTAL_MINUTES = Number(process.env.ELEVENLABS_PLAN_MINUTES) || 1200;

// Count usage from here — the client's billing start, not ElevenLabs' monthly
// reset. Override with MINUTES_SINCE (ISO 8601). Default: 4 Jul 2026, 6:00 AM IST.
const BILLING_START = process.env.MINUTES_SINCE || "2026-07-04T06:00:00+05:30";

export async function GET() {
  try {
    const start = new Date(BILLING_START);

    // Sum call durations since the billing start. Page through so a period with
    // >1000 calls still totals correctly (PostgREST caps a page at 1000).
    let usedSecs = 0;
    let from = 0;
    const PAGE = 1000;
    for (;;) {
      const { data, error } = await supabase
        .from("calls")
        .select("duration_seconds")
        .gte("created_at", start.toISOString())
        .order("created_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      for (const r of rows) usedSecs += (r as { duration_seconds: number | null }).duration_seconds || 0;
      if (rows.length < PAGE) break;
      from += PAGE;
    }

    const used = Math.round(usedSecs / 60);
    return NextResponse.json({
      used_minutes: used,
      total_minutes: TOTAL_MINUTES,
      remaining_minutes: Math.max(0, TOTAL_MINUTES - used),
      since: start.toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
