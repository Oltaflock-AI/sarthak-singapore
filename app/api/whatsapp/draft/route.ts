import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getPriyaReply } from "@/lib/openai";

export async function POST(req: NextRequest) {
  const { to } = await req.json().catch(() => ({}));
  if (!to) return NextResponse.json({ error: "to required" }, { status: 400 });

  const { data: rows } = await supabase
    .from("wa_messages")
    .select("text_in,text_out,created_at")
    .eq("from_number", to)
    .order("created_at", { ascending: true })
    .limit(20);

  const turns = rows ?? [];
  if (turns.length === 0) {
    return NextResponse.json({ error: "no conversation history" }, { status: 404 });
  }

  // Most recent row with a user message is what we're replying to
  let lastUserIdx = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].text_in) { lastUserIdx = i; break; }
  }
  if (lastUserIdx === -1) {
    return NextResponse.json({ error: "no user message to respond to" }, { status: 404 });
  }
  const lastUserMsg = turns[lastUserIdx].text_in as string;

  // History = all turns before lastUserIdx, flattened user→assistant
  const history: { role: "user" | "assistant"; content: string }[] = [];
  for (let i = 0; i < lastUserIdx; i++) {
    const r = turns[i];
    if (r.text_in) history.push({ role: "user", content: r.text_in });
    if (r.text_out) history.push({ role: "assistant", content: r.text_out });
  }
  // Include the assistant text on the lastUser row only if it exists AND is not the one we're regenerating
  // (we ignore turns[lastUserIdx].text_out since we're drafting a new reply)

  const draft = await getPriyaReply(lastUserMsg, history);
  return NextResponse.json({ draft, last_user_msg: lastUserMsg });
}
