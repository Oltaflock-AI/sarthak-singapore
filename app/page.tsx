"use client";

import { useEffect, useMemo, useRef } from "react";
import Script from "next/script";
import Link from "next/link";
import { useLiveData, bucketByScore, groupByProject, groupBySource } from "@/lib/data";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { ScoreBadge } from "@/components/ScoreBadge";
import { EmptyState } from "@/components/EmptyState";
import { timeAgo, fmtDuration, initials } from "@/lib/format";

const ICONS = {
  leads: <svg className="kpi-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="7" r="3" /><path d="M3.5 17a6.5 6.5 0 0 1 13 0" /></svg>,
  qualified: <svg className="kpi-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 10l3.5 3.5L15 6.5" /></svg>,
  visits: <svg className="kpi-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="14" height="13" rx="1.6" /><path d="M3 8.5h14M7 3v3M13 3v3" /></svg>,
  clock: <svg className="kpi-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="10" r="7.5" /><path d="M10 6v4l2.5 2.5" /></svg>,
  voice: <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 3.5h2l1.2 3-1.4 1c.7 1.6 2 2.9 3.6 3.6l1-1.4 3 1.2v2c0 .8-.7 1.5-1.5 1.5-6 0-11-5-11-11 0-.8.7-1.5 1.5-1.5z" /></svg>,
  whatsapp: <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M17 10a7 7 0 1 1-3.4-6L17 3l-1 3.4A7 7 0 0 1 17 10z" /></svg>,
};

export default function Overview() {
  const { calls, waMessages, loading } = useLiveData();
  const chartRefs = useRef<{ project: unknown; source: unknown }>({ project: null, source: null });
  const scriptReady = useRef(false);

  const { hot, warm, cold } = useMemo(() => bucketByScore(calls), [calls]);
  const projectData = useMemo(() =>
    Array.from(groupByProject(calls).entries()).sort((a, b) => b[1] - a[1]).slice(0, 6),
  [calls]);
  const sourceData = useMemo(() =>
    Array.from(groupBySource(calls).entries()).sort((a, b) => b[1] - a[1]).slice(0, 5),
  [calls]);

  // Combined live feed — interleave calls + WA chronologically
  const feed = useMemo(() => {
    type FeedItem = { id: string; kind: "call" | "wa"; when: string; name: string; preview: string; meta?: string; score?: number };
    const items: FeedItem[] = [
      ...calls.map<FeedItem>((c) => ({
        id: `c-${c.id}`,
        kind: "call",
        when: c.created_at,
        name: c.lead_name ?? "Unknown caller",
        preview: c.outcome ?? c.project ?? "Voice call",
        meta: c.source ?? undefined,
        score: c.lead_score ?? undefined,
      })),
      ...waMessages.map<FeedItem>((w) => ({
        id: `w-${w.id}`,
        kind: "wa",
        when: w.created_at,
        name: w.name ?? w.from_number ?? "Unknown",
        preview: w.text_in ?? "",
      })),
    ];
    return items.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime()).slice(0, 12);
  }, [calls, waMessages]);

  const avgDuration = calls.length > 0
    ? Math.round(calls.reduce((a, c) => a + (c.duration_seconds ?? 0), 0) / calls.length)
    : 0;
  const totalLeads = calls.length + waMessages.length;
  const qualifiedRate = calls.length > 0 ? Math.round((hot.length / calls.length) * 100) : 0;

  const renderCharts = () => {
    // @ts-expect-error Chart.js CDN global
    if (typeof window === "undefined" || typeof window.Chart === "undefined") return;
    const projectCtx = (document.getElementById("projectChart") as HTMLCanvasElement)?.getContext("2d");
    const sourceCtx = (document.getElementById("sourceChart") as HTMLCanvasElement)?.getContext("2d");
    if (!projectCtx || !sourceCtx) return;
    // @ts-expect-error chart instance
    chartRefs.current.project?.destroy?.();
    // @ts-expect-error chart instance
    chartRefs.current.source?.destroy?.();

    const pLabels = projectData.length ? projectData.map(([k]) => k) : ["No calls yet"];
    const pValues = projectData.length ? projectData.map(([, v]) => v) : [0];
    const sLabels = sourceData.length ? sourceData.map(([k, v]) => `${k} · ${v}`) : ["No sources yet"];
    const sValues = sourceData.length ? sourceData.map(([, v]) => v) : [1];

    // @ts-expect-error CDN global
    chartRefs.current.project = new window.Chart(projectCtx, {
      type: "bar",
      data: { labels: pLabels, datasets: [{ data: pValues, backgroundColor: ["#c9a85a", "#b8975a", "#a78657", "#8a7440", "#6e5d33", "#544626"], borderRadius: 6, barThickness: 20 }] },
      options: {
        indexAxis: "y",
        plugins: { legend: { display: false }, tooltip: { backgroundColor: "#14130f", titleColor: "#f5f2ea", bodyColor: "#c9c3b3", borderColor: "#28251e", borderWidth: 1, padding: 10, cornerRadius: 6, displayColors: false } },
        scales: {
          x: { grid: { color: "#1c1a14" }, ticks: { color: "#7d7665", font: { size: 11 }, precision: 0 }, border: { display: false } },
          y: { grid: { display: false }, ticks: { color: "#c9c3b3", font: { size: 12, weight: 500 } }, border: { display: false } },
        },
        maintainAspectRatio: false,
        animation: { duration: 600, easing: "easeOutQuart" },
      },
    });

    // @ts-expect-error CDN global
    chartRefs.current.source = new window.Chart(sourceCtx, {
      type: "doughnut",
      data: { labels: sLabels, datasets: [{ data: sValues, backgroundColor: ["#c9a85a", "#8a7440", "#6e5d33", "#544626", "#3a2f1a"], borderWidth: 0, hoverOffset: 6 }] },
      options: {
        cutout: "70%",
        plugins: {
          legend: { position: "right", labels: { color: "#c9c3b3", font: { size: 12 }, padding: 14, boxWidth: 10, boxHeight: 10, usePointStyle: true } },
          tooltip: { backgroundColor: "#14130f", titleColor: "#f5f2ea", bodyColor: "#c9c3b3", borderColor: "#28251e", borderWidth: 1, padding: 10, cornerRadius: 6 },
        },
        maintainAspectRatio: false,
        animation: { duration: 600, easing: "easeOutQuart" },
      },
    });
  };

  useEffect(() => {
    if (scriptReady.current) renderCharts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectData, sourceData]);

  return (
    <>
      <Script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js" onLoad={() => { scriptReady.current = true; renderCharts(); }} />

      <PageHeader
        title="Overview"
        subtitle="Real-time pipeline across voice and WhatsApp"
      />

      <div className="kpi-grid">
        <KpiCard label="Total Leads" value={totalLeads} sub={`${calls.length} voice · ${waMessages.length} WhatsApp`} icon={ICONS.leads} />
        <KpiCard label="Hot Leads" value={hot.length} sub={calls.length > 0 ? `${qualifiedRate}% of voice calls` : "Awaiting calls"} icon={ICONS.qualified} />
        <KpiCard label="Site Visits Booked" value={calls.filter((c) => (c.outcome ?? "").toLowerCase().includes("site visit")).length} sub="From call outcomes" icon={ICONS.visits} />
        <KpiCard label="Avg Call Duration" value={avgDuration > 0 ? fmtDuration(avgDuration) : "—"} sub={`${calls.length} ${calls.length === 1 ? "call" : "calls"}`} icon={ICONS.clock} />
      </div>

      {/* Score distribution strip */}
      <div className="panel" style={{ marginBottom: 22 }}>
        <div className="panel-head">
          <div className="panel-title">Lead Score Distribution</div>
          <Link href="/leads" className="panel-sub" style={{ color: "var(--gold-2)" }}>View pipeline →</Link>
        </div>
        <div className="panel-body">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <ScoreRow label="Hot" count={hot.length} total={calls.length} variant="hot" hint="80+ score · Warm-transfer to sales" />
            <ScoreRow label="Warm" count={warm.length} total={calls.length} variant="warm" hint="60–79 · Site visit booked / nurturing" />
            <ScoreRow label="Cold" count={cold.length} total={calls.length} variant="cold" hint="<60 · Added to 14-day nurture" />
          </div>
        </div>
      </div>

      {/* Charts */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14, marginBottom: 22 }}>
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Demand by Project</div>
            <div className="panel-sub num">{calls.length} calls analysed</div>
          </div>
          <div className="panel-body"><div style={{ height: 240 }}><canvas id="projectChart" /></div></div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Lead Source Mix</div>
            <div className="panel-sub num">{calls.length} calls</div>
          </div>
          <div className="panel-body"><div style={{ height: 240 }}><canvas id="sourceChart" /></div></div>
        </div>
      </div>

      {/* Live feed */}
      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">Live Activity Feed</div>
          <div className="panel-sub">Calls and WhatsApp combined</div>
        </div>
        <div className="panel-body flush">
          {loading && feed.length === 0 ? (
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
              {[0,1,2,3].map((i) => <div key={i} className="skeleton" style={{ height: 56 }} />)}
            </div>
          ) : feed.length === 0 ? (
            <EmptyState
              title="No activity yet"
              hint="Trigger a test call from Ringg.ai or send a WhatsApp message — it'll appear here within 10 seconds."
            />
          ) : (
            <div className="row-stripe">
              {feed.map((item) => (
                <div key={item.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 14, alignItems: "center", padding: "14px 20px" }}>
                  <div className="avatar sm">{initials(item.name)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</span>
                      <span style={{ color: "var(--gold-dim)", display: "inline-flex", alignItems: "center" }}>
                        {item.kind === "call" ? ICONS.voice : ICONS.whatsapp}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>
                      {item.preview}
                    </div>
                  </div>
                  {item.score != null && <ScoreBadge score={item.score} />}
                  <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }} className="num">
                    {timeAgo(item.when)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ScoreRow({ label, count, total, variant, hint }: { label: string; count: number; total: number; variant: "hot" | "warm" | "cold"; hint: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const colors = {
    hot: { bg: "var(--hot-soft)", fg: "var(--hot)" },
    warm: { bg: "var(--warm-soft)", fg: "var(--warm)" },
    cold: { bg: "var(--cold-soft)", fg: "var(--cold)" },
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
