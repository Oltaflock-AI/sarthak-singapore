import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID!;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN!;

type Body =
  | { to: string; text: string; kind?: "text" }
  | { to: string; document_url: string; filename?: string; caption?: string; kind: "document" };

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || !body.to) {
    return NextResponse.json({ error: "to required" }, { status: 400 });
  }

  const url = `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`;
  let payload: Record<string, unknown>;
  let logText: string;

  if (body.kind === "document") {
    if (!body.document_url) return NextResponse.json({ error: "document_url required" }, { status: 400 });
    payload = {
      messaging_product: "whatsapp",
      to: body.to,
      type: "document",
      document: {
        link: body.document_url,
        filename: body.filename ?? "brochure.pdf",
        caption: body.caption ?? "",
      },
    };
    logText = `[brochure] ${body.filename ?? body.document_url}${body.caption ? " — " + body.caption : ""}`;
  } else {
    if (!("text" in body) || !body.text) {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }
    payload = {
      messaging_product: "whatsapp",
      to: body.to,
      type: "text",
      text: { body: body.text },
    };
    logText = body.text;
  }

  const metaRes = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const metaJson = await metaRes.json().catch(() => null);
  if (!metaRes.ok) {
    return NextResponse.json({ error: "Meta send failed", meta: metaJson }, { status: 502 });
  }

  await supabase.from("wa_messages").insert({
    from_number: body.to,
    name: "Agent",
    text_in: null,
    text_out: logText,
  });

  return NextResponse.json({ ok: true, meta: metaJson });
}
