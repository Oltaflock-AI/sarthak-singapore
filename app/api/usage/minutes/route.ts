import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSubscription } from "@/lib/elevenlabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Conversational-AI minutes counter for the dashboard.
//
// ElevenLabs' API exposes only TTS *character* credits — there is no "minutes"
// field — so we compute usage ourselves: every call's duration is recorded in
// `calls`, so minutes used = sum(duration_seconds)/60 for the current billing
// cycle. The plan allowance (denominator) is keyed off the subscription tier.

// ConvAI minutes included per plan tier. Override with ELEVENLABS_PLAN_MINUTES.
// `pro` is set to 1238 to match THIS account's plan page ("1,238 minutes of
// calls included") — ElevenLabs' base Pro is 1100, so the account carries extra.
const PLAN_MINUTES: Record<string, number> = {
  free: 15, starter: 50, creator: 250, pro: 1238, scale: 3600, business: 13750,
};

// ElevenLabs resets monthly, so the current cycle starts one month before the
// next reset. Fallback (no reset date): first of the current UTC month.
function cycleStart(resetUnix: number | null): Date {
  if (resetUnix) {
    const s = new Date(resetUnix * 1000);
    s.setUTCMonth(s.getUTCMonth() - 1);
    return s;
  }
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export async function GET() {
  try {
    const sub = await getSubscription().catch(() => null);
    const tier = sub?.tier ?? "";
    const start = cycleStart(sub?.next_character_count_reset_unix ?? null);

    // Sum call durations since the cycle start. Page through so a cycle with
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
    const total = Number(process.env.ELEVENLABS_PLAN_MINUTES) || PLAN_MINUTES[tier] || 1100;
    return NextResponse.json({
      used_minutes: used,
      total_minutes: total,
      remaining_minutes: Math.max(0, total - used),
      tier: tier || null,
      cycle_start: start.toISOString(),
      reset_unix: sub?.next_character_count_reset_unix ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
