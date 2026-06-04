// Server-side dialer engine. Shared by the browser-driven loop and a future
// cron tick — both just POST /api/voice/process, which calls processTick().
//
// Pacing model: concurrency defaults to 1 (one VoBiz channel). A row goes
// queued → dialing (we fired the ElevenLabs call) → completed/failed. We learn
// a dialing row finished because the elevenlabs-webhook writes a `calls` row
// keyed by call_id = conversation_id. A dialing row with no matching `calls`
// row after STALE_MIN is force-failed so the queue never wedges.

import { supabase } from "@/lib/supabase";
import { placeOutboundCall } from "@/lib/elevenlabs";

const STALE_MIN = 6;

export interface TickResult {
  reconciled: number;
  dialed: { queue_id: string; conversation_id: string | null } | null;
  batchDone: string[];
  active: number;
}

// Settle any 'dialing' rows whose call has ended (calls row exists) or gone stale.
async function reconcile(batchId?: string): Promise<number> {
  let q = supabase.from("call_queue").select("*").eq("status", "dialing");
  if (batchId) q = q.eq("batch_id", batchId);
  const { data: dialing } = await q;
  if (!dialing?.length) return 0;

  let settled = 0;
  const staleBefore = new Date(Date.now() - STALE_MIN * 60_000).toISOString();

  for (const row of dialing) {
    if (row.conversation_id) {
      const { data: call } = await supabase
        .from("calls")
        .select("outcome,duration_seconds")
        .eq("call_id", row.conversation_id)
        .maybeSingle();
      if (call) {
        await supabase
          .from("call_queue")
          .update({
            status: "completed",
            outcome: call.outcome ?? "completed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        settled++;
        continue;
      }
    }
    // No calls row yet — fail it only if it has been dialing too long.
    if (row.dialed_at && row.dialed_at < staleBefore) {
      await supabase
        .from("call_queue")
        .update({
          status: "failed",
          last_error: "no webhook within timeout — marked stale",
          completed_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      settled++;
    }
  }
  return settled;
}

// Dial the next queued row for a running batch, respecting concurrency.
async function dialNext(
  batchId?: string,
): Promise<{ queue_id: string; conversation_id: string | null } | null> {
  // Pick a candidate batch that is running.
  let batchQ = supabase.from("call_batches").select("*").eq("status", "running");
  if (batchId) batchQ = batchQ.eq("id", batchId);
  const { data: batches } = await batchQ.order("created_at", { ascending: true });
  if (!batches?.length) return null;

  for (const batch of batches) {
    // concurrency check
    const { count: activeCount } = await supabase
      .from("call_queue")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batch.id)
      .eq("status", "dialing");
    if ((activeCount ?? 0) >= (batch.concurrency ?? 1)) continue;

    const { data: next } = await supabase
      .from("call_queue")
      .select("*")
      .eq("batch_id", batch.id)
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!next) continue;

    const agentPhoneNumberId =
      next.dynamic_vars?.agent_phone_number_id || batch.agent_phone_number_id;
    if (!agentPhoneNumberId) {
      await supabase
        .from("call_queue")
        .update({ status: "failed", last_error: "no agent_phone_number_id" })
        .eq("id", next.id);
      continue;
    }

    // Strip control keys before sending dynamic vars to the agent.
    const dyn: Record<string, string> = {};
    for (const [k, v] of Object.entries(next.dynamic_vars ?? {})) {
      if (k === "agent_phone_number_id") continue;
      if (v != null) dyn[k] = String(v);
    }
    if (next.lead_name) dyn.lead_name = next.lead_name;
    if (next.project) dyn.project = next.project;
    // Agent's first message requires {{callee_name}} — always send it.
    if (!dyn.callee_name) dyn.callee_name = next.lead_name || "ग्राहक";

    try {
      const r = await placeOutboundCall({
        agentPhoneNumberId,
        toNumber: next.lead_phone,
        dynamicVars: dyn,
      });
      await supabase
        .from("call_queue")
        .update({
          status: "dialing",
          conversation_id: r.conversation_id,
          sip_call_id: r.sip_call_id,
          attempts: (next.attempts ?? 0) + 1,
          dialed_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", next.id);
      return { queue_id: next.id, conversation_id: r.conversation_id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const attempts = (next.attempts ?? 0) + 1;
      const exhausted = attempts >= (next.max_attempts ?? 1);
      await supabase
        .from("call_queue")
        .update({
          status: exhausted ? "failed" : "queued",
          attempts,
          last_error: msg,
          completed_at: exhausted ? new Date().toISOString() : null,
        })
        .eq("id", next.id);
      // Try the next batch / row on the following tick.
      return { queue_id: next.id, conversation_id: null };
    }
  }
  return null;
}

// Mark running batches with no remaining queued/dialing rows as done.
async function closeFinishedBatches(batchId?: string): Promise<string[]> {
  let q = supabase.from("call_batches").select("id").eq("status", "running");
  if (batchId) q = q.eq("id", batchId);
  const { data: batches } = await q;
  const done: string[] = [];
  for (const b of batches ?? []) {
    const { count } = await supabase
      .from("call_queue")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", b.id)
      .in("status", ["queued", "dialing"]);
    if ((count ?? 0) === 0) {
      await supabase.from("call_batches").update({ status: "done" }).eq("id", b.id);
      done.push(b.id);
    }
  }
  return done;
}

export async function processTick(batchId?: string): Promise<TickResult> {
  const reconciled = await reconcile(batchId);
  const dialed = await dialNext(batchId);
  const batchDone = await closeFinishedBatches(batchId);
  const { count: active } = await supabase
    .from("call_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "dialing");
  return { reconciled, dialed, batchDone, active: active ?? 0 };
}
