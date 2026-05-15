import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { buildSystemPrompt, callPriyaRich, openai, extractLeadData, type ExtractedLead } from "@/lib/openai";
import { normalizePhone } from "@/lib/format";

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
  const body = await req.json().catch(() => null);
  try {
    await processMessage(body);
  } catch (err) {
    console.error("processMessage failed:", err);
  }
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
  const fromNumber = msg.from as string;

  let textBody = "";
  if (msgType === "text") {
    textBody = (msg.text as Record<string, unknown>)?.body as string ?? "";
  } else if (msgType === "interactive") {
    const interactive = msg.interactive as Record<string, unknown> | undefined;
    const buttonReply = interactive?.button_reply as { id?: string; title?: string } | undefined;
    const listReply = interactive?.list_reply as { id?: string; title?: string } | undefined;
    textBody = (buttonReply?.title ?? listReply?.title ?? "").toString();
  } else if (msgType === "audio" || msgType === "voice") {
    const audio = msg[msgType] as Record<string, unknown> | undefined;
    const mediaId = audio?.id as string | undefined;
    if (mediaId) {
      textBody = await transcribeWhatsAppAudio(mediaId).catch(() => "");
    }
    if (!textBody) {
      await sendWhatsAppMessage(fromNumber, "Sorry, I couldn't understand that voice note. Could you send it as text?");
      return;
    }
  } else {
    return; // ignore unsupported types (images, docs, etc. — for now)
  }

  const contacts = value?.contacts as Record<string, unknown>[] | undefined;
  const name = (contacts?.[0]?.profile as Record<string, unknown>)?.name as string ?? fromNumber;

  // Parallel: build KB-injected system prompt AND fetch history
  const [systemPrompt, priorTurnsRes] = await Promise.all([
    buildSystemPrompt(),
    supabase
      .from("wa_messages")
      .select("text_in,text_out,created_at")
      .eq("from_number", fromNumber)
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  const history = (priorTurnsRes.data ?? [])
    .reverse()
    .flatMap((r) => {
      const turns: { role: "user" | "assistant"; content: string }[] = [];
      if (r.text_in) turns.push({ role: "user", content: r.text_in });
      if (r.text_out) turns.push({ role: "assistant", content: r.text_out });
      return turns;
    });

  // Parallel: generate Priya's rich reply AND extract structured lead data
  const [rich, extracted] = await Promise.all([
    callPriyaRich(systemPrompt, textBody, history),
    extractLeadData(systemPrompt, textBody, history),
  ]);

  // Send: interactive (buttons) or plain text
  const sendPromise = rich.buttons?.length
    ? sendWhatsAppButtons(fromNumber, rich.text, rich.buttons)
    : sendWhatsAppMessage(fromNumber, rich.text);

  await Promise.all([
    sendPromise,
    supabase.from("wa_messages").insert({
      from_number: fromNumber,
      name,
      text_in: textBody,
      text_out: rich.text,
    }),
    handleCrmSideEffects(fromNumber, name, extracted),
  ]);
}

async function handleCrmSideEffects(
  phone: string,
  name: string,
  extracted: ExtractedLead | null
) {
  // Always upsert lead row — even if extractor returned nothing, we still log the contact.
  const e = extracted ?? ({} as Partial<ExtractedLead>);
  const leadPhone = normalizePhone(phone);
  // Look up any prior lead row under either the canonical key or the legacy unprefixed key.
  const legacyPhone = leadPhone.replace(/^\+/, "");
  const { data: existing } = await supabase
    .from("leads")
    .select("*")
    .or(`phone.eq.${leadPhone},phone.eq.${legacyPhone}`)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const mergedName = e.name ?? existing?.name ?? (name && name !== phone ? name : null);
  const mergedProject = e.project ?? existing?.project ?? null;
  const mergedBuyerType = e.buyer_type ?? existing?.buyer_type ?? null;
  const mergedResidency = e.residency ?? existing?.residency ?? null;
  const mergedTimeline = e.timeline ?? existing?.timeline ?? null;
  const mergedBudget = e.budget ?? existing?.budget ?? null;

  // Auto-compute status progression
  let status = existing?.status ?? "new";
  const hasQualifyingData = mergedBuyerType || mergedResidency || mergedTimeline || mergedBudget || mergedProject;
  if (status === "new" && hasQualifyingData) status = "qualified";
  if (e.site_visit_request) status = "booked";
  // 'converted' and 'lost' remain manual via dashboard

  const merged = {
    phone: leadPhone,
    name: mergedName,
    project: mergedProject,
    buyer_type: mergedBuyerType,
    residency: mergedResidency,
    timeline: mergedTimeline,
    budget: mergedBudget,
    lead_score: Math.max(e.lead_score ?? 50, existing?.lead_score ?? 0),
    score_label: e.score_label ?? existing?.score_label ?? "WARM",
    source: existing?.source ?? "whatsapp",
    status,
  };
  // If a legacy (unprefixed) row exists for this phone, delete it so the upsert
  // under the canonical `+E.164` key doesn't create a second row.
  if (existing?.phone && existing.phone !== leadPhone) {
    await supabase.from("leads").delete().eq("phone", existing.phone);
  }
  await supabase.from("leads").upsert(merged, { onConflict: "phone" });

  // Book site visit if requested — dedupe so repeat mentions don't create duplicates
  if (e.site_visit_request) {
    const wantedProject = e.site_visit_request.project ?? mergedProject;
    const { data: existingVisit } = await supabase
      .from("site_visits")
      .select("id,scheduled_for_text,status")
      .eq("lead_phone", phone)
      .in("status", ["pending", "confirmed"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!existingVisit) {
      await supabase.from("site_visits").insert({
        lead_phone: phone,
        lead_name: mergedName,
        project: wantedProject,
        scheduled_for_text: e.site_visit_request.when_text,
        status: "pending",
      });
    } else if (
      e.site_visit_request.when_text &&
      e.site_visit_request.when_text !== existingVisit.scheduled_for_text
    ) {
      await supabase
        .from("site_visits")
        .update({
          project: wantedProject,
          scheduled_for_text: e.site_visit_request.when_text,
        })
        .eq("id", existingVisit.id);
    }
  }

  // 3) Auto-send brochure if requested AND a matching project has brochure_url
  if (extracted?.brochure_request?.project) {
    const wanted = extracted.brochure_request.project.toLowerCase();
    const { data: kb } = await supabase
      .from("kb_projects")
      .select("name,brochure_url")
      .eq("is_active", true);
    const match = (kb ?? []).find(
      (p) => p.brochure_url && (p.name.toLowerCase().includes(wanted) || wanted.includes(p.name.toLowerCase()))
    );
    if (match?.brochure_url) {
      // Dedupe: only send once per (phone, project). Check if a [brochure] log already exists.
      const brochureMarker = `[brochure] ${match.name}`;
      const { data: alreadySent } = await supabase
        .from("wa_messages")
        .select("id")
        .eq("from_number", phone)
        .eq("text_out", brochureMarker)
        .limit(1)
        .maybeSingle();

      if (!alreadySent) {
        await fetch(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: phone,
            type: "document",
            document: {
              link: match.brochure_url,
              filename: `${match.name.replace(/\s+/g, "_")}.pdf`,
              caption: `${match.name} — brochure`,
            },
          }),
        }).catch((e) => console.error("brochure send failed:", e));

        await supabase.from("wa_messages").insert({
          from_number: phone,
          name: "Priya (auto)",
          text_in: null,
          text_out: brochureMarker,
        });
      }
    }
  }
}

async function transcribeWhatsAppAudio(mediaId: string): Promise<string> {
  // 1) Resolve media URL from Meta
  const metaRes = await fetch(`https://graph.facebook.com/v25.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!metaRes.ok) throw new Error(`meta media lookup failed: ${metaRes.status}`);
  const { url, mime_type } = (await metaRes.json()) as { url: string; mime_type?: string };

  // 2) Download audio (URL is short-lived, requires auth header)
  const audioRes = await fetch(url, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
  if (!audioRes.ok) throw new Error(`media download failed: ${audioRes.status}`);
  const buf = Buffer.from(await audioRes.arrayBuffer());

  // 3) Whisper transcription
  const ext = (mime_type ?? "audio/ogg").includes("mp4") ? "m4a" : "ogg";
  const file = new File([buf], `voice.${ext}`, { type: mime_type ?? "audio/ogg" });
  const result = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
  });
  return (result.text ?? "").trim();
}

async function sendWhatsAppButtons(to: string, body: string, buttons: { id: string; title: string }[]) {
  await fetch(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body.slice(0, 1024) },
        action: {
          buttons: buttons.slice(0, 3).map((b) => ({
            type: "reply",
            reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
          })),
        },
      },
    }),
  });
}

async function sendWhatsAppMessage(to: string, text: string) {
  await fetch(
    `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
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
