import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getMiracleNoAnswerLeads } from "@/lib/zoho";
import { cleanLeadName, cleanPhone, phoneKey } from "@/lib/leadImport";
import { listPhoneNumbers, AGENT_ID } from "@/lib/elevenlabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A full 30k-lead scan is ~150 sequential Zoho calls, which can exceed 60s.
export const maxDuration = 300;

const BATCH_LABEL = "Singapore Miracle — Not Answer";

// No-pickup cadence (days from first call): 1 → 3 → 5 → 7 → 15 → 30, then stop.
const RETRY_DAYS = [1, 3, 5, 7, 15, 30];

// Pull Singapore Miracle leads that human callers couldn't reach
// (Lead_Status = "Not Answer") from Zoho and queue them for the AI dialer.
// Idempotent: re-running only adds newly-flagged leads (deduped by phone against
// everything already in call_queue). Read-only on Zoho — no write-back.
//
// Auth: dashboard cookie, or the CRON_SECRET bearer (proxy allows this path).
//
// The voice line: headless cron calls have no browser selection, so we resolve
// it as explicit request value → ZOHO_SYNC_AGENT_PHONE_NUMBER_ID override →
// auto-discover the number assigned to the Sarthak agent (same source the
// dashboard picker uses). So no config is needed when one line is linked.
async function resolveAgentPhone(explicit?: string): Promise<string | null> {
  if (explicit) return explicit;
  if (process.env.ZOHO_SYNC_AGENT_PHONE_NUMBER_ID) return process.env.ZOHO_SYNC_AGENT_PHONE_NUMBER_ID;
  const numbers = await listPhoneNumbers().catch(() => []);
  const match = numbers.find((n) => n.assigned_agent?.agent_id === AGENT_ID);
  return (match ?? numbers[0])?.phone_number_id ?? null;
}

async function sync(agentPhoneNumberId: string | undefined) {
  const agentPhone = await resolveAgentPhone(agentPhoneNumberId);
  if (!agentPhone) {
    return NextResponse.json(
      { error: "no voice line found — assign a phone number to the agent in ElevenLabs" },
      { status: 400 },
    );
  }

  // 1) Fetch the target set from Zoho (full scan, Miracle + "Not Answer").
  const leads = await getMiracleNoAnswerLeads();

  // 2) Dedup against every phone already in the queue (any status/batch), so a
  //    lead is never dialed twice across syncs.
  const { data: existing } = await supabase.from("call_queue").select("lead_phone");
  const seen = new Set((existing ?? []).map((r) => phoneKey(String(r.lead_phone))));

  const fresh: { lead_name: string | null; lead_phone: string; dynamic_vars: Record<string, string> }[] = [];
  let noPhone = 0;
  for (const l of leads) {
    const phone = cleanPhone(l.phone);
    if (!phone) { noPhone++; continue; }
    const key = phoneKey(phone);
    if (seen.has(key)) continue;
    seen.add(key);
    const dyn: Record<string, string> = { zoho_id: l.zohoId };
    if (l.temperature) dyn.temperature = l.temperature;
    fresh.push({ lead_name: cleanLeadName(l.name), lead_phone: phone, dynamic_vars: dyn });
  }

  if (!fresh.length) {
    return NextResponse.json({
      ok: true,
      miracle_no_answer: leads.length,
      newly_queued: 0,
      already_queued: leads.length - noPhone,
      no_phone: noPhone,
    });
  }

  // 3) Find-or-create the running Miracle campaign batch, then append.
  const { data: running } = await supabase
    .from("call_batches")
    .select("id")
    .eq("label", BATCH_LABEL)
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let batchId = running?.id;
  if (!batchId) {
    const { data: batch, error: bErr } = await supabase
      .from("call_batches")
      .insert({
        label: BATCH_LABEL,
        status: "running",
        agent_phone_number_id: agentPhone,
        concurrency: 2, // ≤ VoBiz 3-channel limit; leaves one channel for transfers
        ringing_timeout_secs: 30,
        // No-pickup cadence: call on day 1, then 3, 5, 7, 15, 30 — then stop.
        retry_days: RETRY_DAYS,
        max_attempts: RETRY_DAYS.length,
      })
      .select("id")
      .single();
    if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
    batchId = batch.id;
  }

  const rows = fresh.map((f) => ({
    batch_id: batchId,
    lead_name: f.lead_name,
    lead_phone: f.lead_phone,
    project: "Singapore Miracle",
    dynamic_vars: f.dynamic_vars,
    status: "queued",
    max_attempts: RETRY_DAYS.length,
  }));
  const { error: qErr } = await supabase.from("call_queue").insert(rows);
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    batch_id: batchId,
    miracle_no_answer: leads.length,
    newly_queued: fresh.length,
    already_queued: leads.length - fresh.length - noPhone,
    no_phone: noPhone,
  });
}

// Surface the real cause instead of a bare 500 (missing env var, Zoho/Supabase error).
async function run(agentPhoneNumberId: string | undefined) {
  try {
    return await sync(agentPhoneNumberId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return run(body?.agent_phone_number_id);
}

export async function GET(req: NextRequest) {
  return run(req.nextUrl.searchParams.get("agent_phone_number_id") || undefined);
}
