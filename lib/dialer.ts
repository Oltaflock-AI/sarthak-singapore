// Server-side dialer engine. Shared by the browser-driven loop and the Vercel
// cron — both just hit /api/voice/process, which calls processTick().
//
// Pacing model: each batch dials up to `concurrency` rows at once. A row goes
// queued → dialing (we fired the ElevenLabs call) → completed/failed. We learn
// a dialing row finished because the elevenlabs-webhook writes a `calls` row
// keyed by call_id = conversation_id. A dialing row with no matching `calls`
// row after STALE_MIN is settled anyway so the queue never wedges.
//
// Callback model: if the call ends without a pickup (busy / no-answer) and the
// row still has attempts left, it is re-queued with next_attempt_at pushed out
// by the batch's retry_interval_minutes (default 120 = call back in 2 hours).
// dialNext only picks queued rows that are due, so the cron drives callbacks
// even when nobody has the dashboard open.

import { supabase } from "@/lib/supabase";
import { placeOutboundCall, greetingFor, isQuotaError } from "@/lib/elevenlabs";
import { checkCredits, pauseAllCampaigns } from "@/lib/creditGuard";
import { cleanLeadName } from "@/lib/leadImport";

const STALE_MIN = 6;

// When placing a call THROWS (EL/VoBiz rejected, network, out of credits), hold
// the row this long before it's eligible again. Without a backoff a failed dial
// is re-queued with no next_attempt_at → immediately due → re-fired on the very
// next tick (every few seconds with the dashboard open). That tight loop is the
// July retry storm: same lead dialed repeatedly, VoBiz tripped to 3/3. 30 min of
// spacing kills it while still recovering quickly once the API is healthy again.
const CONNECT_FAIL_BACKOFF_MIN = 30;

// Hard ceiling on simultaneous outbound calls across ALL batches. The VoBiz
// trunk allows only 3 concurrent channels, and a warm transfer consumes an
// extra channel (प्रिया dials the salesman while the caller holds). Running at
// 3 saturates the trunk → VoBiz rejects new calls AND transfer legs can't get a
// channel (the transfer loops). Cap at 2 to keep 1 channel free for transfers.
// Bump this up only if the VoBiz concurrency limit is raised.
const MAX_GLOBAL_CONCURRENCY = 2;

// VoBiz gives us only 3 SIP channels, and a channel is NOT freed the instant a
// call ends: a clean hangup releases fast, but a dropped/badly-ended call can
// hold its channel until a BYE/timeout (up to ~30s), and a warm transfer briefly
// needs a 3rd channel too. So after ANY call ends we wait out this cooldown
// before dialing a replacement — otherwise the new call grabs a channel while
// the previous one is still tearing down and we trip VoBiz's 3/3 limit. Tune via
// DIAL_COOLDOWN_SECS. The real fix is more VoBiz channels (EL now allows 20).
const POST_CALL_COOLDOWN_SECS = Number(process.env.DIAL_COOLDOWN_SECS) || 15;

// `calls.outcome` values that mean the lead never picked up. The webhook's
// call_initiation_failure handler writes the ElevenLabs failure_reason
// verbatim (busy | no-answer | unknown), defaulting to "failed".
const NO_PICKUP = new Set(["busy", "no-answer", "no_answer", "unknown", "failed", "voicemail"]);

// Only place calls during business hours in India (IST = UTC+5:30). Outside the
// window the tick still reconciles/reschedules — it just doesn't dial, so no
// lead is ever rung in the middle of the night. Cron runs 24/7; this is the gate.
const CALL_WINDOW_START_MIN = 10 * 60; // 10:00 IST
const CALL_WINDOW_END_MIN = 20 * 60; //   20:00 IST
export function withinCallWindowIST(now: Date = new Date()): boolean {
  const istMin = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440;
  return istMin >= CALL_WINDOW_START_MIN && istMin < CALL_WINDOW_END_MIN;
}

interface BatchRow {
  id: string;
  status: string;
  agent_phone_number_id: string | null;
  concurrency: number | null;
  ringing_timeout_secs: number | null;
  retry_interval_minutes: number | null;
  max_attempts: number | null;
  retry_days: number[] | null; // e.g. [1,3,5,7,15,30] → multi-day cadence
}

export interface TickResult {
  reconciled: number;
  rescheduled: number; // no-pickup rows pushed to a future retry
  dialed: { queue_id: string; conversation_id: string | null }[];
  batchDone: string[];
  active: number;
}

async function loadBatches(batchId?: string, status = "running"): Promise<BatchRow[]> {
  let q = supabase.from("call_batches").select("*").eq("status", status);
  if (batchId) q = q.eq("id", batchId);
  const { data } = await q.order("created_at", { ascending: true });
  return (data ?? []) as BatchRow[];
}

// Push a no-pickup row back into the queue for a later attempt, or mark it
// failed when its attempts are spent.
async function settleNoPickup(
  row: { id: string; attempts: number | null; max_attempts: number | null },
  batch: BatchRow | undefined,
  outcome: string,
): Promise<"rescheduled" | "failed"> {
  const attempts = row.attempts ?? 0; // dials already made (>=1 here)
  const days = Array.isArray(batch?.retry_days) ? batch.retry_days : null;

  // Multi-day cadence (e.g. [1,3,5,7,15,30]): attempt N lands on day retry_days[N-1]
  // from the first call. After retry_days.length attempts, stop calling.
  if (days && days.length) {
    if (attempts < days.length) {
      const gapDays = Math.max(0, (days[attempts] ?? 0) - (days[attempts - 1] ?? 0));
      await supabase
        .from("call_queue")
        .update({
          status: "queued",
          outcome,
          next_attempt_at: new Date(Date.now() + gapDays * 86_400_000).toISOString(),
          last_error: `${outcome} — callback ${attempts + 1}/${days.length} in ${gapDays}d`,
          conversation_id: null,
          sip_call_id: null,
          completed_at: null,
        })
        .eq("id", row.id);
      return "rescheduled";
    }
    await supabase
      .from("call_queue")
      .update({
        status: "failed",
        outcome,
        last_error: `${outcome} — stopped after ${attempts} attempts over ${days[days.length - 1]} days`,
        completed_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    return "failed";
  }

  // Flat interval fallback: call back every retry_interval_minutes up to max_attempts.
  const maxAttempts = row.max_attempts ?? 1;
  if (attempts < maxAttempts) {
    const minutes = batch?.retry_interval_minutes ?? 120;
    await supabase
      .from("call_queue")
      .update({
        status: "queued",
        outcome,
        next_attempt_at: new Date(Date.now() + minutes * 60_000).toISOString(),
        last_error: `${outcome} — callback ${attempts + 1}/${maxAttempts} in ${minutes} min`,
        conversation_id: null,
        sip_call_id: null,
        completed_at: null,
      })
      .eq("id", row.id);
    return "rescheduled";
  }
  await supabase
    .from("call_queue")
    .update({
      status: "failed",
      outcome,
      last_error: `${outcome} — gave up after ${attempts} attempt${attempts === 1 ? "" : "s"}`,
      completed_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  return "failed";
}

// Settle any 'dialing' rows whose call has ended (calls row exists) or gone stale.
async function reconcile(
  batchId?: string,
): Promise<{ reconciled: number; rescheduled: number }> {
  let q = supabase.from("call_queue").select("*").eq("status", "dialing");
  if (batchId) q = q.eq("batch_id", batchId);
  const { data: dialing } = await q;
  if (!dialing?.length) return { reconciled: 0, rescheduled: 0 };

  // batch retry config for rescheduling
  const batchIds = [...new Set(dialing.map((r) => r.batch_id).filter(Boolean))];
  const { data: batchRows } = await supabase
    .from("call_batches")
    .select("*")
    .in("id", batchIds);
  const batches = new Map((batchRows ?? []).map((b) => [b.id, b as BatchRow]));

  let settled = 0;
  let rescheduled = 0;
  const staleBefore = new Date(Date.now() - STALE_MIN * 60_000).toISOString();

  for (const row of dialing) {
    if (row.conversation_id) {
      const { data: call } = await supabase
        .from("calls")
        .select("outcome,duration_seconds")
        .eq("call_id", row.conversation_id)
        .maybeSingle();
      if (call) {
        const outcome = (call.outcome ?? "completed").toLowerCase();
        const pickedUp = !NO_PICKUP.has(outcome) || (call.duration_seconds ?? 0) > 0;
        if (pickedUp) {
          await supabase
            .from("call_queue")
            .update({
              status: "completed",
              outcome: call.outcome ?? "completed",
              completed_at: new Date().toISOString(),
            })
            .eq("id", row.id);
        } else {
          const r = await settleNoPickup(row, batches.get(row.batch_id), outcome);
          if (r === "rescheduled") rescheduled++;
        }
        settled++;
        continue;
      }
    }
    // No calls row yet — settle it only if it has been dialing too long.
    // Treat stale as a no-pickup so leads still get their callback.
    if (row.dialed_at && row.dialed_at < staleBefore) {
      const r = await settleNoPickup(row, batches.get(row.batch_id), "no-answer");
      if (r === "rescheduled") rescheduled++;
      settled++;
    }
  }
  return { reconciled: settled, rescheduled };
}

// Fill every free slot: for each running batch, dial due queued rows until the
// batch's concurrency is reached.
async function dialNext(
  batchId?: string,
): Promise<{ queue_id: string; conversation_id: string | null }[]> {
  if (!withinCallWindowIST()) return []; // no calls outside 10:00–20:00 IST

  // No credits, no calls. Checked before anything is dialed so an empty balance
  // costs nothing; see lib/creditGuard.ts for why this brake fails open and the
  // quota-rejection brake below does not.
  const credits = await checkCredits();
  if (credits.blocked) {
    await pauseAllCampaigns(credits.reason ?? "ElevenLabs credits exhausted");
    return [];
  }

  // Post-call cooldown: if any call ended very recently, hold off dialing so its
  // VoBiz channel has time to tear down (see POST_CALL_COOLDOWN_SECS). The webhook
  // writes a `calls` row when a call ends, so the newest row ≈ the last hangup.
  {
    const { data: lastCall } = await supabase
      .from("calls")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastCall?.created_at) {
      const secsSince = (Date.now() - new Date(lastCall.created_at).getTime()) / 1000;
      if (secsSince >= 0 && secsSince < POST_CALL_COOLDOWN_SECS) return [];
    }
  }

  const batches = await loadBatches(batchId);
  if (!batches.length) return [];

  const dialed: { queue_id: string; conversation_id: string | null }[] = [];
  const nowIso = new Date().toISOString();

  // Global ceiling first — count every in-flight call regardless of batch.
  const { count: globalActive } = await supabase
    .from("call_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "dialing");
  let globalFree = MAX_GLOBAL_CONCURRENCY - (globalActive ?? 0);
  if (globalFree <= 0) return [];

  for (const batch of batches) {
    if (globalFree <= 0) break;
    const { count: activeCount } = await supabase
      .from("call_queue")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batch.id)
      .eq("status", "dialing");
    let free = Math.min((batch.concurrency ?? 1) - (activeCount ?? 0), globalFree);

    while (free > 0) {
      const { data: next } = await supabase
        .from("call_queue")
        .select("*")
        .eq("batch_id", batch.id)
        .eq("status", "queued")
        .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!next) break;

      const agentPhoneNumberId =
        next.dynamic_vars?.agent_phone_number_id || batch.agent_phone_number_id;
      if (!agentPhoneNumberId) {
        await supabase
          .from("call_queue")
          .update({ status: "failed", last_error: "no agent_phone_number_id" })
          .eq("id", next.id);
        continue;
      }

      // Which property agent dials this lead (Miracle / One Street / Grand
      // Virasat). Set by the Zoho sync per campaign; absent → default agent.
      const agentId = next.dynamic_vars?.agent_id as string | undefined;

      // Strip control keys before sending dynamic vars to the agent. callee_name
      // is set by greetingFor below, so drop any stale copy from the queue row.
      const dyn: Record<string, string> = {};
      for (const [k, v] of Object.entries(next.dynamic_vars ?? {})) {
        if (k === "agent_phone_number_id" || k === "callee_name" || k === "agent_id") continue;
        if (v != null) dyn[k] = String(v);
      }
      if (next.project) dyn.project = next.project;
      // Named lead → greet by name (default first message); no name → name-less
      // first-message override (never "Unknown जी" / "ग्राहक जी").
      const greet = greetingFor(cleanLeadName(next.lead_name));
      Object.assign(dyn, greet.dynamicVars);

      try {
        const r = await placeOutboundCall({
          agentPhoneNumberId,
          agentId,
          toNumber: next.lead_phone,
          dynamicVars: dyn,
          firstMessageOverride: greet.firstMessageOverride,
          ringingTimeoutSecs: batch.ringing_timeout_secs ?? undefined,
        });
        await supabase
          .from("call_queue")
          .update({
            status: "dialing",
            conversation_id: r.conversation_id,
            sip_call_id: r.sip_call_id,
            attempts: (next.attempts ?? 0) + 1,
            dialed_at: new Date().toISOString(),
            next_attempt_at: null,
            last_error: null,
          })
          .eq("id", next.id);
        dialed.push({ queue_id: next.id, conversation_id: r.conversation_id });
        free--;
        globalFree--;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);

        // Out of credits is not a transient failure — ElevenLabs will reject
        // every subsequent call too. Pause every campaign so the cron can't keep
        // grinding through the queue, and put this lead back as due now: it was
        // never actually dialed, and nothing else is competing for the slot.
        if (isQuotaError(msg)) {
          await supabase
            .from("call_queue")
            .update({ status: "queued", next_attempt_at: null, last_error: `paused — ${msg}` })
            .eq("id", next.id);
          await pauseAllCampaigns(`ElevenLabs rejected a call: ${msg}`);
          return dialed;
        }

        // The call was never placed (EL/VoBiz rejected, network).
        // Deliberately do NOT touch `attempts` — that counter drives the multi-day
        // retry cadence, and a placement failure isn't a real dial; burning it
        // would let a transient outage march a lead through 1→3→5→7→15→30 and give
        // up on the whole campaign without ever reaching anyone. And do NOT re-queue
        // as immediately-due (the old bug): back off first so we don't re-fire on
        // the next tick. Once the API is healthy the row dials normally next window.
        await supabase
          .from("call_queue")
          .update({
            status: "queued",
            next_attempt_at: new Date(Date.now() + CONNECT_FAIL_BACKOFF_MIN * 60_000).toISOString(),
            last_error: msg,
          })
          .eq("id", next.id);
        dialed.push({ queue_id: next.id, conversation_id: null });
        break; // API is unhappy — stop dialing this batch; retry after the backoff
      }
    }
  }
  return dialed;
}

// Mark running batches with no remaining queued/dialing rows as done. Rows
// waiting on a future next_attempt_at still count as queued, so a batch stays
// running until every callback is resolved.
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

// Only one dialer tick may DIAL at a time. The dashboard polls /api/voice/process
// every few seconds AND a GitHub cron hits it every 10 min; without this, two
// ticks each read the in-flight count, both see a free slot, and both dial —
// overshooting MAX_GLOBAL_CONCURRENCY and tripping VoBiz's 3/3 limit. Atomic
// single-row lock (dialer_lock migration); auto-expires after the TTL if a tick
// dies mid-dial. Reconcile still runs every tick — only dialing is serialized.
const DIAL_LOCK_TTL_SECS = 150;

async function acquireDialLock(): Promise<boolean> {
  const staleBefore = new Date(Date.now() - DIAL_LOCK_TTL_SECS * 1000).toISOString();
  const { data, error } = await supabase
    .from("dialer_lock")
    .update({ locked_at: new Date().toISOString() })
    .eq("id", 1)
    .lt("locked_at", staleBefore)
    .select("id");
  if (error) {
    console.error("[dialer] lock acquire error:", error.message);
    return false; // fail closed — skip this tick's dialing; next tick retries
  }
  return (data?.length ?? 0) > 0;
}

async function releaseDialLock(): Promise<void> {
  // Free it immediately (epoch < any TTL window) so the next tick can dial.
  await supabase.from("dialer_lock").update({ locked_at: new Date(0).toISOString() }).eq("id", 1);
}

export async function processTick(batchId?: string): Promise<TickResult> {
  const { reconciled, rescheduled } = await reconcile(batchId);
  // Serialize dialing across all concurrent ticks (dashboard + cron + tabs) so we
  // never overshoot the concurrency cap and trip VoBiz's 3/3 limit.
  let dialed: { queue_id: string; conversation_id: string | null }[] = [];
  if (await acquireDialLock()) {
    try {
      dialed = await dialNext(batchId);
    } finally {
      await releaseDialLock();
    }
  }
  const batchDone = await closeFinishedBatches(batchId);
  const { count: active } = await supabase
    .from("call_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "dialing");
  return { reconciled, rescheduled, dialed, batchDone, active: active ?? 0 };
}
