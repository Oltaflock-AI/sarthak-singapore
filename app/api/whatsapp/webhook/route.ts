import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getPriyaReply } from "@/lib/openai";

const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID!;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN!;
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN!;

// ─── Webhook verification (Meta calls this once during setup) ────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// ─── Incoming messages ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Always return 200 immediately — Meta will retry if you don't
  const body = await req.json().catch(() => null);
  processMessage(body).catch(console.error);
  return NextResponse.json({ status: "ok" });
}

async function processMessage(body: Record<string, unknown> | null) {
  if (!body) return;

  const entry = (body.entry as Record<string, unknown>[])?.[0];
  const change = (entry?.changes as Record<string, unknown>[])?.[0];
  const value = change?.value as Record<string, unknown> | undefined;

  const messages = value?.messages as Record<string, unknown>[] | undefined;
  if (!messages?.length) return;

  const msg = messages[0];
  const msgType = msg.type as string;
  if (msgType !== "text") return; // only handle text for now

  const fromNumber = msg.from as string;
  const waId = msg.id as string;
  const textBody = (msg.text as Record<string, unknown>)?.body as string ?? "";

  const contacts = value?.contacts as Record<string, unknown>[] | undefined;
  const name = (contacts?.[0]?.profile as Record<string, unknown>)?.name as string ?? fromNumber;

  // Generate Priya's reply
  const reply = await getPriyaReply(textBody);

  // Send reply via Meta Graph API
  await sendWhatsAppMessage(fromNumber, reply);

  // Persist conversation turn
  await supabase.from("wa_messages").insert({
    wa_id: waId,
    from_number: fromNumber,
    name,
    text_in: textBody,
    text_out: reply,
  });
}

async function sendWhatsAppMessage(to: string, text: string) {
  await fetch(
    `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    }
  );
}
