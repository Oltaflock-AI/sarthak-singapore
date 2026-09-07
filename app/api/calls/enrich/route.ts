import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { enrichCall } from "@/lib/enrich";

export const maxDuration = 300;

// POST /api/calls/enrich { id } | { call_id } → deep AI analysis for one call.
export async function POST(req: NextRequest) {
  const { call_id, id } = await req.json().catch(() => ({}));
  const res = await enrichCall({ id, call_id });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true, call: res.call });
}

// GET /api/calls/enrich → how many calls still lack the deep analysis.
export async function GET() {
  const { data, error } = await supabase
    .from("calls")
    .select("id,lead_score,analysis,duration_seconds")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const pending = (data ?? []).filter((c) => {
    const a = (c.analysis ?? {}) as Record<string, unknown>;
    return !a.sentiment || !a.motivation;
  });
  return NextResponse.json({
    pending_count: pending.length,
    pending_insightful: pending.filter((c) => (c.duration_seconds ?? 0) > 60).length,
  });
}
