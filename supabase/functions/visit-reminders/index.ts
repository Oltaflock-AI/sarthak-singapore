// visit-reminders — WhatsApp reminder engine for booked site visits.
// Invoked every 15 minutes by pg_cron (net.http_post) and manually for tests.
//
// One pass over upcoming site_visits (status pending/confirmed) does two jobs:
//
//   1. Booking-send retry: a visit whose booking WhatsApps never succeeded
//      (booking_sales_sent_at / booking_client_sent_at NULL — e.g. booked
//      while the Interakt wallet was empty) gets the production booking pair,
//      as long as the visit is still in the future and < 7 days old.
//
//   2. Reminders, three tiers before scheduled_for:
//        • 24h  → sales + client   (skipped if the visit was booked <2h ago —
//                                    they just received the confirmation)
//        • 3h   → sales + client
//        • 30m  → sales only        (a third client message reads as spam)
//
// Each tier stamps its *_sent_at column when at least one send succeeds, so a
// 15-min cron never double-sends. Reminder templates default to the approved
// booking templates (the copy re-reads acceptably as a reminder); switch to
// dedicated copy later via WHATSAPP_SITEVISIT_REMINDER_*_TEMPLATE without a
// redeploy. `?dry=1` reports what would be sent without sending.
//
// Shares its Interakt + owner-routing logic with elevenlabs-webhook (kept in
// sync by hand — edge functions can't import across function dirs).

import { createClient } from "npm:@supabase/supabase-js@2";

interface SendResult {
  ok: boolean;
  to: string;
  template: string;
  status?: number;
  detail?: string;
}

function dash(v: unknown): string {
  const s = String(v ?? "").trim();
  return s || "—";
}

function dispPhone(raw: string): string {
  const d = (raw || "").replace(/\D/g, "");
  return d ? "+91" + d.slice(-10) : "—";
}

// "Sun, 12 Jul 2026, 4:30 PM IST" — same rendering the booking messages use.
function formatWhenIST(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + 330 * 60_000);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let h = d.getUTCHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return `${days[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${h}:${mm} ${ampm} IST`;
}

async function sendInteraktMessage(
  to: string,
  templateName: string,
  bodyValues: string[],
  tag = "whatsapp",
): Promise<SendResult> {
  const key = Deno.env.get("INTERAKT_API_KEY");
  const num = (to || "").replace(/\D/g, "").slice(-10);
  if (!key || num.length !== 10) {
    console.warn(`[${tag}] missing INTERAKT_API_KEY or valid recipient — skipping WhatsApp`);
    return { ok: false, to: num, template: templateName, detail: "missing key or invalid recipient" };
  }
  const payload = {
    countryCode: "+91",
    phoneNumber: num,
    type: "Template",
    template: { name: templateName, languageCode: "en", bodyValues },
  };
  try {
    const res = await fetch("https://api.interakt.ai/v1/public/message/", {
      method: "POST",
      headers: { Authorization: `Basic ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j?.result === false) {
      console.error(`[${tag}] Interakt send failed`, res.status, JSON.stringify(j).slice(0, 300));
      return { ok: false, to: num, template: templateName, status: res.status, detail: JSON.stringify(j).slice(0, 300) };
    }
    console.log(`[${tag}] Interakt sent to`, num, JSON.stringify(j).slice(0, 200));
    return { ok: true, to: num, template: templateName, status: res.status, detail: JSON.stringify(j).slice(0, 200) };
  } catch (e) {
    console.error(`[${tag}] Interakt error`, String(e));
    return { ok: false, to: num, template: templateName, detail: String(e) };
  }
}

function siteVisitOwner(project: string): { to: string; name: string; contact: string } {
  const miracleTo =
    Deno.env.get("WHATSAPP_SITEVISIT_SALES") ??
    Deno.env.get("WHATSAPP_HANDOFF_MIRACLE") ??
    Deno.env.get("WHATSAPP_HANDOFF_DEFAULT") ??
    "";
  const miracle = {
    to: miracleTo,
    name: Deno.env.get("SITEVISIT_SALES_NAME") ?? "Sarthak Singapore team",
    contact: Deno.env.get("SITEVISIT_SALES_CONTACT") ?? miracleTo,
  };
  const byProject: Record<string, { to: string; name: string; contact?: string }> = {
    "Singapore Miracle": miracle,
    "Singapore One Street": {
      to:
        Deno.env.get("WHATSAPP_SITEVISIT_SALES_ONE_STREET") ??
        Deno.env.get("WHATSAPP_HANDOFF_ONE_STREET") ??
        "917471144333",
      name: Deno.env.get("SITEVISIT_SALES_NAME_ONE_STREET") ?? "Priyanka",
      contact: Deno.env.get("SITEVISIT_SALES_CONTACT_ONE_STREET"),
    },
    "The Grand Virasat": {
      to:
        Deno.env.get("WHATSAPP_SITEVISIT_SALES_VIRASAT") ??
        Deno.env.get("WHATSAPP_HANDOFF_VIRASAT") ??
        "919644325000",
      name: Deno.env.get("SITEVISIT_SALES_NAME_VIRASAT") ?? "Sunita",
      contact: Deno.env.get("SITEVISIT_SALES_CONTACT_VIRASAT"),
    },
  };
  const o = byProject[project];
  if (!o) return miracle;
  return { to: o.to, name: o.name, contact: o.contact || o.to };
}

// Template names — booking copy by default, dedicated reminder copy via env.
const salesTemplate = (kind: "booked" | "reminder") =>
  kind === "reminder"
    ? Deno.env.get("WHATSAPP_SITEVISIT_REMINDER_SALES_TEMPLATE") ??
      Deno.env.get("WHATSAPP_SITEVISIT_SALES_TEMPLATE") ?? "ai_ssg_site_visit_booked"
    : Deno.env.get("WHATSAPP_SITEVISIT_SALES_TEMPLATE") ?? "ai_ssg_site_visit_booked";
const clientTemplate = (kind: "booked" | "reminder") =>
  kind === "reminder"
    ? Deno.env.get("WHATSAPP_SITEVISIT_REMINDER_CLIENT_TEMPLATE") ??
      Deno.env.get("WHATSAPP_SITEVISIT_CLIENT_TEMPLATE") ?? "aiclient_ssg_sitevisit_booked"
    : Deno.env.get("WHATSAPP_SITEVISIT_CLIENT_TEMPLATE") ?? "aiclient_ssg_sitevisit_booked";

interface VisitRow {
  id: string;
  lead_phone: string;
  lead_name: string | null;
  project: string | null;
  scheduled_for: string;
  status: string;
  created_at: string;
  booking_sales_sent_at: string | null;
  booking_client_sent_at: string | null;
  reminder_24h_sent_at: string | null;
  reminder_3h_sent_at: string | null;
  reminder_30m_sent_at: string | null;
}

const HOUR = 3_600_000;

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("POST or GET", { status: 405 });
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const nowMs = Date.now();
  const { data: visits, error } = await supabase
    .from("site_visits")
    .select("id, lead_phone, lead_name, project, scheduled_for, status, created_at, booking_sales_sent_at, booking_client_sent_at, reminder_24h_sent_at, reminder_3h_sent_at, reminder_30m_sent_at")
    .in("status", ["pending", "confirmed"])
    .not("scheduled_for", "is", null)
    .gt("scheduled_for", new Date(nowMs).toISOString())
    .order("scheduled_for", { ascending: true });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const actions: Record<string, unknown>[] = [];

  for (const v of (visits ?? []) as VisitRow[]) {
    const project = v.project ?? "Singapore Miracle";
    const owner = siteVisitOwner(project);
    const when = formatWhenIST(v.scheduled_for);
    const name = dash(v.lead_name);
    const timeLeft = Date.parse(v.scheduled_for) - nowMs;
    const bookedAgo = nowMs - Date.parse(v.created_at);
    const stamp: Record<string, string> = {};

    // ── 1) Booking-send retry (visits < 7 days old whose pair never went out) ──
    if ((!v.booking_sales_sent_at || !v.booking_client_sent_at) && bookedAgo < 7 * 24 * HOUR) {
      if (!v.booking_sales_sent_at) {
        const tpl = salesTemplate("booked");
        actions.push({ visit: v.id, lead: name, kind: "booking-sales", to: owner.to, template: tpl });
        if (!dry) {
          const r = await sendInteraktMessage(
            owner.to, tpl,
            [name, dispPhone(v.lead_phone), dash(project), when, "Confirmed"],
            "retry-booking-sales",
          );
          actions[actions.length - 1].result = r;
          if (r.ok) stamp.booking_sales_sent_at = new Date().toISOString();
        }
      }
      if (!v.booking_client_sent_at) {
        const tpl = clientTemplate("booked");
        actions.push({ visit: v.id, lead: name, kind: "booking-client", to: v.lead_phone, template: tpl });
        if (!dry) {
          const r = await sendInteraktMessage(
            v.lead_phone, tpl,
            [name, dash(project), when, owner.name, dispPhone(owner.contact)],
            "retry-booking-client",
          );
          actions[actions.length - 1].result = r;
          if (r.ok) stamp.booking_client_sent_at = new Date().toISOString();
        }
      }
    }

    // ── 2) Reminder tiers ──
    // 24h: sales + client. Skip when the booking itself is <2h old.
    if (!v.reminder_24h_sent_at && timeLeft <= 24 * HOUR && timeLeft > 3 * HOUR && bookedAgo > 2 * HOUR) {
      actions.push({ visit: v.id, lead: name, kind: "reminder-24h", to: [owner.to, v.lead_phone] });
      if (!dry) {
        const s = await sendInteraktMessage(
          owner.to, salesTemplate("reminder"),
          [name, dispPhone(v.lead_phone), dash(project), when, "Reminder — tomorrow"],
          "reminder-24h-sales",
        );
        const c = await sendInteraktMessage(
          v.lead_phone, clientTemplate("reminder"),
          [name, dash(project), when, owner.name, dispPhone(owner.contact)],
          "reminder-24h-client",
        );
        actions[actions.length - 1].result = { sales: s, client: c };
        if (s.ok || c.ok) stamp.reminder_24h_sent_at = new Date().toISOString();
      }
    }

    // 3h: sales + client.
    if (!v.reminder_3h_sent_at && timeLeft <= 3 * HOUR && timeLeft > 0.75 * HOUR) {
      actions.push({ visit: v.id, lead: name, kind: "reminder-3h", to: [owner.to, v.lead_phone] });
      if (!dry) {
        const s = await sendInteraktMessage(
          owner.to, salesTemplate("reminder"),
          [name, dispPhone(v.lead_phone), dash(project), when, "Reminder — today"],
          "reminder-3h-sales",
        );
        const c = await sendInteraktMessage(
          v.lead_phone, clientTemplate("reminder"),
          [name, dash(project), when, owner.name, dispPhone(owner.contact)],
          "reminder-3h-client",
        );
        actions[actions.length - 1].result = { sales: s, client: c };
        if (s.ok || c.ok) stamp.reminder_3h_sent_at = new Date().toISOString();
      }
    }

    // 30m: sales only — be ready.
    if (!v.reminder_30m_sent_at && timeLeft <= 0.75 * HOUR && timeLeft > 0) {
      actions.push({ visit: v.id, lead: name, kind: "reminder-30m", to: owner.to });
      if (!dry) {
        const s = await sendInteraktMessage(
          owner.to, salesTemplate("reminder"),
          [name, dispPhone(v.lead_phone), dash(project), when, "Starting soon"],
          "reminder-30m-sales",
        );
        actions[actions.length - 1].result = s;
        if (s.ok) stamp.reminder_30m_sent_at = new Date().toISOString();
      }
    }

    if (!dry && Object.keys(stamp).length) {
      const { error: upErr } = await supabase.from("site_visits").update(stamp).eq("id", v.id);
      if (upErr) console.error("[visit-reminders] stamp failed", v.id, upErr);
    }
  }

  return Response.json({ ok: true, dry, upcoming: visits?.length ?? 0, actions });
});
