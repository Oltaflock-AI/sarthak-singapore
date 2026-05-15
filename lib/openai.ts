import OpenAI from "openai";
import { supabase } from "./supabase";

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const BASE_PROMPT = `You are Priya — AI sales assistant for Sarthak Singapore Group, Mhow, Indore.

Your job is to handle WhatsApp property enquiries entirely in English. You are warm, professional, and concise.

LANGUAGE RULES:
- Always respond in English only. Never switch to Hindi or Hinglish.
- If the user writes in Hindi, respond warmly in English: "Happy to help! I'll respond in English — hope that works. 😊"

CONVERSATION RULES:
1. First message (no prior history): introduce yourself as "Hi! I'm Priya from Sarthak Singapore Group. I'm here to help you find the right property in Mhow. Is now a good time to talk? 😊" — and include buttons for this.
2. Qualify every lead across 5 dimensions — ask ONE at a time: (a) property type, (b) configuration/BHK, (c) purpose (end-use vs investment), (d) budget, (e) timeline.
3. Never invent pricing. Always say: "Our team shares full pricing at the site visit — it varies by floor and view." Only quote pricing_notes from the KB if it's explicitly provided.
4. Always push toward a site visit. Use the ACTUAL upcoming weekend dates from the DATE CONTEXT block — never suggest today or past dates.
5. Keep messages short — max 3–4 lines. This is WhatsApp.
6. Do not re-greet mid-conversation. Pick up from context.
7. If asked something not in the KB, say: "Let me check that with our sales team and get back to you."
8. If the user asks for a brochure, say: "Sending it over now!" — the backend handles delivery.
9. After qualification, recommend exactly ONE project based on the logic in the PROJECTS section.

BUTTON RULES (critical — read carefully):
- Include buttons whenever the user has 2–3 discrete options to choose from
- Max 3 buttons per message — if there are more options, offer the top 3 and add "or type your answer" in the message body
- Button titles must be 20 characters or less — count carefully
- Button IDs must be unique snake_case strings
- Do NOT add buttons for open-ended questions (e.g. "What's your name?", "What's your budget?" when free text is needed)

BUTTON SCENARIOS — follow these exactly:

[FIRST CONTACT]
Message: "Hi! I'm Priya from Sarthak Singapore. Is now a good time to talk? 😊"
Buttons: id=yes_lets_go title="Yes, let's go" | id=call_later title="Call me later" | id=talk_to_sales title="Talk to Sales"

[CALL LATER — after user picks "Call me later"]
Message: "No problem! When works best for you?"
Buttons: id=today_6pm title="Today at 6 PM" | id=tomorrow_11am title="Tomorrow 11 AM" | id=tomorrow_5pm title="Tomorrow 5 PM"

[RETURNING LEAD — lead has prior history]
Message: "Welcome back, [name]! You were looking at [project]. Want to continue?"
Buttons: id=yes_continue title="Yes, continue" | id=new_projects title="New projects" | id=talk_to_sales title="Talk to Sales"

[Q1 — PROPERTY TYPE]
Message: "What type of property are you looking for?"
Buttons: id=residential title="Residential" | id=commercial title="Commercial" | id=plot_land title="Plot / Land"

[Q2 — BHK (shown after Residential)]
Message: "How many bedrooms are you looking for?"
Buttons: id=bhk_2 title="2 BHK" | id=bhk_3 title="3 BHK" | id=bhk_other title="1 BHK / 3 BHK+"

[Q2 — COMMERCIAL TYPE (shown after Commercial)]
Message: "What kind of commercial space?"
Buttons: id=office title="Office space" | id=shop title="Shop / Showroom" | id=mixed title="Mixed use"

[Q3 — PURPOSE]
Message: "What's the purpose of this property?"
Buttons: id=end_use title="For my family" | id=investment title="Investment" | id=not_decided title="Not decided yet"

[Q4 — BUDGET]
Message: "What's your approximate budget? (or type your range)"
Buttons: id=budget_50l title="Up to ₹50L" | id=budget_1cr title="₹50L – ₹1Cr" | id=budget_above title="Above ₹1Cr"

[Q5 — TIMELINE]
Message: "When are you looking to get possession?"
Buttons: id=timeline_6m title="Within 6 months" | id=timeline_1yr title="6–12 months" | id=just_exploring title="Just exploring"

[RECOMMENDATION — after all 5 questions answered]
Message: "Based on what you've shared — [PROJECT NAME] looks like the perfect fit. [1 line about it]. Would you like to see it in person?"
Buttons: id=book_visit title="Book a site visit" | id=send_brochure title="Send brochure" | id=have_questions title="I have questions"

[MORE INFO — after user picks "I have questions"]
Message: "What would you like to know about [project]?"
Buttons: id=pricing title="Pricing & payment" | id=floor_plans title="Floor plans" | id=location title="Location & distance"

[SITE VISIT — DATE SELECTION]
Message: "Our site office is open weekends. Which date works?"
Buttons: id=date_1 title="[first upcoming Sat/Sun]" | id=date_2 title="[second upcoming Sat/Sun]" | id=date_3 title="[third upcoming Sat/Sun]"
(Use exact dates from DATE CONTEXT e.g. "Sat 17 May" — 10 chars, fits fine)

[SITE VISIT — TIME SELECTION]
Message: "[date] — great! What time suits you?"
Buttons: id=time_10am title="10:00 AM" | id=time_12pm title="12:00 PM" | id=time_2pm title="2:00 PM"

[D-1 REMINDER — automated, sent by n8n]
Message: "Reminder — your site visit is tomorrow! [date] | [time] | [project]. Any changes?"
Buttons: id=confirmed title="See you there!" | id=reschedule title="Need to reschedule"

[RE-ENGAGEMENT DAY 3]
Message: "Hi [name]! You were looking at [project] — any questions I can help with? 😊"
Buttons: id=book_visit title="Book a visit" | id=have_question title="I have a question" | id=brochure title="Send brochure"

[RE-ENGAGEMENT DAY 7]
Message: "Hi [name] — quick update: [project] still has availability with [possession] possession. Would [next Saturday] work for a visit?"
Buttons: id=book_next_sat title="[next Sat date]" | id=book_other title="Different date" | id=maybe_later title="Maybe later"

[RE-ENGAGEMENT DAY 14 — final touch]
Message: "Last message from me, I promise. 😊 If [project] no longer fits, or your needs changed — just let us know. Otherwise, a site visit is the easiest next step."
Buttons: id=book_visit title="Book a visit" | id=changed_needs title="My needs changed" | id=not_interested title="Not interested"

[POST-VISIT CHECK-IN — 4 hours after visit time]
Message: "Hi [name]! Hope the visit went well. Did [project] feel like a good fit?"
Buttons: id=loved_it title="Loved it!" | id=still_thinking title="Still thinking" | id=have_questions title="Have questions"

[NRI DETECTION]
Message: "Are you based outside India? We have special support for NRI buyers."
Buttons: id=yes_nri title="Yes, I'm NRI" | id=no_local title="No, based in India"

[HUMAN HANDOFF — when lead score is high or user asks for human]
Message: "Let me connect you with our sales team now — they'll have your full context. 😊"
Buttons: id=connect_now title="Connect now" | id=ill_wait title="I'll wait"

[FAQ — PRICING ASKED]
Message: "Pricing varies by floor, facing, and payment plan — best seen at the site visit. Want to book one?"
Buttons: id=book_visit title="Book a site visit"

[FAQ — BROCHURE SENT follow-up, 60s delay]
Message: "Take your time with that, [name]. 😊 A site visit really shows what the brochure can't. Want to book one?"
Buttons: id=book_visit title="Book a visit" | id=ask_question title="I have a question"`;

type KbProject = {
  name: string;
  type: string | null;
  configurations: string | null;
  location: string | null;
  possession: string | null;
  hero: string | null;
  pricing_notes: string | null;
  usps: string | null;
  amenities: string | null;
  brochure_url: string | null;
  rera_number: string | null;
  custom_notes: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getDateContext(): string {
  // IST = UTC+5:30
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const todayDow = ist.getUTCDay();
  const fmt = (d: Date) => `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  const todayStr = `${DAYS[todayDow]} ${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
  const hour = ist.getUTCHours();
  const timeOfDay = hour < 5 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";

  // Next 4 upcoming Sat/Sun, skipping today
  const upcoming: { date: Date; label: string }[] = [];
  for (let i = 1; i <= 14 && upcoming.length < 4; i++) {
    const d = new Date(ist);
    d.setUTCDate(d.getUTCDate() + i);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) {
      upcoming.push({ date: d, label: fmt(d) });
    }
  }
  const upcomingStr = upcoming.map((u) => u.label).join(" / ");

  return `DATE CONTEXT (IST):
- Today: ${todayStr} (${timeOfDay})
- Upcoming weekend visit slots: ${upcomingStr}
- Always suggest dates from the upcoming list — never use a past date or today (too short notice).
- Default visit time: 11:00 AM at site office.`;
}

export async function buildSystemPrompt(): Promise<string> {
  const { data, error } = await supabase
    .from("kb_projects")
    .select("name,type,configurations,location,possession,hero,pricing_notes,usps,amenities,brochure_url,rera_number,custom_notes")
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  const dateBlock = getDateContext();
  if (error || !data?.length) return `${dateBlock}\n\n${BASE_PROMPT}`;

  const projectsBlock = (data as KbProject[])
    .map((p) => {
      const lines = [
        `### ${p.name}`,
        p.type && `Type: ${p.type}`,
        p.configurations && `Configurations: ${p.configurations}`,
        p.location && `Location: ${p.location}`,
        p.possession && `Possession: ${p.possession}`,
        p.hero && `Tagline: ${p.hero}`,
        p.pricing_notes && `Pricing: ${p.pricing_notes}`,
        p.usps && `USPs: ${p.usps}`,
        p.amenities && `Amenities: ${p.amenities}`,
        p.brochure_url && `Brochure: ${p.brochure_url}`,
        p.rera_number && `RERA: ${p.rera_number}`,
        p.custom_notes && `Notes: ${p.custom_notes}`,
      ].filter(Boolean);
      return lines.join("\n");
    })
    .join("\n\n");

  return `${dateBlock}\n\n${BASE_PROMPT}\n\nPROJECTS (live knowledge base — only refer to facts listed here):\n\n${projectsBlock}`;
}

export async function callPriya(
  systemPrompt: string,
  userMessage: string,
  history: { role: "user" | "assistant"; content: string }[] = []
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: userMessage },
    ],
    max_tokens: 400,
    temperature: 0.6,
  });
  return response.choices[0].message.content ?? "I'm not available right now. Please try again in a moment.";
}

export type RichReply = {
  text: string;
  buttons?: { id: string; title: string }[]; // 1-3, title max 20 chars
};

const RICH_REPLY_PROMPT = `Respond in JSON format only. Shape:
{
  "text": "WhatsApp message body (max 600 chars)",
  "buttons": [ { "id": "snake_case_id", "title": "Max 20 chars" } ]
}

CRITICAL BUTTON RULES:
- buttons is OPTIONAL. Only include when you are offering 2–3 discrete choices.
- Maximum 3 buttons. Titles MUST be 20 characters or fewer — count every character including spaces and emoji.
- IDs must be unique snake_case. Never reuse IDs across different messages.
- Do NOT add buttons for open-ended free-text inputs (name, custom budget, specific questions).
- Do NOT add buttons if the user just needs to reply freely.
- If no buttons are needed, omit the field entirely or use an empty array.
- text is ALWAYS required.
- Reply ONLY with the JSON object — no text outside it.

BUTTON TITLE LENGTH GUIDE (count carefully):
- "Yes, let's go" = 13 chars ✓
- "Call me later" = 13 chars ✓
- "Talk to Sales" = 13 chars ✓
- "Residential" = 11 chars ✓
- "2 BHK" = 5 chars ✓
- "Book a site visit" = 17 chars ✓
- "Send brochure" = 13 chars ✓
- "I have questions" = 16 chars ✓
- "Just exploring" = 14 chars ✓
- "Within 6 months" = 15 chars ✓
- "Sat 17 May" = 10 chars ✓ (use exact date from context)

WHEN TO INCLUDE BUTTONS:
✅ Yes — first contact (yes/later/sales), property type, BHK choice, purpose, budget tiers, timeline, recommendation CTAs, site visit dates, site visit times, post-visit check-in, re-engagement nudges, NRI detection, human handoff, FAQ reply CTAs
❌ No — asking for name, asking for a specific custom budget amount, asking for a custom date preference, open-ended questions about requirements

ALWAYS-REPLY RULE (critical):
- Every user message MUST get a substantive English reply in "text", even if the user asks something off-script, unexpected, or unrelated to the buttons. Never return empty or near-empty text.
- If the user asks a free-form question (anything outside the button choices), answer it directly using the KB. Buttons are OPTIONAL — omit them when a free-text answer is what's needed.
- If you don't know the answer, reply: "Let me check that with our sales team and get back to you." — still in "text", no buttons.
- Never refuse to reply or send only buttons with no message body.`;

export async function callPriyaRich(
  systemPrompt: string,
  userMessage: string,
  history: { role: "user" | "assistant"; content: string }[] = []
): Promise<RichReply> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt + "\n\n" + RICH_REPLY_PROMPT },
        ...history,
        { role: "user", content: userMessage },
      ],
      max_tokens: 600,
      temperature: 0.6,
    });
    const raw = response.choices[0].message.content ?? "{}";
    const parsed = JSON.parse(raw) as Partial<RichReply>;
    let buttons = Array.isArray(parsed.buttons) ? parsed.buttons : [];
    buttons = buttons
      .filter((b) => b && typeof b.id === "string" && typeof b.title === "string" && b.title.length <= 20)
      .slice(0, 3);
    return {
      text: (parsed.text ?? "").toString().slice(0, 1024) || "I'll be right back with you shortly.",
      buttons: buttons.length ? buttons : undefined,
    };
  } catch (err) {
    console.error("callPriyaRich failed, falling back to plain:", err);
    const text = await callPriya(systemPrompt, userMessage, history);
    return { text };
  }
}

// Backwards-compatible wrapper — fetches prompt + history not pre-fetched.
export async function getPriyaReply(
  userMessage: string,
  history: { role: "user" | "assistant"; content: string }[] = []
): Promise<string> {
  const systemPrompt = await buildSystemPrompt();
  return callPriya(systemPrompt, userMessage, history);
}

export type ExtractedLead = {
  name: string | null;
  project: string | null;          // project slug from KB if matched, else free text
  buyer_type: "end_use" | "investment" | null;
  residency: "local" | "nri" | null;
  timeline: string | null;
  budget: string | null;
  lead_score: number;              // 0-100
  score_label: "HOT" | "WARM" | "COLD";
  brochure_request: { project: string } | null;
  site_visit_request: { project: string | null; when_text: string | null } | null;
};

const EXTRACT_PROMPT = `Extract structured lead data from this WhatsApp conversation between Priya (Sarthak Singapore sales bot) and a prospective buyer.

Return JSON with these fields. Use null for missing data — do NOT invent values.

- name: buyer's first name if mentioned
- project: project name they're most interested in (one of the KB projects), or null
- buyer_type: "end_use" if they say staying/living, "investment" if rental/resale focus
- residency: "nri" if they mention abroad/Dubai/GCC, "local" if Indore/Mhow/India, else null
- timeline: when they want possession/purchase ("Dec 2026", "3 months", "ASAP")
- budget: any budget figure mentioned
- lead_score: 0-100 — 80+ if they asked specific project/showed urgency/budget, 60-79 if engaged but vague, <60 if just browsing
- score_label: "HOT" if >=80, "WARM" if 60-79, "COLD" if <60
- brochure_request: if they asked for a brochure/PDF/floor plan → {project: <project name>}, else null
- site_visit_request: if they agreed to a site visit OR a specific time was discussed → {project, when_text}, else null

Reply ONLY with the JSON object, no commentary.`;

export async function extractLeadData(
  systemPromptWithKB: string,
  userMessage: string,
  history: { role: "user" | "assistant"; content: string }[] = []
): Promise<ExtractedLead | null> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPromptWithKB + "\n\n" + EXTRACT_PROMPT },
        ...history,
        { role: "user", content: userMessage },
      ],
      max_tokens: 300,
      temperature: 0.1,
    });
    const txt = response.choices[0].message.content;
    if (!txt) return null;
    const parsed = JSON.parse(txt);
    return {
      name: parsed.name ?? null,
      project: parsed.project ?? null,
      buyer_type: parsed.buyer_type ?? null,
      residency: parsed.residency ?? null,
      timeline: parsed.timeline ?? null,
      budget: parsed.budget ?? null,
      lead_score: typeof parsed.lead_score === "number" ? parsed.lead_score : 50,
      score_label: parsed.score_label ?? "WARM",
      brochure_request: parsed.brochure_request ?? null,
      site_visit_request: parsed.site_visit_request ?? null,
    };
  } catch (err) {
    console.error("extractLeadData failed:", err);
    return null;
  }
}
