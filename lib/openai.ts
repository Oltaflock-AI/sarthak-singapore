import OpenAI from "openai";

// Shared OpenAI client. Used by the post-call enrichment route to run the
// deep sentiment / motivation analysis on voice-call transcripts.
export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
