import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { enrichCall } from "@/lib/enrich";

export const maxDuration = 300;

// Server-side backfill of the deep analysis (score, sentiment, motivation,
// coaching) for calls the webhook only gave a heuristic score to.
//
// The browser used to be the only trigger, and it never fired: the /api/calls
// list payload drops the heavy `transcript` column, so the client's
// "has a transcript" guard was false for every call. This route is the
// authoritative path — no client involvement, transcript read server-side.
//
//   POST /api/calls/enrich/backfill { limit?: number, force?: boolean }
//
// Highest-value calls first: site visits booked, then longest conversations —
// those are the ones where the psychology read actually matters.
export async function POST(req: NextRequest) {
  const { limit = 25, force = false } = await req.json().catch(() => ({}));
  return run(limit, force);
}

// Vercel cron issues GET, so the schedule drives the same job.
//   GET /api/calls/enrich/backfill?limit=10
export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 10);
  return run(limit, req.nextUrl.searchParams.get("force") === "1");
}

async function run(limit: number, force: boolean) {

  const { data, error } = await supabase
    .from("calls")
    .select("id,call_id,duration_seconds,analysis,created_at")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Booked visits are keyed by call_id in site_visits — read the visits table
  // rather than relying on a flag that may not be on the calls row yet.
  const { data: visits } = await supabase.from("site_visits").select("call_id");
  const bookedIds = new Set((visits ?? []).map((v) => String(v.call_id)));

  const candidates = (data ?? [])
    .filter((c) => {
      const a = (c.analysis ?? {}) as Record<string, unknown>;
      const needsDeep = !a.sentiment || !a.motivation;
      // Nothing to read on a call that never connected.
      const connected = (c.duration_seconds ?? 0) > 0;
      return connected && (force || needsDeep);
    })
    .map((c) => ({
      ...c,
      booked: bookedIds.has(String(c.call_id)) || bookedIds.has(String(c.id)),
    }))
    .sort((a, b) => {
      if (a.booked !== b.booked) return a.booked ? -1 : 1;
      return (b.duration_seconds ?? 0) - (a.duration_seconds ?? 0);
    })
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 25)));

  // Small concurrency: fast enough for a batch, gentle on the OpenAI rate limit.
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  const queue = [...candidates];
  const worker = async () => {
    for (;;) {
      const c = queue.shift();
      if (!c) return;
      const r = await enrichCall({ id: String(c.id) });
      results.push({ id: String(c.id), ok: r.ok, error: r.error });
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  return NextResponse.json({
    attempted: results.length,
    enriched: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
  });
}
