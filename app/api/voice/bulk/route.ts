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
      concurrency: 1,
    })
    .select()
    .single();
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });

  const rows = cleaned.map((c) => ({
    batch_id: batch.id,
    lead_name: c.lead_name,
    lead_phone: c.lead_phone,
    status: "queued",
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
