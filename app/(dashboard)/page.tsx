"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import Link from "next/link";
import { useAutoRefresh } from "@/lib/data";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";

type Lead = {
  id: string;
  phone: string;
  name: string | null;
  project: string | null;
  source: string;
  lead_score: number;
  score_label: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type Visit = {
  id: string;
  lead_phone: string;
  lead_name: string | null;
  project: string | null;
  scheduled_for_text: string | null;
  status: string;
  created_at: string;
};

// Live ElevenLabs credit balance (/api/usage/credits). Credits — not minutes —
// are what ElevenLabs actually bills: ConvAI, TTS and LLM all draw one pool.
type CreditUsage = {
  used: number | null;
  total: number | null;
  remaining: number | null;
  tier: string | null;
  resets_at: string | null;
  convai_used: number | null;
  source: string;
  warning: string | null;
};

// Whole-table call stats (/api/stats/calls) — the /api/calls feed is capped at
// 500 rows, so pickup rate has to be counted server-side to be true.
type CallStats = {
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
  queued_calls: number;
  dialing_calls: number;
  running_batches: number;
  paused_batches: number;
  // Pickup rate comes from the dialer's own attempt log, not the `calls` table
  // — ElevenLabs stopped sending no-answer events on 2026-07-04, so `calls`
  // holds answered conversations only and would show a 100% pickup rate.
  dial_attempts: number;
  answered_dials: number;
  dials_today: number;
  answered_today: number;
  // The campaign population: Zoho leads tagged Lead_Status = "Not Answer",
  // counted as distinct people rather than queue rows.
  targeted_leads: number;
  waiting_leads: number;
  reached_leads: number;
  by_project: { project: string; leads: number; waiting: number; reached: number }[];
};

// 1_234_567 → "1.23M", 148_200 → "148k". Keeps the KPI on one line.
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString("en-IN");
}

// 95 → "1m 35s", 3_720 → "1h 2m". Talk time reads better than raw seconds.
function duration(secs: number): string {
  if (secs < 60) return `${Math.round(secs)}s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m ${Math.round(secs % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// Module-scope cache so leaving and returning to /overview doesn't flash empty
// state. We keep the last successful payload and seed useState from it on
// remount; the background refetch still runs to refresh the data.
let cachedLeads: Lead[] = [];
let cachedVisits: Visit[] = [];
let cachedCredits: CreditUsage | null = null;
let cachedStats: CallStats | null = null;

const ICONS = {
  leads: <svg className="kpi-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="7" r="3" /><path d="M3.5 17a6.5 6.5 0 0 1 13 0" /></svg>,
  visits: <svg className="kpi-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="14" height="13" rx="1.6" /><path d="M3 8.5h14M7 3v3M13 3v3" /></svg>,
  talk: <svg className="kpi-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M16.5 9.5a6.5 6.5 0 0 1-9.2 5.9L3.5 16.5l1.1-3.8A6.5 6.5 0 1 1 16.5 9.5Z" /></svg>,
  queue: <svg className="kpi-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h12M4 10h12M4 14h7" /></svg>,
  pickup: <svg className="kpi-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4.2 4h3l1.2 3-1.6 1.2a9 9 0 0 0 4 4L12 10.6l3 1.2v3a1.2 1.2 0 0 1-1.3 1.2A11.5 11.5 0 0 1 3 5.3 1.2 1.2 0 0 1 4.2 4Z" /></svg>,
  credits: <svg className="kpi-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="10" r="6.8" /><path d="M7.8 7h4.4M7.8 9.6h4.4M11 7c0 1.7-1.4 2.6-3.2 2.6L12 14" /></svg>,
};

export default function Overview() {
  const [leads, setLeads] = useState<Lead[]>(() => cachedLeads);
  const [visits, setVisits] = useState<Visit[]>(() => cachedVisits);
  const [credits, setCredits] = useState<CreditUsage | null>(() => cachedCredits);
  const [stats, setStats] = useState<CallStats | null>(() => cachedStats);
  // Tracks the first completed leads/visits fetch, so an genuinely empty
  // pipeline renders "0" instead of shimmering forever.
  const [leadsLoaded, setLeadsLoaded] = useState(() => cachedLeads.length > 0);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [creditsError, setCreditsError] = useState<string | null>(null);
  const chartRefs = useRef<{ source: unknown; status: unknown }>({ source: null, status: null });

  useAutoRefresh(async () => {
    const [l, v] = await Promise.all([
      fetch("/api/leads", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      fetch("/api/site-visits", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    ]);
    if (Array.isArray(l)) { cachedLeads = l; setLeads(l); setLeadsLoaded(true); }
    if (Array.isArray(v)) { cachedVisits = v; setVisits(v); }
  }, 8000);

  // Call stats walk the whole `calls` table, so they get their own slower tick.
  // They only move when a call ends, and useAutoRefresh still refires the moment
  // the tab is focused — so the numbers are current whenever anyone is looking.
  useAutoRefresh(async () => {
    const s = await fetch("/api/stats/calls", { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => null);
    if (s && typeof s.total_calls === "number") {
      cachedStats = s;
      setStats(s);
      setStatsError(null);
    } else {
      // Keep the last good numbers on screen and name the failure, rather than
      // blanking the card to a dash that looks like "zero".
      setStatsError(s?.error ? String(s.error).slice(0, 80) : "call stats unavailable");
    }
  }, 15_000);

  // Credits come straight off ElevenLabs, so poll far slower than the Supabase
  // data — the balance only moves when a call ends, and their API is rate-limited.
  useAutoRefresh(async () => {
    const c = await fetch("/api/usage/credits", { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => null);
    if (c && typeof c.used === "number") {
      cachedCredits = c;
      setCredits(c);
      setCreditsError(null);
    } else {
      setCreditsError(c?.error ? String(c.error).slice(0, 80) : "ElevenLabs unreachable");
    }
  }, 60_000);

  const creditPct =
    credits?.used != null && credits.total ? credits.used / credits.total : null;
  const resetLabel = credits?.resets_at
    ? new Date(credits.resets_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
    : null;

  const metrics = useMemo(() => {
    const total = leads.length;
    let hot = 0, warm = 0, cold = 0, qualified = 0, booked = 0, converted = 0, lost = 0;
    const sourceCount = new Map<string, number>();
    for (const l of leads) {
      const s = (l.score_label ?? "WARM").toUpperCase();
      if (s === "HOT") hot++;
      else if (s === "COLD") cold++;
      else warm++;
      if (l.status === "qualified") qualified++;
      else if (l.status === "booked") booked++;
      else if (l.status === "converted") converted++;
      else if (l.status === "lost") lost++;
      const src = l.source ?? "unknown";
      sourceCount.set(src, (sourceCount.get(src) ?? 0) + 1);
    }
    return { total, hot, warm, cold, qualified, booked, converted, lost, sourceCount };
  }, [leads]);

  const todayBookings = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return visits.filter((v) => new Date(v.created_at) >= today);
  }, [visits]);

  const upcomingVisits = useMemo(() =>
    visits.filter((v) => v.status === "pending" || v.status === "confirmed").slice(0, 6),
  [visits]);

  const answerRate = stats?.answer_rate != null ? Math.round(stats.answer_rate * 100) : null;

  const renderCharts = () => {
    // @ts-expect-error CDN global
    if (typeof window === "undefined" || typeof window.Chart === "undefined") return;
    const sourceCtx = (document.getElementById("sourceChart") as HTMLCanvasElement)?.getContext("2d");
    const statusCtx = (document.getElementById("statusChart") as HTMLCanvasElement)?.getContext("2d");
    if (!sourceCtx || !statusCtx) return;

    // Read live theme tokens so charts adapt to light/dark.
    const css = getComputedStyle(document.documentElement);
    const tok = (n: string) => css.getPropertyValue(n).trim();
    const cPanel = tok("--panel"), cText = tok("--text"), cText2 = tok("--text-2"),
      cMuted = tok("--muted"), cLine = tok("--line");

    // Cleanup
    // @ts-expect-error instance
    chartRefs.current.source?.destroy?.();
    // @ts-expect-error instance
    chartRefs.current.status?.destroy?.();

    const sourceEntries = Array.from(metrics.sourceCount.entries()).sort((a, b) => b[1] - a[1]);

    const sLabels = sourceEntries.length ? sourceEntries.map(([k, v]) => `${k} · ${v}`) : ["No leads yet"];
    const sValues = sourceEntries.length ? sourceEntries.map(([, v]) => v) : [1];

    // @ts-expect-error CDN
    chartRefs.current.source = new window.Chart(sourceCtx, {
      type: "doughnut",
      data: { labels: sLabels, datasets: [{ data: sValues, backgroundColor: ["#c9a85a", "#8a7440", "#6e5d33", "#544626", "#3a2f1a"], borderWidth: 0, hoverOffset: 6 }] },
      options: {
        cutout: "68%",
        plugins: {
          legend: { position: "right", labels: { color: cText2, font: { size: 12 }, padding: 14, boxWidth: 10, boxHeight: 10, usePointStyle: true } },
          tooltip: { backgroundColor: cPanel, titleColor: cText, bodyColor: cText2, borderColor: cLine, borderWidth: 1, padding: 10, cornerRadius: 6 },
        },
        maintainAspectRatio: false,
        animation: { duration: 600 },
      },
    });

    // Funnel: new → qualified → booked → converted
    const funnelLabels = ["New", "Qualified", "Booked", "Converted"];
    const funnelValues = [
      metrics.total,
      metrics.qualified + metrics.booked + metrics.converted,
      metrics.booked + metrics.converted,
      metrics.converted,
    ];
    // @ts-expect-error CDN
    chartRefs.current.status = new window.Chart(statusCtx, {
      type: "bar",
      data: { labels: funnelLabels, datasets: [{ data: funnelValues, backgroundColor: ["#7d7665", "#b8975a", "#c9a85a", "#e8c87a"], borderRadius: 6, barThickness: 38 }] },
      options: {
        plugins: { legend: { display: false }, tooltip: { backgroundColor: cPanel, titleColor: cText, bodyColor: cText2, borderColor: cLine, borderWidth: 1, padding: 10, cornerRadius: 6, displayColors: false } },
        scales: {
          y: { grid: { color: cLine }, ticks: { color: cMuted, font: { size: 11 }, precision: 0 }, border: { display: false } },
          x: { grid: { display: false }, ticks: { color: cText2, font: { size: 12, weight: 500 } }, border: { display: false } },
        },
        maintainAspectRatio: false,
        animation: { duration: 600 },
      },
    });
  };

  useEffect(() => {
    // chart.js may have loaded on a previous mount — check the global directly
    // rather than a per-mount ref so charts re-render on revisit.
    // @ts-expect-error CDN global
    if (typeof window !== "undefined" && window.Chart) {
      renderCharts();
    }
    // Re-render with fresh tokens whenever the theme is toggled.
    const onTheme = () => renderCharts();
    window.addEventListener("themechange", onTheme);
    return () => window.removeEventListener("themechange", onTheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics]);

  return (
    <>
      <Script
        src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"
        strategy="afterInteractive"
        onLoad={() => { renderCharts(); }}
        onReady={() => { renderCharts(); }}
      />

      <PageHeader title="Overview" subtitle="AI sales engine · live pipeline across all channels" />

      {/* Primary KPIs */}
      <div className="kpi-grid">
        <KpiCard
          label="No-Answer Leads"
          value={stats ? stats.targeted_leads.toLocaleString("en-IN") : "0"}
          sub={
            stats
              ? `${stats.reached_leads.toLocaleString("en-IN")} reached · ${stats.waiting_leads.toLocaleString("en-IN")} still to call`
              : ""
          }
          icon={ICONS.leads}
          loading={!stats}
          error={stats ? null : statsError}
          progress={stats && stats.targeted_leads > 0 ? stats.reached_leads / stats.targeted_leads : undefined}
          progressColor="#c9a85a"
        />
        <KpiCard
          label="Site Visits Booked"
          value={metrics.booked + metrics.converted}
          sub={`${todayBookings.length} booked today · ${upcomingVisits.length} upcoming`}
          icon={ICONS.visits}
          loading={!leadsLoaded}
        />
        <KpiCard
          label="Answer Rate"
          value={answerRate == null ? "0%" : `${answerRate}%`}
          sub={
            stats
              ? `${stats.answered_dials.toLocaleString("en-IN")} picked up of ${stats.dial_attempts.toLocaleString("en-IN")} dials · ${stats.answered_today}/${stats.dials_today} today`
              : ""
          }
          icon={ICONS.pickup}
          loading={!stats}
          error={stats ? null : statsError}
          progress={stats?.answer_rate ?? undefined}
          progressColor={
            answerRate == null ? undefined : answerRate >= 40 ? "#22c55e" : answerRate >= 20 ? "#f59e0b" : "#ef4444"
          }
        />
        <KpiCard
          label="Talk Time"
          value={stats ? `${Math.round(stats.total_talk_seconds / 60).toLocaleString("en-IN")} min` : "0 min"}
          sub={
            stats
              ? `${stats.avg_talk_seconds != null ? duration(stats.avg_talk_seconds) : "0s"} average · ${duration(stats.today_talk_seconds)} today`
              : ""
          }
          icon={ICONS.talk}
          loading={!stats}
          error={stats ? null : statsError}
        />
        <KpiCard
          label="Dial Queue"
          // Distinct leads still to call — NOT queue rows, which duplicate.
          value={stats ? stats.waiting_leads.toLocaleString("en-IN") : "0"}
          sub={
            !stats
              ? ""
              : stats.waiting_leads === 0
                ? `Everyone called · ${stats.running_batches} running campaign${stats.running_batches === 1 ? "" : "s"}`
                : stats.running_batches === 0
                  // Never let a stopped dialer look like a working one.
                  ? `PAUSED · ${stats.paused_batches} campaign${stats.paused_batches === 1 ? "" : "s"} on hold · no calls going out`
                  : `${stats.dialing_calls} dialling now · ${stats.running_batches} campaign${stats.running_batches === 1 ? "" : "s"} running`
          }
          progressColor={stats && stats.running_batches === 0 && stats.waiting_leads > 0 ? "#f59e0b" : undefined}
          icon={ICONS.queue}
          loading={!stats}
          error={stats ? null : statsError}
        />
        <KpiCard
          label="ElevenLabs Credits"
          value={
            credits?.used == null
              ? "0"
              : credits.total != null
                ? `${compact(credits.used)} / ${compact(credits.total)}`
                : compact(credits.used)
          }
          unit="credits"
          sub={
            credits?.used == null
              ? ""
              : credits.remaining != null
                ? `${compact(credits.remaining)} left${resetLabel ? ` · resets ${resetLabel}` : ""}`
                : `spent this cycle${credits.convai_used != null ? ` · ${compact(credits.convai_used)} on calls` : ""}`
          }
          icon={ICONS.credits}
          loading={credits?.used == null && creditsError == null}
          error={credits?.used == null ? creditsError : null}
          progress={creditPct ?? undefined}
          progressColor={
            creditPct == null
              ? undefined
              : creditPct >= 0.9
                ? "#ef4444"
                : creditPct >= 0.7
                  ? "#f59e0b"
                  : "#22c55e"
          }
        />
      </div>

      {/* Campaign progress — the Zoho "Not Answer" population, per property */}
      <div className="panel" style={{ marginBottom: 22 }}>
        <div className="panel-head">
          <div className="panel-title">Campaigns · Zoho &ldquo;Not Answer&rdquo; leads</div>
          <div className="panel-sub num">
            {stats ? `${stats.reached_leads.toLocaleString("en-IN")} of ${stats.targeted_leads.toLocaleString("en-IN")} reached` : ""}
          </div>
        </div>
        <div className="panel-body">
          {!stats ? (
            <div className="skeleton" style={{ height: 96 }} />
          ) : stats.by_project.length === 0 ? (
            <div style={{ padding: 8, color: "var(--muted)", fontSize: 12, textAlign: "center" }}>
              No campaign leads synced yet — the Zoho sync queues them as they get tagged.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {stats.by_project.map((p) => {
                const pct = p.leads > 0 ? Math.round((p.reached / p.leads) * 100) : 0;
                return (
                  <div key={p.project}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, gap: 10 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{p.project}</span>
                      <span style={{ fontSize: 11.5, color: "var(--muted)" }} className="num">
                        {p.reached.toLocaleString("en-IN")} reached · {p.waiting.toLocaleString("en-IN")} to call · {p.leads.toLocaleString("en-IN")} leads
                      </span>
                    </div>
                    <div style={{ height: 6, background: "var(--bg-2)", borderRadius: 999, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: "var(--gold)", borderRadius: 999, transition: "width .4s ease" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Score distribution + Today highlights */}
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 14, marginBottom: 22 }}>
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Lead Score Distribution</div>
            <Link href="/leads" className="panel-sub" style={{ color: "var(--gold-2)" }}>View pipeline →</Link>
          </div>
          <div className="panel-body">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <ScoreRow label="Hot" count={metrics.hot} total={metrics.total} variant="hot" hint="Score 80+" />
              <ScoreRow label="Warm" count={metrics.warm} total={metrics.total} variant="warm" hint="Score 60–79" />
              <ScoreRow label="Cold" count={metrics.cold} total={metrics.total} variant="cold" hint="Score under 60" />
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Upcoming Site Visits</div>
            <Link href="/site-visits" className="panel-sub" style={{ color: "var(--gold-2)" }}>All visits →</Link>
          </div>
          <div className="panel-body flush">
            {upcomingVisits.length === 0 ? (
              <div style={{ padding: 24, color: "var(--muted)", fontSize: 12, textAlign: "center" }}>
                No upcoming visits — they appear here once scheduled.
              </div>
            ) : (
              <div className="row-stripe">
                {upcomingVisits.map((v) => (
                  <div key={v.id} style={{ padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.lead_name ?? v.lead_phone}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                        {v.project ?? "Project not set"} · {v.scheduled_for_text ?? "Time not set"}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, color: v.status === "confirmed" ? "var(--gold)" : "var(--warm)", border: `1px solid ${v.status === "confirmed" ? "var(--gold)" : "var(--warm)"}`, padding: "2px 7px", borderRadius: 10, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>{v.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 22 }}>
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Source Mix</div>
            <div className="panel-sub">channels</div>
          </div>
          <div className="panel-body"><div style={{ height: 240 }}><canvas id="sourceChart" /></div></div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Funnel</div>
            <div className="panel-sub num">{metrics.total.toLocaleString("en-IN")} leads</div>
          </div>
          <div className="panel-body"><div style={{ height: 240 }}><canvas id="statusChart" /></div></div>
        </div>
      </div>

    </>
  );
}

function ScoreRow({ label, count, total, variant, hint }: { label: string; count: number; total: number; variant: "hot" | "warm" | "cold"; hint: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const colors = {
    hot: { fg: "var(--hot)" },
    warm: { fg: "var(--warm)" },
    cold: { fg: "var(--cold)" },
  };
  const c = colors[variant];
  return (
    <div style={{ padding: "14px 16px", background: "var(--panel-2)", borderRadius: 8, border: "1px solid var(--line)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span className={`score ${variant}`}>{label.toUpperCase()}</span>
        <span style={{ fontSize: 22, fontWeight: 600, color: c.fg }} className="num">{count}</span>
      </div>
      <div style={{ height: 4, background: "var(--bg-2)", borderRadius: 2, overflow: "hidden", marginBottom: 8 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: c.fg, transition: "width 400ms ease-out" }} />
      </div>
      <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{hint} · {pct}% of leads</div>
    </div>
  );
}
