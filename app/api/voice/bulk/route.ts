import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { cleanLeadName, cleanPhone, phoneKey } from "@/lib/leadImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface IncomingLead {
  name?: string | null;
  phone?: string;
}

// Bulk outbound campaign from an uploaded sheet. Creates one running batch +
// a queued row per lead; the dialer loop (/api/voice/process → processTick)
// then dials them sequentially. The browser parses/cleans the file, but we
// re-clean here so the queue is trustworthy regardless of the caller.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const agentPhoneNumberId: string | undefined = body?.agent_phone_number_id;
  const incoming: IncomingLead[] = Array.isArray(body?.leads) ? body.leads : [];
  const label: string = (body?.label && String(body.label)) || "Bulk import";

  if (!agentPhoneNumberId)
    return NextResponse.json({ error: "agent_phone_number_id required" }, { status: 400 });
  if (!incoming.length)
    return NextResponse.json({ error: "no leads provided" }, { status: 400 });

  // Same batch options as /api/voice/queue: parallel calls, ring timeout,
  // and the no-pickup callback (re-dial every N minutes, up to max_attempts).
  const concurrency: number = Math.min(10, Math.max(1, Number(body?.concurrency) || 1));
  const ringingTimeoutSecs: number = Math.min(120, Math.max(10, Number(body?.ringing_timeout_secs) || 60));
  const retryIntervalMinutes: number = Math.min(24 * 60, Math.max(5, Number(body?.retry_interval_minutes) || 120));
  const maxAttempts: number = Math.min(10, Math.max(1, Number(body?.max_attempts) || 1));

  // Re-clean + de-dupe server-side (single source of truth).
  const seen = new Set<string>();
  const cleaned: { lead_name: string | null; lead_phone: string }[] = [];
  for (const l of incoming) {
    const phone = cleanPhone(l?.phone);
    if (!phone) continue;
    const key = phoneKey(phone);
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ lead_name: cleanLeadName(l?.name), lead_phone: phone });
  }

  if (!cleaned.length)
    return NextResponse.json({ error: "no leads with a valid phone number" }, { status: 400 });

  const { data: batch, error: bErr } = await supabase
    .from("call_batches")
    .insert({
      label: `${label} · ${cleaned.length}`,
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

  const rows = cleaned.map((c) => ({
    batch_id: batch.id,
    lead_name: c.lead_name,
    lead_phone: c.lead_phone,
    status: "queued",
    max_attempts: maxAttempts,
  }));
  const { error: qErr } = await supabase.from("call_queue").insert(rows);
  if (qErr) {
    // Roll the empty batch back so it doesn't linger as a phantom campaign.
    await supabase.from("call_batches").update({ status: "canceled" }).eq("id", batch.id);
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    batch_id: batch.id,
    queued: cleaned.length,
    no_name: cleaned.filter((c) => !c.lead_name).length,
  });
}
