"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import Link from "next/link";
import { useLiveData } from "@/lib/data";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { ScoreBadge } from "@/components/ScoreBadge";
import { EmptyState } from "@/components/EmptyState";
import { timeAgo, initials } from "@/lib/format";

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

const ICONS = {
  leads: <svg className="kpi-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="7" r="3" /><path d="M3.5 17a6.5 6.5 0 0 1 13 0" /></svg>,
  qualified: <svg className="kpi-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 10l3.5 3.5L15 6.5" /></svg>,
  visits: <svg className="kpi-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="14" height="13" rx="1.6" /><path d="M3 8.5h14M7 3v3M13 3v3" /></svg>,
  conv: <svg className="kpi-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l5-5 3 3 6-7" /><path d="M14 8h3v3" /></svg>,
  voice: <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 3.5h2l1.2 3-1.4 1c.7 1.6 2 2.9 3.6 3.6l1-1.4 3 1.2v2c0 .8-.7 1.5-1.5 1.5-6 0-11-5-11-11 0-.8.7-1.5 1.5-1.5z" /></svg>,
  whatsapp: <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M17 10a7 7 0 1 1-3.4-6L17 3l-1 3.4A7 7 0 0 1 17 10z" /></svg>,
};

export default function Overview() {
  const { calls, waMessages } = useLiveData();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const chartRefs = useRef<{ project: unknown; source: unknown; status: unknown }>({ project: null, source: null, status: null });
  const scriptReady = useRef(false);

  useEffect(() => {
    const fetchAll = async () => {
      const [l, v] = await Promise.all([
        fetch("/api/leads", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/site-visits", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (Array.isArray(l)) setLeads(l);
      if (Array.isArray(v)) setVisits(v);
    };
    fetchAll();
    const id = setInterval(fetchAll, 8000);
    return () => clearInterval(id);
  }, []);

  const metrics = useMemo(() => {
    const total = leads.length;
    let hot = 0, warm = 0, cold = 0, qualified = 0, booked = 0, converted = 0, lost = 0;
    const projectCount = new Map<string, number>();
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
      if (l.project) projectCount.set(l.project, (projectCount.get(l.project) ?? 0) + 1);
      const src = l.source ?? "unknown";
      sourceCount.set(src, (sourceCount.get(src) ?? 0) + 1);
    }
    return { total, hot, warm, cold, qualified, booked, converted, lost, projectCount, sourceCount };
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

  const conversionRate = metrics.total > 0 ? Math.round((metrics.booked + metrics.converted) / metrics.total * 100) : 0;
  const qualificationRate = metrics.total > 0 ? Math.round((metrics.qualified + metrics.booked + metrics.converted) / metrics.total * 100) : 0;
  const avgScore = metrics.total > 0 ? Math.round(leads.reduce((a, l) => a + (l.lead_score ?? 0), 0) / metrics.total) : 0;

  // Combined activity feed: leads + wa messages + visits
  const feed = useMemo(() => {
    type Item = { id: string; kind: "lead" | "wa" | "visit"; when: string; name: string; preview: string; score?: number };
    const items: Item[] = [
      ...waMessages.map<Item>((w) => ({
        id: `w-${w.id}`, kind: "wa", when: w.created_at,
        name: w.name ?? w.from_number ?? "Unknown",
        preview: w.text_in ?? w.text_out?.slice(0, 80) ?? "",
      })),
      ...visits.map<Item>((v) => ({
        id: `v-${v.id}`, kind: "visit", when: v.created_at,
        name: v.lead_name ?? v.lead_phone,
        preview: `Site visit booked · ${v.project ?? "—"}${v.scheduled_for_text ? " · " + v.scheduled_for_text : ""}`,
      })),
    ];
    return items.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime()).slice(0, 14);
  }, [waMessages, visits]);

  const renderCharts = () => {
    // @ts-expect-error CDN global
    if (typeof window === "undefined" || typeof window.Chart === "undefined") return;
    const projectCtx = (document.getElementById("projectChart") as HTMLCanvasElement)?.getContext("2d");
    const sourceCtx = (document.getElementById("sourceChart") as HTMLCanvasElement)?.getContext("2d");
    const statusCtx = (document.getElementById("statusChart") as HTMLCanvasElement)?.getContext("2d");
    if (!projectCtx || !sourceCtx || !statusCtx) return;

    // Cleanup
    // @ts-expect-error instance
    chartRefs.current.project?.destroy?.();
    // @ts-expect-error instance
    chartRefs.current.source?.destroy?.();
    // @ts-expect-error instance
    chartRefs.current.status?.destroy?.();

    const projectEntries = Array.from(metrics.projectCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const sourceEntries = Array.from(metrics.sourceCount.entries()).sort((a, b) => b[1] - a[1]);

    const pLabels = projectEntries.length ? projectEntries.map(([k]) => k) : ["No leads yet"];
    const pValues = projectEntries.length ? projectEntries.map(([, v]) => v) : [0];
    const sLabels = sourceEntries.length ? sourceEntries.map(([k, v]) => `${k} · ${v}`) : ["—"];
    const sValues = sourceEntries.length ? sourceEntries.map(([, v]) => v) : [1];

    // @ts-expect-error CDN
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
        animation: { duration: 600 },
      },
    });

    // @ts-expect-error CDN
    chartRefs.current.source = new window.Chart(sourceCtx, {
      type: "doughnut",
      data: { labels: sLabels, datasets: [{ data: sValues, backgroundColor: ["#c9a85a", "#8a7440", "#6e5d33", "#544626", "#3a2f1a"], borderWidth: 0, hoverOffset: 6 }] },
      options: {
        cutout: "68%",
        plugins: {
          legend: { position: "right", labels: { color: "#c9c3b3", font: { size: 12 }, padding: 14, boxWidth: 10, boxHeight: 10, usePointStyle: true } },
          tooltip: { backgroundColor: "#14130f", titleColor: "#f5f2ea", bodyColor: "#c9c3b3", borderColor: "#28251e", borderWidth: 1, padding: 10, cornerRadius: 6 },
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
        plugins: { legend: { display: false }, tooltip: { backgroundColor: "#14130f", titleColor: "#f5f2ea", bodyColor: "#c9c3b3", borderColor: "#28251e", borderWidth: 1, padding: 10, cornerRadius: 6, displayColors: false } },
        scales: {
          y: { grid: { color: "#1c1a14" }, ticks: { color: "#7d7665", font: { size: 11 }, precision: 0 }, border: { display: false } },
          x: { grid: { display: false }, ticks: { color: "#c9c3b3", font: { size: 12, weight: 500 } }, border: { display: false } },
        },
        maintainAspectRatio: false,
        animation: { duration: 600 },
      },
    });
  };

  useEffect(() => {
    if (scriptReady.current) renderCharts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics]);

  return (
    <>
      <Script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js" onLoad={() => { scriptReady.current = true; renderCharts(); }} />

      <PageHeader title="Overview" subtitle="AI sales engine · live pipeline across all channels" />

      {/* Primary KPIs */}
      <div className="kpi-grid">
        <KpiCard label="Total Leads" value={metrics.total} sub={`+${todayLeads} today · ${calls.length} voice · ${metrics.total - calls.length} WA`} icon={ICONS.leads} />
        <KpiCard label="Qualified" value={metrics.qualified + metrics.booked + metrics.converted} sub={`${qualificationRate}% qualification rate`} icon={ICONS.qualified} />
        <KpiCard label="Site Visits Booked" value={metrics.booked + metrics.converted} sub={`${todayBookings.length} booked today`} icon={ICONS.visits} />
        <KpiCard label="Conversion Rate" value={`${conversionRate}%`} sub={`${metrics.converted} converted · avg score ${avgScore}`} icon={ICONS.conv} />
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
                No upcoming visits — Priya will book them as leads agree.
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
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gap: 14, marginBottom: 22 }}>
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Demand by Project</div>
            <div className="panel-sub num">{metrics.total} leads</div>
          </div>
          <div className="panel-body"><div style={{ height: 240 }}><canvas id="projectChart" /></div></div>
        </div>
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
            <div className="panel-sub num">{conversionRate}% conv</div>
          </div>
          <div className="panel-body"><div style={{ height: 240 }}><canvas id="statusChart" /></div></div>
        </div>
      </div>

      {/* Live activity */}
      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">Live Activity</div>
          <div className="panel-sub">WhatsApp + voice + site-visit bookings · last 14 events</div>
        </div>
        <div className="panel-body flush">
          {feed.length === 0 ? (
            <EmptyState title="No activity yet" hint="Send a WhatsApp message to +1 814-404-5578 to see it land here within seconds." />
          ) : (
            <div className="row-stripe">
              {feed.map((item) => (
                <div key={item.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 14, alignItems: "center", padding: "14px 20px" }}>
                  <div className="avatar sm">{initials(item.name)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</span>
                      <span style={{ color: "var(--gold-dim)", display: "inline-flex" }}>
                        {item.kind === "visit" ? ICONS.visits : item.kind === "wa" ? ICONS.whatsapp : ICONS.voice}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>
                      {item.preview}
                    </div>
                  </div>
                  {item.score != null && <ScoreBadge score={item.score} />}
                  <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }} className="num">{timeAgo(item.when)}</div>
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
