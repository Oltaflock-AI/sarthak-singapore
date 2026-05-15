"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ScoreBadge } from "@/components/ScoreBadge";
import { timeAgo, initials } from "@/lib/format";

type Lead = {
  id: string;
  phone: string;
  name: string | null;
  project: string | null;
  buyer_type: string | null;
  residency: string | null;
  timeline: string | null;
  budget: string | null;
  source: string;
  lead_score: number;
  score_label: string;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type WaMsg = {
  id: string;
  from_number: string;
  name: string | null;
  text_in: string | null;
  text_out: string | null;
  created_at: string;
};

const STATUS_OPTIONS = ["new", "qualified", "booked", "converted", "lost"] as const;

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  async function refresh() {
    const res = await fetch("/api/leads", { cache: "no-store" });
    const data = await res.json();
    if (Array.isArray(data)) setLeads(data);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    let r = leads;
    if (filterStatus !== "all") r = r.filter((l) => l.status === filterStatus);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter((l) =>
        (l.name ?? "").toLowerCase().includes(q) ||
        l.phone.toLowerCase().includes(q) ||
        (l.project ?? "").toLowerCase().includes(q)
      );
    }
    return r;
  }, [leads, search, filterStatus]);

  const { hot, warm, cold, booked, converted, qualified } = useMemo(() => {
    const r = { hot: 0, warm: 0, cold: 0, booked: 0, converted: 0, qualified: 0 };
    for (const l of leads) {
      const s = (l.score_label ?? "WARM").toUpperCase();
      if (s === "HOT") r.hot++;
      else if (s === "COLD") r.cold++;
      else r.warm++;
      if (l.status === "booked") r.booked++;
      if (l.status === "converted") r.converted++;
      if (l.status === "qualified" || l.status === "booked" || l.status === "converted") r.qualified++;
    }
    return r;
  }, [leads]);

  const conversionRate = leads.length > 0 ? Math.round((booked + converted) / leads.length * 100) : 0;
  const qualRate = leads.length > 0 ? Math.round(qualified / leads.length * 100) : 0;

  const selected = leads.find((l) => l.id === selectedId);

  return (
    <>
      <PageHeader
        title="Leads · CRM"
        subtitle="Every contact across WhatsApp, Voice, and Web — live, scored, and routed."
      />

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 18 }}>
        <Kpi label="Total Leads" value={leads.length} accent="var(--text)" />
        <Kpi label="Hot" value={hot} accent="var(--hot)" sub={`${leads.length ? Math.round(hot/leads.length*100) : 0}%`} />
        <Kpi label="Qualified" value={qualified} accent="var(--warm)" sub={`${qualRate}% qual rate`} />
        <Kpi label="Site Visits" value={booked} accent="var(--gold)" />
        <Kpi label="Converted" value={converted} accent="var(--cold)" />
        <Kpi label="Conv. Rate" value={`${conversionRate}%`} accent="var(--gold-2)" />
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <input
          aria-label="Search leads"
          placeholder="Search by name, phone, or project…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, padding: "8px 12px", background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 4, color: "var(--text)", fontSize: 13 }}
        />
        <select
          aria-label="Filter by status"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={{ padding: "8px 12px", background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 4, color: "var(--text)", fontSize: 12 }}
        >
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Lead grid */}
      <div className="panel" style={{ overflow: "hidden" }}>
        {loading && leads.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Loading leads…</div>
        ) : filtered.length === 0 ? (
          <EmptyState title="No leads match" hint={search ? "Try a different search" : "Leads will appear here as conversations come in"} />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--line)", background: "var(--bg-2)" }}>
                <Th>Lead</Th>
                <Th>Source</Th>
                <Th>Project</Th>
                <Th>Buyer</Th>
                <Th>Timeline</Th>
                <Th>Budget</Th>
                <Th>Score</Th>
                <Th>Status</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => setSelectedId(l.id)}
                  style={{ borderBottom: "1px solid var(--line)", cursor: "pointer", transition: "background 0.1s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-2)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <Td>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div className="avatar">{initials(l.name ?? l.phone)}</div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{l.name ?? "Unnamed"}</div>
                        <div className="num" style={{ fontSize: 11, color: "var(--muted)" }}>{l.phone}</div>
                      </div>
                    </div>
                  </Td>
                  <Td><SourceBadge source={l.source} /></Td>
                  <Td><span style={{ fontSize: 12 }}>{l.project ?? "—"}</span></Td>
                  <Td>{l.buyer_type ? <Chip text={l.buyer_type} /> : "—"}</Td>
                  <Td>{l.timeline ?? "—"}</Td>
                  <Td>{l.budget ?? "—"}</Td>
                  <Td><ScoreBadge score={l.lead_score} /></Td>
                  <Td><StatusPill status={l.status} /></Td>
                  <Td><span style={{ fontSize: 11, color: "var(--muted)" }}>{timeAgo(l.updated_at)}</span></Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && <LeadDetail lead={selected} onClose={() => { setSelectedId(null); refresh(); }} />}
    </>
  );
}

function Kpi({ label, value, accent, sub }: { label: string; value: number | string; accent: string; sub?: string }) {
  return (
    <div className="panel" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>{label}</div>
      <div className="num" style={{ fontSize: 22, fontWeight: 600, color: accent, letterSpacing: -0.4 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "12px 14px", textAlign: "left", fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600 }}>{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "11px 14px", fontSize: 12.5 }}>{children}</td>;
}

function SourceBadge({ source }: { source: string | null | undefined }) {
  const s = (source ?? "").toLowerCase();
  let label = "Direct";
  let color = "var(--muted)";
  let bg = "var(--bg-2)";
  if (s === "whatsapp" || s === "wa") {
    label = "WhatsApp"; color = "#25d366"; bg = "rgba(37, 211, 102, 0.08)";
  } else if (s === "ringg" || s === "voice" || s === "voice_agent") {
    label = "Voice Agent"; color = "var(--gold-2)"; bg = "rgba(201,168,90,0.08)";
  } else if (s === "meta" || s === "facebook" || s === "instagram") {
    label = "Meta Ad"; color = "#4f8cff"; bg = "rgba(79, 140, 255, 0.08)";
  } else if (s === "google") {
    label = "Google Ad"; color = "#ea4335"; bg = "rgba(234, 67, 53, 0.08)";
  } else if (s === "web" || s === "website") {
    label = "Website"; color = "var(--text-2)";
  } else if (s) {
    label = s.charAt(0).toUpperCase() + s.slice(1);
  }
  return (
    <span style={{
      display: "inline-block", padding: "3px 9px", fontSize: 10.5, fontWeight: 500,
      color, background: bg, border: `1px solid ${color}33`, borderRadius: 4,
      letterSpacing: 0.2,
    }}>
      {label}
    </span>
  );
}

function Chip({ text }: { text: string }) {
  return <span style={{ display: "inline-block", padding: "2px 8px", fontSize: 10.5, background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 10, textTransform: "capitalize" }}>{text.replace(/_/g, " ")}</span>;
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === "converted" ? "var(--gold-2)" :
    status === "booked" ? "var(--gold)" :
    status === "qualified" ? "var(--warm)" :
    status === "lost" ? "var(--hot)" :
    "var(--muted)";
  return (
    <span style={{ display: "inline-block", padding: "3px 9px", fontSize: 10.5, fontWeight: 600, color, border: `1px solid ${color}`, borderRadius: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>
      {status}
    </span>
  );
}

function LeadDetail({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [messages, setMessages] = useState<WaMsg[]>([]);
  const [updating, setUpdating] = useState(false);
  const [localStatus, setLocalStatus] = useState(lead.status);

  useEffect(() => {
    fetch(`/api/wa-messages?phone=${encodeURIComponent(lead.phone)}`)
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setMessages(d.slice(0, 20)))
      .catch(() => {});
  }, [lead.phone]);

  async function changeStatus(newStatus: string) {
    setUpdating(true);
    await fetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: lead.id, status: newStatus }),
    });
    setLocalStatus(newStatus);
    setUpdating(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div className="panel" style={{ background: "var(--panel)", maxWidth: 760, width: "100%", maxHeight: "90vh", overflowY: "auto", padding: 0 }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div className="avatar" style={{ width: 44, height: 44, fontSize: 16 }}>{initials(lead.name ?? lead.phone)}</div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{lead.name ?? "Unnamed"}</div>
              <div className="num" style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{lead.phone}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>via {lead.source} · {timeAgo(lead.created_at)}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ScoreBadge score={lead.lead_score} />
            <StatusPill status={localStatus} />
          </div>
        </div>

        {/* Quick facts grid */}
        <div style={{ padding: "18px 24px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, borderBottom: "1px solid var(--line)" }}>
          <Field label="Project" value={lead.project} />
          <Field label="Buyer Type" value={lead.buyer_type?.replace(/_/g, " ") ?? null} />
          <Field label="Residency" value={lead.residency?.toUpperCase() ?? null} />
          <Field label="Timeline" value={lead.timeline} />
          <Field label="Budget" value={lead.budget} />
          <Field label="Last Update" value={timeAgo(lead.updated_at)} />
          <Field label="Score" value={`${lead.lead_score} / 100`} />
          <Field label="Status" value={localStatus} />
        </div>

        {/* WhatsApp preview */}
        <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Recent WhatsApp ({messages.length})</div>
          {messages.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>No messages found.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 240, overflowY: "auto", paddingRight: 4 }}>
              {messages.slice().reverse().map((m) => (
                <div key={m.id}>
                  {m.text_in && (
                    <div style={{ background: "var(--panel)", border: "1px solid var(--line)", padding: "6px 10px", borderRadius: 6, fontSize: 12, marginBottom: 4 }}>
                      <div style={{ fontSize: 9.5, color: "var(--muted)", marginBottom: 2 }}>{lead.name ?? "Lead"} · {timeAgo(m.created_at)}</div>
                      {m.text_in}
                    </div>
                  )}
                  {m.text_out && (
                    <div style={{ background: "var(--gold-soft-2)", border: "1px solid var(--gold-dim)", padding: "6px 10px", borderRadius: 6, fontSize: 12 }}>
                      <div style={{ fontSize: 9.5, color: "var(--gold-dim)", marginBottom: 2 }}>Priya · {timeAgo(m.created_at)}</div>
                      {m.text_out}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Action footer */}
        <div style={{ padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            {STATUS_OPTIONS.filter((s) => s !== localStatus).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => changeStatus(s)}
                disabled={updating}
                style={{ padding: "6px 12px", background: "transparent", color: "var(--text)", border: "1px solid var(--line-strong)", borderRadius: 4, cursor: "pointer", fontSize: 11, textTransform: "capitalize" }}
              >
                Mark {s}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} style={{ padding: "8px 14px", background: "var(--gold)", color: "#000", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13 }}>{value ?? "—"}</div>
    </div>
  );
}
