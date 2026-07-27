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
  conversed_leads: number;
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

// ── Pickup rate ─────────────────────────────────────────────────────────────
// It CANNOT come from the `calls` table. ElevenLabs stopped delivering
// call_initiation_failure events on 2026-07-04 — the last zero-duration row in
// `calls` is from that day — so every row since is an answered call and a
// calls-derived rate reads 100%. The dialer knows better: `call_queue.attempts`
// counts every dial it placed, and a row only reaches status 'completed' when
// someone actually picked up. Everything else it retries with
// last_error "no-answer — callback n/m".

export interface DialRow {
  status: string;
  attempts: number | null;
  lead_phone: string | null;
  project: string | null;
}

export interface DialStats {
  dial_attempts: number;
  answered_dials: number;
  answer_rate: number | null;
  dials_today: number;
  answered_today: number;
  // Distinct PEOPLE, not queue rows. The campaign targets Zoho leads tagged
  // Lead_Status = "Not Answer", and those leads are exactly what the sync
  // enqueues — so the queue, deduped by phone, IS the no-answer population.
  // Counting rows instead would inflate it: a sync bug re-queued the same lead
  // up to 20 times, and rows also multiply on retry campaigns.
  targeted_leads: number;
  waiting_leads: number;
  reached_leads: number;
  by_project: { project: string; leads: number; waiting: number; reached: number }[];
}

export function summariseDials(
  rows: DialRow[],
  dialsToday: number,
  answeredToday: number,
): DialStats {
  let attempts = 0;
  let answered = 0;
  const all = new Set<string>();
  const waiting = new Set<string>();
  const reached = new Set<string>();
  const projects = new Map<string, { leads: Set<string>; waiting: Set<string>; reached: Set<string> }>();

  for (const r of rows) {
    attempts += r.attempts ?? 0;
    // One connect per row at most: the dialer stops retrying once it completes.
    if (r.status === "completed") answered++;

    if (!r.lead_phone) continue;
    const key = phoneKey(r.lead_phone);
    const project = r.project ?? "Unassigned";
    const p = projects.get(project) ?? { leads: new Set(), waiting: new Set(), reached: new Set() };
    projects.set(project, p);

    all.add(key);
    p.leads.add(key);
    if (r.status === "queued" || r.status === "dialing") { waiting.add(key); p.waiting.add(key); }
    if (r.status === "completed") { reached.add(key); p.reached.add(key); }
  }

  return {
    dial_attempts: attempts,
    answered_dials: answered,
    answer_rate: attempts > 0 ? answered / attempts : null,
    dials_today: dialsToday,
    answered_today: answeredToday,
    targeted_leads: all.size,
    // A lead that was reached is no longer waiting, even if a stale duplicate
    // row still sits in the queue for it.
    waiting_leads: [...waiting].filter((k) => !reached.has(k)).length,
    reached_leads: reached.size,
    by_project: [...projects.entries()]
      .map(([project, p]) => ({
        project,
        leads: p.leads.size,
        waiting: [...p.waiting].filter((k) => !p.reached.has(k)).length,
        reached: p.reached.size,
      }))
      .sort((a, b) => b.leads - a.leads),
  };
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
    conversed_leads: reached.size,
    avg_talk_seconds: answered > 0 ? Math.round(talkSecs / answered) : null,
    total_talk_seconds: talkSecs,
    today_calls: todayTotal,
    today_answered: todayAnswered,
    today_talk_seconds: todayTalkSecs,
  };
}
