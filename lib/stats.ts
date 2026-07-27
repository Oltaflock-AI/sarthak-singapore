// Pure call-stat aggregation, kept out of the route handler so it can be tested
// without a database. Fed by /api/stats/calls, which pages the whole `calls`
// table (the dashboard's own feed is capped at 500 rows, so a browser-side
// pickup rate would only ever describe the most recent calls).

export interface CallStatRow {
  lead_phone: string | null;
  duration_seconds: number | null;
  created_at: string;
}

export interface CallStats {
  total_calls: number;
  answered_calls: number;
  missed_calls: number;
  answer_rate: number | null;
  reached_leads: number;
  avg_talk_seconds: number | null;
  total_talk_seconds: number;
  today_calls: number;
  today_answered: number;
  today_talk_seconds: number;
}

// Answered = the call connected and produced a conversation. ElevenLabs reports
// duration 0 for busy / no-answer / rejected (call_initiation_failure), the same
// rule lib/data.ts#isMissedCall applies client-side.
function isAnswered(r: CallStatRow): boolean {
  return (r.duration_seconds ?? 0) > 0;
}

// Last 10 digits, so "+919…" and "919…" count as one lead.
function phoneKey(phone: string): string {
  return phone.replace(/[^\d]/g, "").slice(-10);
}

export function summariseCalls(rows: CallStatRow[], startOfToday: Date): CallStats {
  let answered = 0;
  let todayTotal = 0;
  let todayAnswered = 0;
  let talkSecs = 0;
  let todayTalkSecs = 0;
  const reached = new Set<string>();

  for (const r of rows) {
    const answeredCall = isAnswered(r);
    const today = new Date(r.created_at) >= startOfToday;
    if (today) todayTotal++;
    if (answeredCall) {
      const secs = r.duration_seconds ?? 0;
      answered++;
      talkSecs += secs;
      if (today) { todayAnswered++; todayTalkSecs += secs; }
      if (r.lead_phone) reached.add(phoneKey(r.lead_phone));
    }
  }

  const total = rows.length;
  return {
    total_calls: total,
    answered_calls: answered,
    missed_calls: total - answered,
    answer_rate: total > 0 ? answered / total : null,
    reached_leads: reached.size,
    avg_talk_seconds: answered > 0 ? Math.round(talkSecs / answered) : null,
    total_talk_seconds: talkSecs,
    today_calls: todayTotal,
    today_answered: todayAnswered,
    today_talk_seconds: todayTalkSecs,
  };
}
