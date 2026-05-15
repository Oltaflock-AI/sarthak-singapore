import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const phone = searchParams.get("phone");
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });

  // accept "+91..." or "91..."
  const noPlus = phone.replace(/^\+/, "");
  const { data, error } = await supabase
    .from("wa_messages")
    .select("*")
    .or(`from_number.eq.${noPlus},from_number.eq.+${noPlus}`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
