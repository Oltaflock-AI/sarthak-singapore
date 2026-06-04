import OpenAI from "openai";

// Shared OpenAI client. Used by the post-call enrichment route to run the
// deep sentiment / motivation analysis on voice-call transcripts.
//
// Created lazily so importing this module never throws when OPENAI_API_KEY is
// absent (e.g. during Next's build-time page-data collection).
let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

export const openai = new Proxy({} as OpenAI, {
  get(_target, prop) {
    const client = getClient();
    const value = client[prop as keyof OpenAI];
    return typeof value === "function" ? value.bind(client) : value;
  },
});
