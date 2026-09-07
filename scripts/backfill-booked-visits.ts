/**
 * Repair pass: restore booking truth on calls whose enrichment wrongly said
 * "no site visit booked".
 *
 * Background — the webhook records a site_visits row only when the cal.com tool
 * returns a real booking uid, so that table IS the truth. The enrich pass then
 * re-verified via the ElevenLabs API; when that fetch failed it returned null,
 * which the old code read as "not booked" and wrote as fact — flipping
 * analysis.site_visit_booked to false and rewriting the outcome text on 15 real
 * bookings. The site_visits rows survived (enrich only deletes on a *verified*
 * no-booking), so we can rebuild the correct state from them.
 *
 *   npx tsx scripts/backfill-booked-visits.ts          # dry run
 *   npx tsx scripts/backfill-booked-visits.ts --apply  # write
 */
import { createClient } from "@supabase/supabase-js";
import { fmtVisitWhen } from "../lib/format";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY required");
const supabase = createClient(url, key, { auth: { persistSession: false } });

const APPLY = process.argv.includes("--apply");

// The wrong text enrich wrote, plus the generic placeholders it may have left.
const WRONG_OUTCOME = /no site visit booked|^success$|^completed$/i;

async function main() {
  const { data: visits, error } = await supabase
    .from("site_visits")
    .select("call_id, lead_phone, lead_name, scheduled_for, scheduled_for_text, notes");
  if (error) throw new Error(error.message);
  const rows = visits ?? [];
  console.log(`site_visits rows: ${rows.length}`);

  let callsFixed = 0;
  let leadsFixed = 0;

  for (const v of rows) {
    if (!v.call_id) continue;
    const { data: call } = await supabase
      .from("calls")
      .select("id, call_id, lead_name, outcome, analysis")
      .eq("call_id", v.call_id)
      .maybeSingle();
    if (!call) {
      console.log(`  ! no call row for ${v.call_id} (${v.lead_name ?? "?"})`);
      continue;
    }

    const analysis = (call.analysis ?? {}) as Record<string, unknown>;
    const needsFlag = analysis.site_visit_booked !== true;
    const needsDate = !analysis.site_visit_datetime && v.scheduled_for;
    const needsOutcome = WRONG_OUTCOME.test(String(call.outcome ?? ""));
    if (!needsFlag && !needsDate && !needsOutcome) continue;

    // scheduled_for_text is cal.com's raw UTC ISO on these rows — render it the
    // way the rest of the dashboard does ("28th July 10 AM", IST).
    const whenText = fmtVisitWhen(v.scheduled_for_text, v.scheduled_for);
    const when = whenText ? ` · ${whenText}` : "";
    const update: Record<string, unknown> = {
      analysis: {
        ...analysis,
        site_visit_booked: true,
        site_visit_datetime: analysis.site_visit_datetime ?? v.scheduled_for ?? null,
        // Mark where the truth came from, so a later pass doesn't re-litigate it.
        site_visit_source: "cal.com booking (site_visits)",
      },
    };
    if (needsOutcome) update.outcome = `Site visit booked${when}`;

    console.log(
      `  ${APPLY ? "fix" : "would fix"} ${call.lead_name ?? v.lead_name ?? "?"} — "${call.outcome}" → "${update.outcome ?? call.outcome}"`,
    );
    if (APPLY) {
      const { error: e } = await supabase.from("calls").update(update).eq("id", call.id);
      if (e) console.log(`    ! call update failed: ${e.message}`);
      else callsFixed++;
    } else callsFixed++;

    // Lead status is sticky upward, so this only ever promotes.
    const phone = v.lead_phone;
    if (phone) {
      const { data: lead } = await supabase
        .from("leads")
        .select("phone, status")
        .eq("phone", phone)
        .maybeSingle();
      if (lead && lead.status !== "booked") {
        console.log(`    lead ${phone}: ${lead.status} → booked`);
        if (APPLY) {
          const { error: le } = await supabase
            .from("leads")
            .update({ status: "booked" })
            .eq("phone", phone);
          if (le) console.log(`    ! lead update failed: ${le.message}`);
          else leadsFixed++;
        } else leadsFixed++;
      }
    }
  }

  console.log(`\n${APPLY ? "updated" : "would update"}: ${callsFixed} calls, ${leadsFixed} leads`);
  if (!APPLY) console.log("dry run — re-run with --apply to write");
}

main();
