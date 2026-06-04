import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { DASHBOARD_SINCE } from "@/lib/config";

export async function GET() {
  let q = supabase
    .from("leads")
    .select("*")
    .order("updated_at", { ascending: false });
  if (DASHBOARD_SINCE) q = q.gte("updated_at", DASHBOARD_SINCE);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

const ALLOWED = ["name", "project", "buyer_type", "residency", "timeline", "budget", "lead_score", "score_label", "status", "notes"];

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const update: Record<string, unknown> = {};
  for (const k of ALLOWED) if (k in body) update[k] = body[k];
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  const { data, error } = await supabase
    .from("leads")
    .update(update)
    .eq("id", body.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
