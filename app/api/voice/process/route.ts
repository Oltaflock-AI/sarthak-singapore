import { NextRequest, NextResponse } from "next/server";
import { processTick } from "@/lib/dialer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// ElevenLabs' sip-trunk/outbound-call blocks until the call resolves — a
// no-answer rings the full ringing_timeout_secs. Dialing up to `concurrency`
// leads sequentially can take a few minutes, so allow well past the old 60s.
export const maxDuration = 300;

// One dialer tick: reconcile finished calls, then dial the next queued lead
// (concurrency-aware). Called repeatedly by the browser loop AND safe for a
// Vercel cron / external scheduler. Optionally scope to one batch_id.
async function tick(batchId: string | undefined) {
  try {
    const result = await processTick(batchId || undefined);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return tick(body?.batch_id);
}

// GET form so a cron (which issues GET) can hit it too.
export async function GET(req: NextRequest) {
  return tick(req.nextUrl.searchParams.get("batch_id") || undefined);
}
