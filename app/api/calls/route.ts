import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { DASHBOARD_SINCE } from "@/lib/config";
import { classifyReach } from "@/lib/callClass";

// Gated server-side reader for the `calls` table (service key, bypasses RLS).
// The dashboard used to query Supabase directly with the public anon key, which
// exposed all data to anyone who pulled the key from the JS bundle. Now every
// read flows through this route, which the proxy protects behind the password.
//
//   GET /api/calls            → latest 100 (since DASHBOARD_SINCE)
//   GET /api/calls?id=<uuid>  → single call
//   GET /api/calls?phone=<p>  → all calls for a phone (slim columns)
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const id = searchParams.get("id");
  const phone = searchParams.get("phone");
  const ids = searchParams.get("ids");

  if (id) {
    const { data, error } = await supabase.from("calls").select("*").eq("id", id).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ call: data });
  }

  // Explicit call_id lookup — used by the Site visits booked tab, whose rows can
  // be older than the 500-row list window below and would otherwise vanish.
  if (ids) {
    const list = ids.split(",").map((v) => v.trim()).filter(Boolean).slice(0, 200);
    if (list.length === 0) return NextResponse.json({ calls: [] });
    const { data, error } = await supabase
      .from("calls")
      .select("id,call_id,lead_name,lead_phone,project,source,lead_score,score_label,duration_seconds,outcome,summary,language,analysis,created_at,transcript")
      .in("call_id", list)
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ calls: withReach(data) });
  }

  if (phone) {
    const clean = phone.replace(/^\+/, "");
    const { data, error } = await supabase
      .from("calls")
      .select("id,call_id,duration_seconds,outcome,summary,lead_score,score_label,created_at,analysis,transcript")
      .or(`lead_phone.eq.+${clean},lead_phone.eq.${clean}`)
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ calls: data ?? [] });
  }

  // List view: slim columns (drop the heavy `transcript` jsonb — it loads on
  // click via ?id=) so we can return a much larger window without a huge payload.
  // 500 (was 100) so real connected calls aren't buried under a burst of missed
  // ones. isMissedCall falls back to analysis.call_initiation_failure + duration.
  let q = supabase
    .from("calls")
    .select("id,call_id,lead_name,lead_phone,project,source,lead_score,score_label,duration_seconds,outcome,summary,language,analysis,created_at,transcript")
    .order("created_at", { ascending: false })
    .limit(500);
  if (DASHBOARD_SINCE) q = q.gte("created_at", DASHBOARD_SINCE);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ calls: withReach(data) });
}

// The transcript is fetched only so the server can tell a real conversation
// from a voicemail greeting the agent talked over. It's stripped before the
// response — the list payload stays slim and the detail view loads it via ?id=.
type ListRow = Record<string, unknown> & {
  transcript?: { speaker?: string; side?: string; text?: string }[] | null;
};
function withReach(rows: ListRow[] | null) {
  return (rows ?? []).map((r) => {
    const { transcript, ...rest } = r;
    return { ...rest, reach: classifyReach({ ...r, transcript }) };
  });
}
