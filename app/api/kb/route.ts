import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const ALLOWED_FIELDS = [
  "slug", "name", "type", "configurations", "location", "possession",
  "hero", "pricing_notes", "usps", "amenities", "brochure_url",
  "rera_number", "custom_notes", "is_active", "display_order",
];

function pick(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of ALLOWED_FIELDS) if (k in input) out[k] = input[k];
  return out;
}

export async function GET() {
  const { data, error } = await supabase
    .from("kb_projects")
    .select("*")
    .order("display_order", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.slug || !body?.name || !body?.type) {
    return NextResponse.json({ error: "slug, name, type required" }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("kb_projects")
    .insert(pick(body))
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { id, ...rest } = body;
  const { data, error } = await supabase
    .from("kb_projects")
    .update(pick(rest))
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await supabase.from("kb_projects").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
