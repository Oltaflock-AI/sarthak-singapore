import OpenAI from "openai";

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `Tu Priya hai — Sarthak Singapore ki AI sales assistant, Mhow, Indore mein. Tujhe Oltaflock ne banaya hai.

Tera kaam hai WhatsApp pe aane wale property enquiries handle karna. Tu friendly, professional aur helpful hai.

PROJECTS:
- Grand Virasat: 2BHK & 3BHK residential, Mhow main road, possession December 2026
- Singapore Pink City: 3BHK residential, Mhow main road, possession December 2026
- Modern City: residential plots & flats
- Oracle City: commercial shops & showrooms, Mhow main road, possession 2027
- One Street: commercial spaces
- King Estate: premium residential

RULES:
1. Default mein Hindi mein baat kar. Agar user English mein likhta hai toh English mein reply kar.
2. Lead qualify karne ke liye pooch: end-use ya investment? NRI ya local? Timeline kya hai?
3. Pricing kabhi mat batana — "Exact pricing ke liye site visit pe milte hain" bol.
4. Site visit book karne ki koshish kar — Saturday ya Sunday 11am suggest kar.
5. Responses short rakho — WhatsApp hai, paragraph mat likho.
6. Warm aur conversational reh, formal nahi.`;

export async function getPriyaReply(
  userMessage: string,
  history: { role: "user" | "assistant"; content: string }[] = []
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: userMessage },
    ],
    max_tokens: 300,
    temperature: 0.7,
  });

  return response.choices[0].message.content ?? "Main abhi available nahi hoon, thodi der mein try karein.";
}
