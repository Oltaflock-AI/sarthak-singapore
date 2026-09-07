// How far a call actually got. Derived from the transcript on the server (the
// list payload drops the transcript itself), because duration alone lies: a
// call that hits the operator's voicemail greeting and talks to dead air for
// two minutes looks identical to a real two-minute conversation.
export type Reach = "conversation" | "voicemail" | "no_answer" | "agent_failure";

// Operator/machine greetings that land on the `user` side of the transcript —
// English and Hindi, plus the usual "switched off / out of coverage" carrier
// announcements. The agent keeps talking over these, which is what inflates
// the duration.
const MACHINE = /not available|unavailable at the moment|record your message|leave a message|after the (tone|beep)|voice ?mail|answering machine|call is (being )?forwarded|switched off|out of (the )?coverage|do not disturb|उपलब्ध नहीं|संदेश रिकॉर्ड|बीप के बाद|स्विच ऑफ|कवरेज/i;

// ASR emits "..." (and bare punctuation) for silence. On a voicemail the agent
// keeps talking to dead air, so the transcript fills with these — they are not
// a person speaking and must not count as one.
const FILLER = /^[\s.,!?…·\-–—]*$/;

export interface ClassifiableCall {
  duration_seconds?: number | null;
  outcome?: string | null;
  analysis?: Record<string, unknown> | null;
  transcript?: { speaker?: string; side?: string; text?: string }[] | null;
}

export function classifyReach(c: ClassifiableCall): Reach {
  const a = (c.analysis ?? {}) as Record<string, unknown>;
  if (a.call_initiation_failure === true) return "no_answer";

  const turns = Array.isArray(c.transcript) ? c.transcript : [];
  const userTurns = turns
    .filter((t) => /user|caller|lead|customer|human/i.test(String(t.side ?? t.speaker ?? "")))
    .map((t) => String(t.text ?? "").trim())
    .filter(Boolean);
  const humanTurns = userTurns.filter((t) => !MACHINE.test(t) && !FILLER.test(t));
  const machineGreeting = userTurns.some((t) => MACHINE.test(t));

  // A machine greeting means the line was picked up by voicemail regardless of
  // how long the agent then talked at it. Anything the ASR heard afterwards is
  // the recording or dead air, not the lead.
  if (machineGreeting) return "voicemail";

  // Platform-side failures (ElevenLabs quota exhausted, LLM timeout) never
  // reached the lead — they aren't conversations and they aren't the lead's
  // doing either, so they get their own bucket.
  const termination = String(a.termination_reason ?? "");
  const failed =
    a.call_successful === "failure" || String(c.outcome ?? "").toLowerCase() === "failure";
  if (failed && humanTurns.length === 0) return "agent_failure";
  if (/quota|exceeds your (quota|limit)/i.test(termination) && humanTurns.length === 0) {
    return "agent_failure";
  }

  // Nobody spoke at all: ringing, instant hangup, or dead air.
  if (humanTurns.length === 0) return "no_answer";

  return "conversation";
}
