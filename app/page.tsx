"use client";

import { useEffect, useRef, useState } from "react";
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

const MOCK_CALLS: CallRow[] = [
  {
    id: "1", lead_name: "Rohan Sharma", lead_phone: "+91 98765 ••• ••12",
    project: "Grand Virasat · 3BHK", source: "Meta Lead Ad", lead_score: 92, score_label: "HOT",
    duration_seconds: 134, outcome: "Site visit booked · Sat 11am", created_at: new Date(Date.now() - 2 * 60000).toISOString(),
    transcript: [
      { speaker: "Priya (AI)", time: "00:02", text: "Namaste Rohan ji, main Priya bol rahi hoon Sarthak Singapore se. Aapne abhi Grand Virasat ke baare mein enquiry ki thi — kya 2 minute baat kar sakte hain?", side: "ai" },
      { speaker: "Rohan", time: "00:11", text: "Haan ji, batao. Main 3BHK dekh raha tha.", side: "user" },
      { speaker: "Priya (AI)", time: "00:14", text: "Bilkul. Grand Virasat mein hum 2BHK aur 3BHK dono offer karte hain. Possession December 2026 mein hai. Aap end-use ke liye dekh rahe hain ya investment?", side: "ai" },
      { speaker: "Rohan", time: "00:25", text: "End-use. Family ke liye.", side: "user" },
      { speaker: "Priya (AI)", time: "00:38", text: "Toh main aapko Saturday 11am ka site visit book kar deti hoon. Theek hai?", side: "ai" },
      { speaker: "Rohan", time: "00:48", text: "Haan haan, book kar do.", side: "user" },
    ],
  },
  {
    id: "2", lead_name: "Anjali Mehta", lead_phone: "+91 97654 ••• ••87",
    project: "Singapore Pink City · 3BHK", source: "Google Lead Form", lead_score: 78, score_label: "WARM",
    duration_seconds: 102, outcome: "Brochure sent · Callback Saturday", created_at: new Date(Date.now() - 14 * 60000).toISOString(),
    transcript: [
      { speaker: "Priya (AI)", time: "00:02", text: "Namaste Anjali ji, Pink City ke baare mein aapne enquiry ki thi?", side: "ai" },
      { speaker: "Anjali", time: "00:09", text: "Yes, can you tell me about the project in English?", side: "user" },
      { speaker: "Priya (AI)", time: "00:12", text: "Of course. Singapore Pink City is our 3BHK residential project, possession December 2026. RERA-approved. For family or investment?", side: "ai" },
    ],
  },
  {
    id: "3", lead_name: "Vivek Patel (Dubai NRI)", lead_phone: "+971 50 ••• 4321",
    project: "Grand Virasat · 2BHK", source: "Website", lead_score: 88, score_label: "HOT",
    duration_seconds: 182, outcome: "Warm-transferred to sales · NRI", created_at: new Date(Date.now() - 47 * 60000).toISOString(),
    transcript: [
      { speaker: "Priya (AI)", time: "00:02", text: "Namaste Vivek ji, Grand Virasat ke baare mein aapki enquiry mili thi.", side: "ai" },
      { speaker: "Vivek", time: "00:11", text: "I want a 2BHK for my parents in Mhow. What's the timeline?", side: "user" },
      { speaker: "Priya (AI)", time: "00:18", text: "Grand Virasat 2BHK, possession December 2026. We handle full NRI support — RERA paperwork, video tours. Connect you with our NRI sales head?", side: "ai" },
    ],
  },
  {
    id: "4", lead_name: "Karan Agarwal", lead_phone: "+91 99887 ••• ••32",
    project: "Oracle City · Commercial", source: "Meta Lead Ad", lead_score: 81, score_label: "HOT",
    duration_seconds: 158, outcome: "Site visit booked · Sun 11am", created_at: new Date(Date.now() - 60 * 60000).toISOString(),
    transcript: [
      { speaker: "Priya (AI)", time: "00:02", text: "Namaste Karan ji, Oracle City commercial space ke baare mein enquiry ki thi aapne.", side: "ai" },
      { speaker: "Karan", time: "00:10", text: "Shop chahiye showroom ke liye. Frontage kaisa hai?", side: "user" },
      { speaker: "Priya (AI)", time: "00:15", text: "Oracle City Mhow main road pe hai, premium frontage. Possession 2027. Kya size dekh rahe hain — 500 sq ft ya 1000 sq ft?", side: "ai" },
    ],
  },
];

const MOCK_WA: WaRow[] = [
  { id: "1", from_number: "+91", name: "Pooja Iyer", text_in: "Saturday 11am perfect hai. Address bhej do.", created_at: new Date().toISOString() },
  { id: "2", from_number: "+91", name: "Aakash Verma", text_in: "3BHK Pink City ka floor plan mil gaya, thanks!", created_at: new Date(Date.now() - 3 * 60000).toISOString() },
  { id: "3", from_number: "+971", name: "Rashid Khan (Dubai)", text_in: "Can you arrange a video tour next week?", created_at: new Date(Date.now() - 12 * 60000).toISOString() },
  { id: "4", from_number: "+91", name: "Meera Singh", text_in: "Possession date confirm kar sakte ho?", created_at: new Date(Date.now() - 28 * 60000).toISOString() },
  { id: "5", from_number: "+91", name: "Deepak Choudhary", text_in: "Maine brochure dekha, price kya hai?", created_at: new Date(Date.now() - 45 * 60000).toISOString() },
  { id: "6", from_number: "+974", name: "Imran Sheikh (Doha)", text_in: "NRI payment plan documents kab milenge?", created_at: new Date(Date.now() - 2 * 3600000).toISOString() },
  { id: "7", from_number: "+91", name: "Vikram Reddy", text_in: "Oracle City commercial — 1500 sqft available?", created_at: new Date(Date.now() - 3 * 3600000).toISOString() },
  { id: "8", from_number: "+91", name: "Geeta Pillai", text_in: "Haan main interested hoon, call karwa do", created_at: new Date(Date.now() - 6 * 3600000).toISOString() },
];

function timeAgo(ts: string) {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function fmtDuration(sec: number) {
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const [calls, setCalls] = useState<CallRow[]>(MOCK_CALLS);
  const [waMessages, setWaMessages] = useState<WaRow[]>(MOCK_WA);
  const [expandedCall, setExpandedCall] = useState<string | null>(null);
  const chartsRendered = useRef(false);

  const fetchLive = async () => {
    const [{ data: liveCalls }, { data: liveWa }] = await Promise.all([
      supabase.from("calls").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.from("wa_messages").select("*").order("created_at", { ascending: false }).limit(20),
    ]);
    if (liveCalls?.length) setCalls(liveCalls as CallRow[]);
    if (liveWa?.length) setWaMessages(liveWa as WaRow[]);
  };

  useEffect(() => {
    fetchLive();
    const interval = setInterval(fetchLive, 10000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderCharts = () => {
    if (chartsRendered.current) return;
    // @ts-expect-error Chart.js loaded via CDN
    if (typeof window.Chart === "undefined") return;
    chartsRendered.current = true;
    const projectCtx = (document.getElementById("projectChart") as HTMLCanvasElement)?.getContext("2d");
    const sourceCtx = (document.getElementById("sourceChart") as HTMLCanvasElement)?.getContext("2d");
    if (!projectCtx || !sourceCtx) return;
    // @ts-expect-error CDN global
    new window.Chart(projectCtx, { type: "bar", data: { labels: ["Grand Virasat","Pink City","Modern City","Oracle City","One Street","King Estate"], datasets: [{ data: [218,168,132,109,76,58], backgroundColor: ["#c9a85a","#b8975a","#a78657","#8a7440","#6e5d33","#544626"], borderRadius: 4, barThickness: 22 }] }, options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { grid: { color: "#2b2820" }, ticks: { color: "#a39a85", font: { size: 11 } } }, y: { grid: { display: false }, ticks: { color: "#f5f2ea", font: { size: 12, weight: 500 } } } }, maintainAspectRatio: false } });
    // @ts-expect-error CDN global
    new window.Chart(sourceCtx, { type: "doughnut", data: { labels: ["Meta · 42%","Google · 28%","99acres · 18%","Direct · 12%"], datasets: [{ data: [42,28,18,12], backgroundColor: ["#c9a85a","#8a7440","#544626","#3a2f1a"], borderWidth: 0 }] }, options: { cutout: "65%", plugins: { legend: { position: "right", labels: { color: "#f5f2ea", font: { size: 12 }, padding: 12, boxWidth: 12 } } }, maintainAspectRatio: false } });
  };

  return (
    <>
      <Script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js" onLoad={renderCharts} />
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        :root{--bg:#0f0e0c;--bg-2:#18160f;--panel:#1c1a14;--panel-2:#221f17;--line:#2b2820;--gold:#c9a85a;--gold-2:#d4b56b;--gold-dim:#8a7440;--text:#f5f2ea;--muted:#a39a85;--green:#6db77a;--red:#d97a6a;--orange:#e09f4e}
        html,body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;font-size:14px;min-height:100vh}
        .app{max-width:1440px;margin:0 auto;padding:24px 32px}
        .topbar{display:flex;align-items:center;justify-content:space-between;padding-bottom:18px;border-bottom:1px solid var(--line);margin-bottom:24px}
        .brand{display:flex;align-items:center;gap:14px}
        .brand-mark{width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,var(--gold) 0%,var(--gold-dim) 100%);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;color:#1a1611}
        .brand-text{display:flex;flex-direction:column}
        .brand-text .name{font-weight:600;font-size:15px;letter-spacing:.3px}
        .brand-text .sub{font-size:11px;color:var(--muted);letter-spacing:.5px;text-transform:uppercase}
        .topbar-right{display:flex;align-items:center;gap:16px;font-size:12px;color:var(--muted)}
        .live-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);margin-right:6px;animation:pulse 2s ease-in-out infinite}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        .tabs{display:flex;gap:4px;margin-bottom:24px;border-bottom:1px solid var(--line)}
        .tab{padding:10px 18px;cursor:pointer;font-size:13px;font-weight:500;color:var(--muted);border-bottom:2px solid transparent;transition:all .15s}
        .tab:hover{color:var(--text)}
        .tab.active{color:var(--gold);border-bottom-color:var(--gold)}
        .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px}
        .kpi{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px 20px}
        .kpi-label{font-size:11px;color:var(--muted);letter-spacing:.7px;text-transform:uppercase;margin-bottom:8px}
        .kpi-value{font-size:32px;font-weight:600;line-height:1}
        .kpi-delta{font-size:12px;margin-top:8px;color:var(--green)}
        .chart-row{display:grid;grid-template-columns:1.4fr 1fr;gap:16px;margin-bottom:24px}
        .panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px 20px}
        .panel-title{font-size:11px;color:var(--muted);letter-spacing:.7px;text-transform:uppercase;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between}
        .panel-title .sub{color:var(--gold);font-weight:500}
        .chart-wrap{height:240px;position:relative}
        .activity-row{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}
        .call-list{display:flex;flex-direction:column;gap:10px}
        .call-item{background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:14px;cursor:pointer;transition:all .15s}
        .call-item:hover{border-color:var(--gold-dim)}
        .call-row1{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
        .call-name{font-weight:600;font-size:14px}
        .call-meta{font-size:11px;color:var(--muted)}
        .call-row2{display:flex;gap:12px;align-items:center;font-size:12px;color:var(--muted)}
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
        .wa-list{display:flex;flex-direction:column;gap:0;max-height:480px;overflow-y:auto}
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
            <span><span className="live-dot" />Live · 9 projects · Mhow</span>
            <span>Khush · admin@oltaflock.ai</span>
          </div>
        </div>

        <div className="tabs">
          {(["overview","voice","whatsapp","leads","projects"] as const).map((tab) => (
            <div key={tab} className={`tab${activeTab === tab ? " active" : ""}`} onClick={() => setActiveTab(tab)}>
              {tab === "overview" && "Overview"}
              {tab === "voice" && `Voice Calls · ${calls.length}`}
              {tab === "whatsapp" && `WhatsApp · ${waMessages.length}`}
              {tab === "leads" && "All Leads · 1,284"}
              {tab === "projects" && "Projects"}
            </div>
          ))}
        </div>

        <div className="kpi-grid">
          <div className="kpi"><div className="kpi-label">Leads This Week</div><div className="kpi-value">1,284</div><div className="kpi-delta">▲ 18% WoW</div></div>
          <div className="kpi"><div className="kpi-label">Qualified</div><div className="kpi-value">412</div><div className="kpi-delta">▲ 31% WoW</div></div>
          <div className="kpi"><div className="kpi-label">Site Visits Booked</div><div className="kpi-value">96</div><div className="kpi-delta">▲ 22% WoW</div></div>
          <div className="kpi"><div className="kpi-label">Avg Response Time</div><div className="kpi-value">28<span style={{fontSize:18,color:"var(--muted)"}}>s</span></div><div className="kpi-delta">▼ from 4.2 hrs</div></div>
        </div>

        <div className="chart-row">
          <div className="panel">
            <div className="panel-title"><span>Demand by project · Last 30 days</span><span className="sub">Qualified leads</span></div>
            <div className="chart-wrap"><canvas id="projectChart" /></div>
          </div>
          <div className="panel">
            <div className="panel-title"><span>Source mix</span><span className="sub">1,284 leads</span></div>
            <div className="chart-wrap"><canvas id="sourceChart" /></div>
          </div>
        </div>

        <div className="activity-row">
          <div className="panel">
            <div className="panel-title"><span>Recent Voice Calls</span><span className="sub">Click to expand transcript</span></div>
            <div className="call-list">
              {calls.map((c) => (
                <div key={c.id} className="call-item" onClick={() => setExpandedCall(expandedCall === c.id ? null : c.id)}>
                  <div className="call-row1">
                    <span className="call-name">{c.lead_name}</span>
                    <span className="call-meta">{timeAgo(c.created_at)} · {fmtDuration(c.duration_seconds)}</span>
                  </div>
                  <div className="call-row2">
                    <span className={`score ${c.score_label?.toLowerCase()}`}>{c.score_label} · {c.lead_score}</span>
                    <span className="badge">{c.source}</span>
                    <span>{c.project}</span>
                  </div>
                  <div style={{fontSize:11,color:"var(--muted)",marginTop:6}}>→ {c.outcome}</div>
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
          </div>

          <div className="panel">
            <div className="panel-title"><span>WhatsApp Inbox</span><span className="sub">{waMessages.length} conversations</span></div>
            <div className="wa-list">
              {waMessages.map((w) => (
                <div key={w.id} className="wa-item">
                  <div className="wa-avatar">{w.name?.[0]?.toUpperCase() ?? "?"}</div>
                  <div className="wa-body">
                    <div className="wa-name">{w.name}</div>
                    <div className="wa-preview">{w.text_in}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div className="wa-time">{timeAgo(w.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="footer">
          Oltaflock × Sarthak Singapore · <span>AI Sales Engine v1.0</span> · Built in 30 minutes — production deploys in 30 days
        </div>
      </div>
    </>
  );
}
