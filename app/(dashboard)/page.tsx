"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import Link from "next/link";
import { useLiveData, isMissedCall } from "@/lib/data";
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
  reached_leads: number;
  avg_talk_seconds: number | null;
  today_calls: number;
  today_answered: number;
};

// 1_234_567 → "1.23M", 148_200 → "148k". Keeps the KPI on one line.
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString("en-IN");
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
  qualified: <svg className="kpi-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 10l3.5 3.5L15 6.5" /></svg>,
  visits: <svg className="kpi-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="14" height="13" rx="1.6" /><path d="M3 8.5h14M7 3v3M13 3v3" /></svg>,
  conv: <svg className="kpi-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l5-5 3 3 6-7" /><path d="M14 8h3v3" /></svg>,
  pickup: <svg className="kpi-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4.2 4h3l1.2 3-1.6 1.2a9 9 0 0 0 4 4L12 10.6l3 1.2v3a1.2 1.2 0 0 1-1.3 1.2A11.5 11.5 0 0 1 3 5.3 1.2 1.2 0 0 1 4.2 4Z" /></svg>,
  credits: <svg className="kpi-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="10" r="6.8" /><path d="M7.8 7h4.4M7.8 9.6h4.4M11 7c0 1.7-1.4 2.6-3.2 2.6L12 14" /></svg>,
};

export default function Overview() {
  const { calls } = useLiveData();
  const connectedCalls = calls.filter((c) => !isMissedCall(c)).length;
  const [leads, setLeads] = useState<Lead[]>(() => cachedLeads);
  const [visits, setVisits] = useState<Visit[]>(() => cachedVisits);
  const [credits, setCredits] = useState<CreditUsage | null>(() => cachedCredits);
  const [stats, setStats] = useState<CallStats | null>(() => cachedStats);
  const chartRefs = useRef<{ source: unknown; status: unknown }>({ source: null, status: null });

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [l, v, s] = await Promise.all([
          fetch("/api/leads", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/site-visits", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/stats/calls", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        ]);
        if (Array.isArray(l)) { cachedLeads = l; setLeads(l); }
        if (Array.isArray(v)) { cachedVisits = v; setVisits(v); }
        if (s && typeof s.total_calls === "number") { cachedStats = s; setStats(s); }
      } catch (err) {
        console.error("[overview] fetch failed", err);
      }
    };
    fetchAll();
    const id = setInterval(fetchAll, 8000);
    return () => clearInterval(id);
  }, []);

  // Credits come straight off ElevenLabs, so poll far slower than the Supabase
  // data — the balance only moves when a call ends, and their API is rate-limited.
  useEffect(() => {
    const fetchCredits = async () => {
      const c = await fetch("/api/usage/credits", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => null);
      if (c && typeof c.used === "number") { cachedCredits = c; setCredits(c); }
    };
    fetchCredits();
    const id = setInterval(fetchCredits, 60_000);
    return () => clearInterval(id);
  }, []);

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

  const todayLeads = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return leads.filter((l) => new Date(l.created_at) >= today).length;
  }, [leads]);

  const priorityLeads = useMemo(() => {
    const terminal = new Set(["booked", "converted", "lost"]);
    return [...leads]
      .filter((l) => !terminal.has(l.status))
      .sort((a, b) => (b.lead_score ?? 0) - (a.lead_score ?? 0))
      .slice(0, 6);
  }, [leads]);

  // Conversion = site visits booked ÷ leads we actually SPOKE TO.
  //
  // It used to divide by every lead in the table. That table is fed by the Zoho
  // sync, so the denominator included thousands of leads the dialer had not
  // reached yet (and never-answered numbers) — the rate read near-zero, drifted
  // down every time a sync ran, and was really just the "Site Visits Booked"
  // card divided by "Total Leads". Dividing by reached leads answers the
  // question the sales team actually asks: of the people the agent got on the
  // phone, how many booked a visit?
  const visitsBooked = metrics.booked + metrics.converted;
  const reachedLeads = stats?.reached_leads ?? 0;
  // Capped: a visit can be booked for a lead with no answered call (inbound or
  // manual entry), which would otherwise push this past 100%.
  const conversionRate = reachedLeads > 0 ? Math.min(100, Math.round((visitsBooked / reachedLeads) * 100)) : 0;
  const conversionOfAll = metrics.total > 0 ? Math.round((visitsBooked / metrics.total) * 100) : 0;
  const answerRate = stats?.answer_rate != null ? Math.round(stats.answer_rate * 100) : null;
  const qualificationRate = metrics.total > 0 ? Math.round((metrics.qualified + metrics.booked + metrics.converted) / metrics.total * 100) : 0;
  const avgScore = metrics.total > 0 ? Math.round(leads.reduce((a, l) => a + (l.lead_score ?? 0), 0) / metrics.total) : 0;

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

    const sLabels = sourceEntries.length ? sourceEntries.map(([k, v]) => `${k} · ${v}`) : ["—"];
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
        <KpiCard label="Total Leads" value={metrics.total} sub={`+${todayLeads} today · ${connectedCalls} voice calls`} icon={ICONS.leads} />
        <KpiCard label="Qualified" value={metrics.qualified + metrics.booked + metrics.converted} sub={`${qualificationRate}% of all leads · avg score ${avgScore}`} icon={ICONS.qualified} />
        <KpiCard label="Site Visits Booked" value={metrics.booked + metrics.converted} sub={`${todayBookings.length} booked today`} icon={ICONS.visits} />
        <KpiCard
          label="Answer Rate"
          value={answerRate == null ? "—" : `${answerRate}%`}
          sub={
            stats
              ? `${stats.answered_calls.toLocaleString("en-IN")} picked up of ${stats.total_calls.toLocaleString("en-IN")} dialled · ${stats.today_answered}/${stats.today_calls} today`
              : "loading…"
          }
          icon={ICONS.pickup}
          progress={stats?.answer_rate ?? undefined}
          progressColor={
            answerRate == null ? undefined : answerRate >= 40 ? "#22c55e" : answerRate >= 20 ? "#f59e0b" : "#ef4444"
          }
        />
        <KpiCard
          label="Conversion Rate"
          value={stats ? `${conversionRate}%` : "—"}
          sub={
            stats
              ? `${visitsBooked} visits from ${reachedLeads.toLocaleString("en-IN")} leads reached · ${conversionOfAll}% of all leads`
              : "loading…"
          }
          icon={ICONS.conv}
        />
        <KpiCard
          label="ElevenLabs Credits"
          value={
            credits?.used == null
              ? "—"
              : credits.total != null
                ? `${compact(credits.used)} / ${compact(credits.total)}`
                : compact(credits.used)
          }
          unit="credits"
          sub={
            credits?.used == null
              ? "loading…"
              : credits.remaining != null
                ? `${compact(credits.remaining)} left${resetLabel ? ` · resets ${resetLabel}` : ""}`
                : `used this cycle${credits.warning ? " · plan quota unknown" : ""}`
          }
          icon={ICONS.credits}
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

      {/* Priority leads — act now */}
      <div className="panel" style={{ marginBottom: 22 }}>
        <div className="panel-head">
          <div className="panel-title">Priority Leads · follow up</div>
          <Link href="/leads" className="panel-sub" style={{ color: "var(--gold-2)" }}>All leads →</Link>
        </div>
        <div className="panel-body flush">
          {priorityLeads.length === 0 ? (
            <div style={{ padding: 24, color: "var(--muted)", fontSize: 12, textAlign: "center" }}>
              No open leads — new ones appear here ranked by score.
            </div>
          ) : (
            <div className="row-stripe">
              {priorityLeads.map((l) => {
                const s = (l.score_label ?? "WARM").toUpperCase();
                const variant = s === "HOT" ? "hot" : s === "COLD" ? "cold" : "warm";
                const initials = (l.name ?? "?").trim().slice(0, 1).toUpperCase() || "?";
                return (
                  <div key={l.id} style={{ padding: "11px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                    <div className="avatar sm">{initials}</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {l.name ?? l.phone}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, textTransform: "capitalize" }}>
                        {l.status?.replace(/_/g, " ") ?? "new"} · {l.source?.replace(/_/g, " ")}
                      </div>
                    </div>
                    <span className={`score ${variant}`}>{s} · {l.lead_score ?? 0}</span>
                    <a href={`tel:${l.phone}`} style={{
                      flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "6px 12px", borderRadius: 7, textDecoration: "none",
                      background: "var(--gold-soft)", border: "1px solid var(--gold-dim)",
                      color: "var(--gold-2)", fontSize: 11.5, fontWeight: 600,
                    }}>☎ Call</a>
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
              <ScoreRow label="Hot" count={metrics.hot} total={metrics.total} variant="hot" hint="80+ · Warm-transfer to sales" />
              <ScoreRow label="Warm" count={metrics.warm} total={metrics.total} variant="warm" hint="60–79 · Engaged" />
              <ScoreRow label="Cold" count={metrics.cold} total={metrics.total} variant="cold" hint="<60 · 14-day nurture" />
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
                        {v.project ?? "—"} · {v.scheduled_for_text ?? "TBD"}
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
            <div className="panel-sub num">{conversionRate}% of reached leads book a visit</div>
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
      <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{hint}</div>
    </div>
  );
}
