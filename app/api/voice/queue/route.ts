import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BulkRow {
  lead_name?: string | null;
  lead_phone: string;
  project?: string | null;
  dynamic_vars?: Record<string, string>;
}

// POST: create a campaign batch + enqueue rows. Does NOT dial — the processor
// (browser loop or cron hitting /api/voice/process) picks them up.
// Batch options: concurrency (parallel calls), ringing_timeout_secs (passed to
// ElevenLabs telephony_call_config), retry_interval_minutes + max_attempts
// (no-pickup callback: re-dial every N minutes until attempts run out).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rows: BulkRow[] = Array.isArray(body?.rows) ? body.rows : [];
  const agentPhoneNumberId: string | undefined = body?.agent_phone_number_id;
  const label: string = body?.label || "Campaign";
  const concurrency: number = Math.min(10, Math.max(1, Number(body?.concurrency) || 1));
  const ringingTimeoutSecs: number = Math.min(120, Math.max(10, Number(body?.ringing_timeout_secs) || 60));
  const retryIntervalMinutes: number = Math.min(24 * 60, Math.max(5, Number(body?.retry_interval_minutes) || 120));
  const maxAttempts: number = Math.min(10, Math.max(1, Number(body?.max_attempts) || 1));

  const clean = rows.filter((r) => r && typeof r.lead_phone === "string" && r.lead_phone.trim());
  if (!clean.length) return NextResponse.json({ error: "no valid rows" }, { status: 400 });
  if (!agentPhoneNumberId)
    return NextResponse.json({ error: "agent_phone_number_id required" }, { status: 400 });

  const { data: batch, error: bErr } = await supabase
    .from("call_batches")
    .insert({
      label,
      status: "running",
      agent_phone_number_id: agentPhoneNumberId,
      concurrency,
      ringing_timeout_secs: ringingTimeoutSecs,
      retry_interval_minutes: retryIntervalMinutes,
      max_attempts: maxAttempts,
    })
    .select()
    .single();
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });

  const payload = clean.map((r) => ({
    batch_id: batch.id,
    lead_name: r.lead_name ?? null,
    lead_phone: r.lead_phone.trim(),
    project: r.project ?? null,
    dynamic_vars: r.dynamic_vars ?? {},
    status: "queued",
    max_attempts: maxAttempts,
  }));
  const { error: qErr } = await supabase.from("call_queue").insert(payload);
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, batch_id: batch.id, count: payload.length });
}

// GET: ?batch_id=… → { batch, rows }.  No param → { batches: [...with counts], rows: recent }.
export async function GET(req: NextRequest) {
  const batchId = req.nextUrl.searchParams.get("batch_id");

  if (batchId) {
    const { data: batch } = await supabase.from("call_batches").select("*").eq("id", batchId).single();
    const { data: rows } = await supabase
      .from("call_queue")
      .select("*")
      .eq("batch_id", batchId)
      .order("created_at", { ascending: true });
    return NextResponse.json({ batch, rows: rows ?? [] });
  }

  const { data: batches } = await supabase
    .from("call_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  const ids = (batches ?? []).map((b) => b.id);
  const counts: Record<string, Record<string, number>> = {};
  if (ids.length) {
    const { data: rows } = await supabase
      .from("call_queue")
      .select("batch_id,status")
      .in("batch_id", ids);
    for (const r of rows ?? []) {
      const b = (counts[r.batch_id] ??= { queued: 0, dialing: 0, completed: 0, failed: 0, canceled: 0, total: 0 });
      b[r.status] = (b[r.status] ?? 0) + 1;
      b.total += 1;
    }
  }
  return NextResponse.json({
    batches: (batches ?? []).map((b) => ({ ...b, counts: counts[b.id] ?? {} })),
  });
}

// PATCH: control a batch. body { batch_id, action: 'pause'|'resume'|'cancel' }.
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const batchId: string | undefined = body?.batch_id;
  const action: string | undefined = body?.action;
  if (!batchId || !action) return NextResponse.json({ error: "batch_id and action required" }, { status: 400 });

  if (action === "pause") {
    await supabase.from("call_batches").update({ status: "paused" }).eq("id", batchId);
  } else if (action === "resume") {
    await supabase.from("call_batches").update({ status: "running" }).eq("id", batchId);
  } else if (action === "cancel") {
    await supabase.from("call_batches").update({ status: "canceled" }).eq("id", batchId);
    await supabase
      .from("call_queue")
      .update({ status: "canceled", completed_at: new Date().toISOString() })
      .eq("batch_id", batchId)
      .eq("status", "queued");
  } else {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
