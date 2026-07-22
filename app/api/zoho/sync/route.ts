import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getNoAnswerLeads, type MiracleLead } from "@/lib/zoho";
import { cleanLeadName, cleanPhone, phoneKey } from "@/lib/leadImport";
import { listPhoneNumbers, AGENT_ID } from "@/lib/elevenlabs";
import { AGENTS } from "@/lib/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A full 30k-lead scan is ~150 sequential Zoho calls, which can exceed 60s.
export const maxDuration = 300;

// No-pickup cadence (days from first call): 1 → 3 → 5 → 7 → 15 → 30, then stop.
const RETRY_DAYS = [1, 3, 5, 7, 15, 30];

// One campaign per property. `match` runs against a lead's lowercased
// Project_Name tokens; `agent` is the ElevenLabs agent that pitches it. Order
// matters — a multi-project lead is claimed by the first campaign it matches,
// so Miracle (the original) stays first.
const agentFor = (property: string) => AGENTS.find((a) => a.property === property)!;
const CAMPAIGNS = [
  { label: "Singapore Miracle — Not Answer", project: "Singapore Miracle", agent: agentFor("Singapore Miracle"), match: (t: string) => t === "miracle" },
  { label: "Singapore One Street — Not Answer", project: "Singapore One Street", agent: agentFor("Singapore One Street"), match: (t: string) => t === "one street" },
  { label: "The Grand Virasat — Not Answer", project: "The Grand Virasat", agent: agentFor("The Grand Virasat"), match: (t: string) => t.startsWith("virasat") },
];

// Pull "Not Answer" leads from Zoho and queue them for the AI dialer, one batch
// per property, each dialed by its own agent. Idempotent: re-running only adds
// newly-flagged leads (deduped by phone against everything already in the
// queue). Read-only on Zoho — no write-back.
//
// Auth: dashboard cookie, or the CRON_SECRET bearer (proxy allows this path).
//
// The voice line: headless cron calls have no browser selection, so we resolve
// it as explicit request value → ZOHO_SYNC_AGENT_PHONE_NUMBER_ID override →
// auto-discover the number assigned to the Sarthak agent. All property agents
// place outbound calls over the same line (agent_id is set per call).
async function resolveAgentPhone(explicit?: string): Promise<string | null> {
  if (explicit) return explicit;
  if (process.env.ZOHO_SYNC_AGENT_PHONE_NUMBER_ID) return process.env.ZOHO_SYNC_AGENT_PHONE_NUMBER_ID;
  const numbers = await listPhoneNumbers().catch(() => []);
  const match = numbers.find((n) => n.assigned_agent?.agent_id === AGENT_ID);
  return (match ?? numbers[0])?.phone_number_id ?? null;
}

// Find-or-create the running batch for a campaign, then append queued rows.
async function enqueueCampaign(
  campaign: (typeof CAMPAIGNS)[number],
  agentPhone: string,
  leads: { lead_name: string | null; lead_phone: string; dynamic_vars: Record<string, string> }[],
): Promise<string | null> {
  if (!leads.length) return null;

  const { data: running } = await supabase
    .from("call_batches")
    .select("id")
    .eq("label", campaign.label)
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let batchId = running?.id;
  if (!batchId) {
    const { data: batch, error: bErr } = await supabase
      .from("call_batches")
      .insert({
        label: campaign.label,
        status: "running",
        agent_phone_number_id: agentPhone,
        concurrency: 2, // ≤ VoBiz 3-channel limit; leaves one channel for transfers
        ringing_timeout_secs: 30,
        retry_days: RETRY_DAYS,
        max_attempts: RETRY_DAYS.length,
      })
      .select("id")
      .single();
    if (bErr) throw new Error(bErr.message);
    batchId = batch.id;
  }

  const rows = leads.map((l) => ({
    batch_id: batchId,
    lead_name: l.lead_name,
    lead_phone: l.lead_phone,
    project: campaign.project,
    dynamic_vars: l.dynamic_vars,
    status: "queued",
    max_attempts: RETRY_DAYS.length,
  }));
  const { error: qErr } = await supabase.from("call_queue").insert(rows);
  if (qErr) throw new Error(qErr.message);
  return batchId as string;
}

async function sync(agentPhoneNumberId: string | undefined) {
  const agentPhone = await resolveAgentPhone(agentPhoneNumberId);
  if (!agentPhone) {
    return NextResponse.json(
      { error: "no voice line found — assign a phone number to the agent in ElevenLabs" },
      { status: 400 },
    );
  }

  // 1) One full scan of all "Not Answer" leads (every project).
  const leads = await getNoAnswerLeads();

  // 2) Dedup against every phone already in the queue (any status/batch), so a
  //    lead is never dialed twice across syncs; `seen` also blocks a
  //    multi-project lead from landing in two campaigns this run.
  const { data: existing } = await supabase.from("call_queue").select("lead_phone");
  const seen = new Set((existing ?? []).map((r) => phoneKey(String(r.lead_phone))));

  const perCampaign: Record<string, { lead_name: string | null; lead_phone: string; dynamic_vars: Record<string, string> }[]> = {};
  for (const c of CAMPAIGNS) perCampaign[c.label] = [];
  let noPhone = 0;
  let matchedTotal = 0;

  for (const l of leads as MiracleLead[]) {
    const campaign = CAMPAIGNS.find((c) => l.projectTokens.some(c.match));
    if (!campaign) continue; // a "Not Answer" lead for some other project
    matchedTotal++;
    const phone = cleanPhone(l.phone);
    if (!phone) { noPhone++; continue; }
    const key = phoneKey(phone);
    if (seen.has(key)) continue;
    seen.add(key);
    const dyn: Record<string, string> = { zoho_id: l.zohoId, agent_id: campaign.agent.agentId };
    if (l.temperature) dyn.temperature = l.temperature;
    perCampaign[campaign.label].push({ lead_name: cleanLeadName(l.name), lead_phone: phone, dynamic_vars: dyn });
  }

  const results: Record<string, { batch_id: string | null; newly_queued: number }> = {};
  for (const c of CAMPAIGNS) {
    const batch_id = await enqueueCampaign(c, agentPhone, perCampaign[c.label]);
    results[c.project] = { batch_id, newly_queued: perCampaign[c.label].length };
  }

  return NextResponse.json({
    ok: true,
    not_answer_total: leads.length,
    matched_our_projects: matchedTotal,
    no_phone: noPhone,
    newly_queued: Object.values(results).reduce((s, r) => s + r.newly_queued, 0),
    campaigns: results,
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
