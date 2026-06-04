// Dashboard visibility cutoff.
//
// Rows created/updated BEFORE this timestamp stay in the database but are hidden
// from the dashboard — used to bury legacy Ringg/DialNexa test data while we
// validate the new ElevenLabs + VoBiz webhooks, so only fresh calls show.
//
// Override per-environment with NEXT_PUBLIC_DASHBOARD_SINCE (ISO 8601), e.g.
//   NEXT_PUBLIC_DASHBOARD_SINCE=2026-06-04T00:00:00+05:30
// Set it to "all" (or empty string) to disable the cutoff and show everything.
const raw = process.env.NEXT_PUBLIC_DASHBOARD_SINCE ?? "2026-06-04T00:00:00+05:30";

export const DASHBOARD_SINCE = raw === "all" ? "" : raw;
