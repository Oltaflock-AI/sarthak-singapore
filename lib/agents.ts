// Sarthak's property agents on ElevenLabs — one agent per property, all clones
// of Sarthak Miracle except the prompt and the transfer number. Safe to import
// from client components (no secrets).
//
// Pinned in code, NOT env-driven, on purpose: after the 2026-07 account
// migration a stale Vercel env overrode the fallback and failed every call.
// Keep this list in lockstep with SARTHAK_AGENTS in
// supabase/functions/elevenlabs-webhook/index.ts — the webhook drops calls
// from agent ids it doesn't know.
export interface PropertyAgent {
  agentId: string;
  /** Canonical project label — shown on the dashboard, stored on calls/leads. */
  property: string;
}

export const AGENTS: PropertyAgent[] = [
  { agentId: "agent_6801kwrchx5yfnha0jechj2t67pm", property: "Singapore Miracle" },
  { agentId: "agent_7201kxbkvpsrejxsvjpk0nt94yg6", property: "Singapore One Street" },
  { agentId: "agent_7701kxbkvr04ef19snxed4hzk93e", property: "The Grand Virasat" },
];

// Miracle — the original campaign. Everything that predates multi-property
// (bulk batches, Zoho sync, queue processing) still dials this agent.
export const DEFAULT_AGENT = AGENTS[0];

export function agentById(id: string | null | undefined): PropertyAgent | null {
  if (!id) return null;
  return AGENTS.find((a) => a.agentId === id) ?? null;
}
