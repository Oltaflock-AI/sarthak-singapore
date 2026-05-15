"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import Script from "next/script";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface CallRow {
  id: string;
  lead_name: string;
  lead_phone: string;
  project: string;
  source: string;
  lead_score: number;
  score_label: string;
  duration_seconds: number;
  outcome: string;
  transcript: { speaker: string; time: string; text: string; side: string }[];
  created_at: string;
}

interface WaRow {
  id: string;
  from_number: string;
  name: string;
  text_in: string;
  created_at: string;
}

function timeAgo(ts: string) {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function fmtDuration(sec: number) {
  if (!sec) return "0s";
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

// ── Compute KPIs and chart data from live rows ───────────────────────────────
function computeStats(calls: CallRow[], waMessages: WaRow[]) {
  const totalLeads = calls.length + waMessages.length;
  const qualified = calls.filter(
    (c) => c.score_label === "HOT" || c.score_label === "WARM"
  ).length;
  const siteVisits = calls.filter((c) =>
    (c.outcome ?? "").toLowerCase().includes("site visit")
  ).length;

  // Project breakdown — group calls by project name
  const projectCounts = new Map<string, number>();
  for (const c of calls) {
    const p = (c.project ?? "Unspecified").split("·")[0].trim();
    projectCounts.set(p, (projectCounts.get(p) ?? 0) + 1);
  }
  const projectData = Array.from(projectCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  // Source breakdown — group calls by source channel
  const sourceCounts = new Map<string, number>();
  for (const c of calls) {
    const src = c.source ?? "Direct";
    sourceCounts.set(src, (sourceCounts.get(src) ?? 0) + 1);
  }
  const sourceData = Array.from(sourceCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return { totalLeads, qualified, siteVisits, projectData, sourceData };
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [waMessages, setWaMessages] = useState<WaRow[]>([]);
  const [expandedCall, setExpandedCall] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date>(new Date());
  const chartInstances = useRef<{ project: unknown; source: unknown }>({ project: null, source: null });
  const scriptLoaded = useRef(false);

  const fetchLive = async () => {
    const [{ data: liveCalls }, { data: liveWa }] = await Promise.all([
      supabase.from("calls").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("wa_messages").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    setCalls((liveCalls as CallRow[]) ?? []);
    setWaMessages((liveWa as WaRow[]) ?? []);
    setLastSync(new Date());
  };

  useEffect(() => {
    fetchLive();
    const interval = setInterval(fetchLive, 10000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => computeStats(calls, waMessages), [calls, waMessages]);

  // ── Charts: render when script loads AND whenever data changes ─────────────
  const renderCharts = () => {
    // @ts-expect-error Chart.js CDN global
    if (typeof window === "undefined" || typeof window.Chart === "undefined") return;
    const projectCtx = (document.getElementById("projectChart") as HTMLCanvasElement)?.getContext("2d");
    const sourceCtx = (document.getElementById("sourceChart") as HTMLCanvasElement)?.getContext("2d");
    if (!projectCtx || !sourceCtx) return;

    // Destroy any prior chart instance before re-rendering
    // @ts-expect-error Chart.js instance
    chartInstances.current.project?.destroy?.();
    // @ts-expect-error Chart.js instance
    chartInstances.current.source?.destroy?.();

    const projectColors = ["#c9a85a","#b8975a","#a78657","#8a7440","#6e5d33","#544626"];
    const sourceColors = ["#c9a85a","#8a7440","#6e5d33","#544626","#3a2f1a"];

    const projectLabels = stats.projectData.length
      ? stats.projectData.map(([k]) => k)
      : ["No calls yet"];
    const projectValues = stats.projectData.length
      ? stats.projectData.map(([, v]) => v)
      : [0];

    const sourceLabels = stats.sourceData.length
      ? stats.sourceData.map(([k, v]) => `${k} · ${v}`)
      : ["Awaiting first call"];
    const sourceValues = stats.sourceData.length
      ? stats.sourceData.map(([, v]) => v)
      : [1];

    // @ts-expect-error Chart.js CDN global
    chartInstances.current.project = new window.Chart(projectCtx, {
      type: "bar",
      data: {
        labels: projectLabels,
        datasets: [{ data: projectValues, backgroundColor: projectColors, borderRadius: 4, barThickness: 22 }],
      },
      options: {
        indexAxis: "y",
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: "#2b2820" }, ticks: { color: "#a39a85", font: { size: 11 }, precision: 0 } },
          y: { grid: { display: false }, ticks: { color: "#f5f2ea", font: { size: 12, weight: 500 } } },
        },
        maintainAspectRatio: false,
      },
    });

    // @ts-expect-error Chart.js CDN global
    chartInstances.current.source = new window.Chart(sourceCtx, {
      type: "doughnut",
      data: { labels: sourceLabels, datasets: [{ data: sourceValues, backgroundColor: sourceColors, borderWidth: 0 }] },
      options: {
        cutout: "65%",
        plugins: { legend: { position: "right", labels: { color: "#f5f2ea", font: { size: 12 }, padding: 12, boxWidth: 12 } } },
        maintainAspectRatio: false,
      },
    });
  };

  useEffect(() => {
    if (scriptLoaded.current) renderCharts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats]);

  return (
    <>
      <Script
        src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"
        onLoad={() => { scriptLoaded.current = true; renderCharts(); }}
      />
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        :root{--bg:#0f0e0c;--bg-2:#18160f;--panel:#1c1a14;--panel-2:#221f17;--line:#2b2820;--gold:#c9a85a;--gold-2:#d4b56b;--gold-dim:#8a7440;--text:#f5f2ea;--muted:#a39a85;--green:#6db77a;--orange:#e09f4e}
        html,body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;font-size:14px;min-height:100vh}
        .app{max-width:1440px;margin:0 auto;padding:24px 32px}
        .topbar{display:flex;align-items:center;justify-content:space-between;padding-bottom:18px;border-bottom:1px solid var(--line);margin-bottom:24px}
        .brand{display:flex;align-items:center;gap:14px}
        .brand-mark{width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,var(--gold) 0%,var(--gold-dim) 100%);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;color:#1a1611}
        .brand-text{display:flex;flex-direction:column}
        .brand-text .name{font-weight:600;font-size:15px;letter-spacing:.3px}
        .brand-text .sub{font-size:11px;color:var(--muted);letter-spacing:.5px;text-transform:uppercase}
        .topbar-right{display:flex;align-items:center;gap:16px;font-size:12px;color:var(--muted)}
        .live-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);margin-right:6px;animation:pulse 2s ease-in-out infinite;vertical-align:1px}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        .tabs{display:flex;gap:4px;margin-bottom:24px;border-bottom:1px solid var(--line)}
        .tab{padding:10px 18px;cursor:pointer;font-size:13px;font-weight:500;color:var(--muted);border-bottom:2px solid transparent;transition:all .15s}
        .tab:hover{color:var(--text)}
        .tab.active{color:var(--gold);border-bottom-color:var(--gold)}
        .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px}
        .kpi{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px 20px}
        .kpi-label{font-size:11px;color:var(--muted);letter-spacing:.7px;text-transform:uppercase;margin-bottom:8px}
        .kpi-value{font-size:32px;font-weight:600;line-height:1}
        .kpi-sub{font-size:11px;margin-top:8px;color:var(--muted)}
        .chart-row{display:grid;grid-template-columns:1.4fr 1fr;gap:16px;margin-bottom:24px}
        .panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px 20px}
        .panel-title{font-size:11px;color:var(--muted);letter-spacing:.7px;text-transform:uppercase;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between}
        .panel-title .sub{color:var(--gold);font-weight:500}
        .chart-wrap{height:240px;position:relative}
        .activity-row{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}
        .empty{text-align:center;padding:48px 20px;color:var(--muted);font-size:13px}
        .empty-hint{margin-top:8px;font-size:11px;color:var(--gold-dim);letter-spacing:.3px}
        .call-list{display:flex;flex-direction:column;gap:10px;max-height:560px;overflow-y:auto}
        .call-item{background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:14px;cursor:pointer;transition:all .15s}
        .call-item:hover{border-color:var(--gold-dim)}
        .call-row1{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
        .call-name{font-weight:600;font-size:14px}
        .call-meta{font-size:11px;color:var(--muted)}
        .call-row2{display:flex;gap:12px;align-items:center;font-size:12px;color:var(--muted);flex-wrap:wrap}
        .score{padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
        .score.hot{background:rgba(109,183,122,.15);color:var(--green)}
        .score.warm{background:rgba(224,159,78,.15);color:var(--orange)}
        .score.cold{background:rgba(163,154,133,.15);color:var(--muted)}
        .badge{font-size:10px;padding:2px 7px;border-radius:4px;background:rgba(201,168,90,.12);color:var(--gold);letter-spacing:.4px;text-transform:uppercase}
        .transcript{margin-top:12px;padding:12px;background:var(--bg-2);border-radius:6px;border:1px solid var(--line)}
        .turn{margin-bottom:10px;font-size:12.5px;line-height:1.55}
        .turn .speaker{font-weight:600;color:var(--gold);font-size:11px;text-transform:uppercase;letter-spacing:.5px}
        .turn.user .speaker{color:var(--text)}
        .turn-meta{font-size:10px;color:var(--muted);margin-left:8px}
        .wa-list{display:flex;flex-direction:column;gap:0;max-height:560px;overflow-y:auto}
        .wa-item{padding:12px 4px;border-bottom:1px solid var(--line);display:grid;grid-template-columns:36px 1fr auto;gap:12px;align-items:center}
        .wa-item:last-child{border-bottom:none}
        .wa-avatar{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--gold-dim),#4a3f24);display:flex;align-items:center;justify-content:center;color:#1a1611;font-weight:600;font-size:13px}
        .wa-body{min-width:0}
        .wa-name{font-weight:600;font-size:13px;margin-bottom:2px}
        .wa-preview{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .wa-time{font-size:10px;color:var(--muted);white-space:nowrap}
        .footer{text-align:center;padding:24px 0 8px;color:var(--muted);font-size:11px;letter-spacing:.7px;text-transform:uppercase;border-top:1px solid var(--line);margin-top:16px}
        .footer span{color:var(--gold)}
        @media(max-width:1100px){.kpi-grid{grid-template-columns:repeat(2,1fr)}.chart-row,.activity-row{grid-template-columns:1fr}}
      `}</style>

      <div className="app">
        <div className="topbar">
          <div className="brand">
            <div className="brand-mark">S</div>
            <div className="brand-text">
              <span className="name">Sarthak Singapore — AI Sales Engine</span>
              <span className="sub">Powered by Oltaflock</span>
            </div>
          </div>
          <div className="topbar-right">
            <span><span className="live-dot" />Live · synced {timeAgo(lastSync.toISOString())} ago</span>
            <span>Khush · admin@oltaflock.ai</span>
          </div>
        </div>

        <div className="tabs">
          {(["overview","voice","whatsapp","leads","projects"] as const).map((tab) => (
            <div key={tab} className={`tab${activeTab === tab ? " active" : ""}`} onClick={() => setActiveTab(tab)}>
              {tab === "overview" && "Overview"}
              {tab === "voice" && `Voice Calls · ${calls.length}`}
              {tab === "whatsapp" && `WhatsApp · ${waMessages.length}`}
              {tab === "leads" && `All Leads · ${stats.totalLeads}`}
              {tab === "projects" && "Projects"}
            </div>
          ))}
        </div>

        <div className="kpi-grid">
          <div className="kpi">
            <div className="kpi-label">Total Leads</div>
            <div className="kpi-value">{stats.totalLeads}</div>
            <div className="kpi-sub">{calls.length} voice · {waMessages.length} WhatsApp</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Qualified (Hot + Warm)</div>
            <div className="kpi-value">{stats.qualified}</div>
            <div className="kpi-sub">{stats.totalLeads > 0 ? Math.round((stats.qualified / Math.max(calls.length, 1)) * 100) : 0}% of voice calls</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Site Visits Booked</div>
            <div className="kpi-value">{stats.siteVisits}</div>
            <div className="kpi-sub">From call outcomes</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Avg Call Duration</div>
            <div className="kpi-value">
              {calls.length > 0
                ? fmtDuration(Math.round(calls.reduce((a, c) => a + (c.duration_seconds ?? 0), 0) / calls.length))
                : "—"}
            </div>
            <div className="kpi-sub">Across {calls.length} {calls.length === 1 ? "call" : "calls"}</div>
          </div>
        </div>

        <div className="chart-row">
          <div className="panel">
            <div className="panel-title"><span>Demand by project</span><span className="sub">{calls.length} calls</span></div>
            <div className="chart-wrap"><canvas id="projectChart" /></div>
          </div>
          <div className="panel">
            <div className="panel-title"><span>Source mix</span><span className="sub">{calls.length} calls</span></div>
            <div className="chart-wrap"><canvas id="sourceChart" /></div>
          </div>
        </div>

        <div className="activity-row">
          <div className="panel">
            <div className="panel-title"><span>Recent Voice Calls</span><span className="sub">Click to expand transcript</span></div>
            {calls.length === 0 ? (
              <div className="empty">
                No calls yet
                <div className="empty-hint">Trigger a test call from Ringg.ai to see it here</div>
              </div>
            ) : (
              <div className="call-list">
                {calls.map((c) => (
                  <div key={c.id} className="call-item" onClick={() => setExpandedCall(expandedCall === c.id ? null : c.id)}>
                    <div className="call-row1">
                      <span className="call-name">{c.lead_name || "Unknown caller"}</span>
                      <span className="call-meta">{timeAgo(c.created_at)} · {fmtDuration(c.duration_seconds)}</span>
                    </div>
                    <div className="call-row2">
                      {c.score_label && <span className={`score ${c.score_label.toLowerCase()}`}>{c.score_label} · {c.lead_score}</span>}
                      {c.source && <span className="badge">{c.source}</span>}
                      {c.project && <span>{c.project}</span>}
                    </div>
                    {c.outcome && <div style={{fontSize:11,color:"var(--muted)",marginTop:6}}>→ {c.outcome}</div>}
                    {expandedCall === c.id && c.transcript?.length > 0 && (
                      <div className="transcript">
                        {c.transcript.map((t, i) => (
                          <div key={i} className={`turn ${t.side}`}>
                            <span className="speaker">{t.speaker}</span>
                            <span className="turn-meta">{t.time}</span>
                            <br />{t.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-title"><span>WhatsApp Inbox</span><span className="sub">{waMessages.length} {waMessages.length === 1 ? "conversation" : "conversations"}</span></div>
            {waMessages.length === 0 ? (
              <div className="empty">
                No messages yet
                <div className="empty-hint">Send a WhatsApp to +1 814 404 5578 to test</div>
              </div>
            ) : (
              <div className="wa-list">
                {waMessages.map((w) => (
                  <div key={w.id} className="wa-item">
                    <div className="wa-avatar">{w.name?.[0]?.toUpperCase() ?? "?"}</div>
                    <div className="wa-body">
                      <div className="wa-name">{w.name || w.from_number}</div>
                      <div className="wa-preview">{w.text_in}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div className="wa-time">{timeAgo(w.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="footer">
          Oltaflock × Sarthak Singapore · <span>AI Sales Engine v1.0</span> · Live from Supabase · Auto-refresh every 10s
        </div>
      </div>
    </>
  );
}
