import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { placeOutboundCall } from "@/lib/elevenlabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Single, immediate outbound call. Records a one-row batch + queue row so it
// shows up in the same live queue table as bulk campaigns and gets reconciled.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const toNumber: string | undefined = body?.to_number || body?.lead_phone;
  const agentPhoneNumberId: string | undefined = body?.agent_phone_number_id;
  if (!toNumber) return NextResponse.json({ error: "to_number required" }, { status: 400 });
  if (!agentPhoneNumberId)
    return NextResponse.json({ error: "agent_phone_number_id required" }, { status: 400 });

  const leadName: string | null = body?.lead_name ?? null;
  const project: string | null = body?.project ?? null;

  const { data: batch, error: bErr } = await supabase
    .from("call_batches")
    .insert({
      label: `Single · ${leadName || toNumber}`,
      status: "running",
      agent_phone_number_id: agentPhoneNumberId,
      concurrency: 1,
    })
    .select()
    .single();
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });

  const { data: row, error: qErr } = await supabase
    .from("call_queue")
    .insert({
      batch_id: batch.id,
      lead_name: leadName,
      lead_phone: toNumber,
      project,
      status: "queued",
    })
    .select()
    .single();
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

  // Dial right now. The agent's first message requires {{callee_name}} —
  // omitting it fails the call instantly, so always send it (with a fallback).
  const dyn: Record<string, string> = { callee_name: leadName || "ग्राहक" };
  if (leadName) dyn.lead_name = leadName;
  if (project) dyn.project = project;

  try {
    const r = await placeOutboundCall({ agentPhoneNumberId, toNumber, dynamicVars: dyn });
    await supabase
      .from("call_queue")
      .update({
        status: "dialing",
        conversation_id: r.conversation_id,
        sip_call_id: r.sip_call_id,
        attempts: 1,
        dialed_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    return NextResponse.json({
      ok: true,
      queue_id: row.id,
      batch_id: batch.id,
      conversation_id: r.conversation_id,
      sip_call_id: r.sip_call_id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from("call_queue")
      .update({ status: "failed", attempts: 1, last_error: msg, completed_at: new Date().toISOString() })
      .eq("id", row.id);
    await supabase.from("call_batches").update({ status: "done" }).eq("id", batch.id);
    return NextResponse.json({ error: msg, queue_id: row.id }, { status: 502 });
  }
}
