import { supabase } from "@/lib/supabase";
import { getCreditUsage } from "@/lib/elevenlabs";

// Standing rule: when the ElevenLabs balance is gone, the dialer stops.
//
// Two independent brakes, because either one alone can miss:
//
//  1. checkCredits() — asked before each tick dials. Blocks while the balance is
//     at or below ELEVENLABS_MIN_CREDITS (default 0). Cached briefly so a
//     once-a-minute cron doesn't hammer the API.
//  2. pauseAllCampaigns() — called when ElevenLabs actually rejects a call for
//     quota. That is the authoritative signal, and it pauses every running
//     batch so nothing resumes until a human resumes it.
//
// The pre-check FAILS OPEN on a transient API error: a network blip must not
// silently halt a campaign. The rejection path is what guarantees we stop, since
// a quota-rejected call costs nothing.

const MIN_CREDITS = Number(process.env.ELEVENLABS_MIN_CREDITS) || 0;
const CACHE_MS = 60_000;

let cache: { at: number; result: CreditCheck } | null = null;

export interface CreditCheck {
  blocked: boolean;
  reason: string | null;
  remaining: number | null;
  used: number | null;
  total: number | null;
}

export async function checkCredits(force = false): Promise<CreditCheck> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.result;

  let result: CreditCheck;
  try {
    const u = await getCreditUsage();
    // remaining is null when the key can't read the plan quota — set
    // ELEVENLABS_PLAN_CREDITS to give the guard a denominator to work with.
    const blocked = u.remaining != null && u.remaining <= MIN_CREDITS;
    result = {
      blocked,
      reason: blocked
        ? `ElevenLabs credits exhausted — ${u.remaining?.toLocaleString("en-IN")} left of ${u.total?.toLocaleString("en-IN")}`
        : null,
      remaining: u.remaining,
      used: u.used,
      total: u.total,
    };
  } catch (e) {
    // Fail open — see note above.
    result = {
      blocked: false,
      reason: `credit check failed: ${e instanceof Error ? e.message : String(e)}`,
      remaining: null,
      used: null,
      total: null,
    };
  }

  cache = { at: Date.now(), result };
  return result;
}

// Stop every campaign. Returns the labels paused, so the caller can log them.
export async function pauseAllCampaigns(reason: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("call_batches")
    .update({ status: "paused" })
    .eq("status", "running")
    .select("label");
  if (error) throw new Error(`pause failed: ${error.message}`);
  const labels = (data ?? []).map((b) => String(b.label));
  if (labels.length) {
    console.error(`[dialer] paused ${labels.length} campaign(s): ${reason} — ${labels.join(", ")}`);
  }
  return labels;
}

// Test seam: drop the cached reading.
export function resetCreditCache() {
  cache = null;
}
