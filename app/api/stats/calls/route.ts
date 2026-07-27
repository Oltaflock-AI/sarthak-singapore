import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { DASHBOARD_SINCE } from "@/lib/config";
import { summariseCalls, summariseDials, type CallStatRow, type DialRow } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Call-level stats for the dashboard KPIs (pickup rate + leads actually reached).
//
// The dashboard's /api/calls feed is capped at the latest 500 rows, so an answer
// rate computed in the browser would silently be "answer rate of the last 500
// calls". This route walks the whole table instead — slim columns, paged past
// PostgREST's 1000-row cap — so the numbers are true totals.

export async function GET() {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const rows: CallStatRow[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      let q = supabase
        .from("calls")
        .select("lead_phone,duration_seconds,created_at")
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (DASHBOARD_SINCE) q = q.gte("created_at", DASHBOARD_SINCE);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const page = (data ?? []) as CallStatRow[];
      rows.push(...page);
      if (page.length < PAGE) break;
    }

    // Dialer workload + pickup rate. Header-only counts where possible, so this
    // stays cheap enough to poll: Postgres returns the count and no rows.
    const queueCount = async (status: string) => {
      const { count, error } = await supabase
        .from("call_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      if (error) throw new Error(error.message);
      return count ?? 0;
    };
    const todayIso = startOfToday.toISOString();
    const [queued, dialing, runningBatches, dialsToday, answeredToday] = await Promise.all([
      queueCount("queued"),
      queueCount("dialing"),
      supabase
        .from("call_batches")
        .select("id", { count: "exact", head: true })
        .eq("status", "running")
        .then(({ count }) => count ?? 0),
      // dialed_at holds the LATEST dial, so a lead re-dialled twice in one day
      // counts once here — a slight undercount of today's attempts, never an
      // overcount.
      supabase
        .from("call_queue")
        .select("id", { count: "exact", head: true })
        .gte("dialed_at", todayIso)
        .then(({ count }) => count ?? 0),
      supabase
        .from("call_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "completed")
        .gte("completed_at", todayIso)
        .then(({ count }) => count ?? 0),
    ]);

    // Attempt totals need the rows: PostgREST aggregates are disabled on this
    // project ("Use of aggregate functions is not allowed"), so page two columns.
    const dialRows: DialRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("call_queue")
        .select("status,attempts,lead_phone,project")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as DialRow[];
      dialRows.push(...page);
      if (page.length < PAGE) break;
    }
    const dials = summariseDials(dialRows, dialsToday, answeredToday);

    const calls = summariseCalls(rows, startOfToday);

    return NextResponse.json(
      {
        // `calls`-derived answer_rate is deliberately dropped: it counts only
        // conversations that reached the webhook, so it reads ~100% since
        // 2026-07-04. `dials` supplies the honest rate, and spreading it last
        // makes that explicit.
        ...calls,
        ...dials,
        queued_calls: queued,
        dialing_calls: dialing,
        running_batches: runningBatches,
        since: DASHBOARD_SINCE || null,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
