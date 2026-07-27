import { NextResponse } from "next/server";
import { getCreditUsage } from "@/lib/elevenlabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Live ElevenLabs credit balance for the dashboard KPI.
//
// This is the real number off the ElevenLabs account — not the locally computed
// minutes estimate in /api/usage/minutes, which only ever saw calls our webhook
// recorded and so ran low. Credits are the unit ElevenLabs actually bills in:
// Conversational AI, TTS and LLM costs all draw from the same pool.

export async function GET() {
  try {
    const usage = await getCreditUsage();
    return NextResponse.json(usage, {
      headers: { "cache-control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
