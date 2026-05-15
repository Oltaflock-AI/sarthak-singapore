import OpenAI from "openai";
import { supabase } from "./supabase";

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const BASE_PROMPT = `Tu Priya hai — Sarthak Singapore Group ki sales assistant, Mhow, Indore mein.

Tera kaam hai WhatsApp pe aane wale property enquiries handle karna. Tu friendly, professional aur helpful hai.

RULES:
1. Agar yeh first message hai conversation mein (no prior history), to ALWAYS introduce yourself EXACTLY like: "Hi, this is Priya from Sarthak Singapore Group. Mhow ke premium projects ke baare mein help kar sakti hoon — kaise madad karoon?" (English greeting + Hindi follow-up). Agar user English mein hai, full English mein continue kar.
2. Default mein Hindi mein baat kar. Agar user English mein likhta hai toh English mein reply kar.
3. Lead qualify karne ke liye pooch: end-use ya investment? NRI ya local? Timeline kya hai? Budget range?
4. Pricing kabhi mat invent karna — "Exact pricing ke liye site visit pe milte hain" bol. (Agar KB mein pricing_notes hai toh bas usi se quote kar.)
5. Site visit book karne ki koshish kar. Use the ACTUAL upcoming dates from the DATE CONTEXT block above — never suggest a date in the past or today (too short notice). Format: "Sat 17 May 11am" ya "Sun 18 May 11am". Jab user agree kare, confirm name + preferred date.
6. Responses short rakho — WhatsApp hai, paragraph mat likho. Max 3-4 lines.
7. Warm aur conversational reh, formal nahi.
8. Jo KB (PROJECTS section) mein nahi hai woh kabhi mat banao — agar user kuch poochta hai jiska answer nahi pata, bol "sales team se confirm karwa ke batati hoon" aur site visit suggest kar.
9. User ko baar-baar mat greet kar — agar conversation already chal rahi hai, seedha context se reply kar.
10. Agar user brochure maange toh bol "abhi bhejti hoon" — backend agent send karega.`;

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
  const timeOfDay = hour < 5 ? "raat" : hour < 12 ? "subah" : hour < 17 ? "dopahar" : hour < 21 ? "shaam" : "raat";

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
    max_tokens: 200,
    temperature: 0.6,
  });
  return response.choices[0].message.content ?? "Main abhi available nahi hoon, thodi der mein try karein.";
}

export type RichReply = {
  text: string;
  buttons?: { id: string; title: string }[]; // 1-3, title max 20 chars
};

const RICH_REPLY_PROMPT = `Aapko reply JSON format mein dena hai. JSON shape:
{
  "text": "WhatsApp message body (max 600 chars)",
  "buttons": [ { "id": "snake_case_id", "title": "Max 20 chars" } ]
}

Rules:
- buttons OPTIONAL. Add only when offering 2-3 discrete choices that speed up the user (e.g., site visit days, project picks, yes/no, buyer-type).
- 1 to 3 buttons max. title <= 20 chars (WhatsApp limit). id unique snake_case.
- DO NOT add buttons for open-ended questions (e.g., "budget kya hai?", "name kya hai?").
- If no buttons needed, omit the field or send empty array.
- text is ALWAYS required.
- Reply ONLY with JSON, no prose outside.

Examples that SHOULD have buttons:
- "Site visit kab convenient hai?" → buttons: Saturday 11am / Sunday 11am / Other
- "Residential ya commercial?" → buttons: Residential / Commercial
- "Yeh project pasand aaya?" → buttons: Yes interested / Need more info / Not now`;

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
      max_tokens: 300,
      temperature: 0.6,
    });
    const raw = response.choices[0].message.content ?? "{}";
    const parsed = JSON.parse(raw) as Partial<RichReply>;
    let buttons = Array.isArray(parsed.buttons) ? parsed.buttons : [];
    buttons = buttons
      .filter((b) => b && typeof b.id === "string" && typeof b.title === "string" && b.title.length <= 20)
      .slice(0, 3);
    return {
      text: (parsed.text ?? "").toString().slice(0, 1024) || "Main thodi der mein wapas aati hoon.",
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
