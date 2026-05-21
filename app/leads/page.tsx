"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ScoreBadge } from "@/components/ScoreBadge";
import { timeAgo, initials, fmtDuration, fmtDateTime } from "@/lib/format";
import { supabase } from "@/lib/data";

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
        subtitle="Every lead from the voice agent — live, scored, and routed."
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

type TranscriptTurn = { side?: string; speaker?: string; text: string; time?: string };

type CallSlim = {
  id: string;
  call_id: string | null;
  duration_seconds: number | null;
  outcome: string | null;
  summary: string | null;
  lead_score: number | null;
  score_label: string | null;
  created_at: string;
  analysis: Record<string, unknown> | null;
  transcript: TranscriptTurn[] | null;
};

const POS_WORDS = /\b(haan|han|yes|yeah|sure|theek|sahi|ok|okay|booked|done|agreed|samajh|right|absolutely|definitely|interested|like|love|good|great)\b/i;
const NEG_WORDS = /\b(nahi|nahin|no|not|busy|cut|disconnect|wrong|bye|later|cancel|hate|don'?t)\b/i;

function computeCallSentiment(transcript: TranscriptTurn[] | null) {
  if (!transcript || transcript.length === 0) return { label: "—", color: "var(--muted)", emoji: "•", pos: 0, neg: 0 };
  let pos = 0, neg = 0;
  for (const t of transcript) {
    if (t.side !== "user" && t.speaker !== "user") continue;
    if (POS_WORDS.test(t.text)) pos++;
    if (NEG_WORDS.test(t.text)) neg++;
  }
  if (pos + neg === 0) return { label: "Neutral", color: "var(--muted)", emoji: "•", pos, neg };
  if (pos > neg * 1.5) return { label: "Positive", color: "#7dc77d", emoji: "▲", pos, neg };
  if (neg > pos * 1.5) return { label: "Negative", color: "#c97d7d", emoji: "▼", pos, neg };
  return { label: "Mixed", color: "#c9a85a", emoji: "◆", pos, neg };
}

function humanize(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const s = String(v).trim();
  if (!s || s === "unclear") return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeBudget(v?: string | null): string {
  if (!v) return "—";
  const m = v.toLowerCase().match(/^(\d+(?:\.\d+)?)[_\s-]*(lakh|lakhs|cr|crore|crores|k)$/i);
  if (m) {
    const n = Number(m[1]);
    const u = m[2].toLowerCase();
    if (u.startsWith("lakh")) return `₹${n} Lakh${n === 1 ? "" : "s"}`;
    if (u.startsWith("cr")) return `₹${n} Crore${n === 1 ? "" : "s"}`;
    if (u === "k") return `₹${n}K`;
  }
  return humanize(v);
}

function fmtPhoneFull(p?: string | null): string {
  if (!p) return "—";
  const clean = p.replace(/[^\d+]/g, "");
  if (clean.startsWith("+91") && clean.length === 13) return `+91 ${clean.slice(3, 8)} ${clean.slice(8)}`;
  if (clean.length === 12 && clean.startsWith("91")) return `+91 ${clean.slice(2, 7)} ${clean.slice(7)}`;
  return p;
}

function LeadDetail({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [calls, setCalls] = useState<CallSlim[]>([]);
  const [updating, setUpdating] = useState(false);
  const [localStatus, setLocalStatus] = useState(lead.status);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Fetch all voice calls for this phone (try with + and without)
    const phoneClean = lead.phone.replace(/^\+/, "");
    supabase
      .from("calls")
      .select("id,call_id,duration_seconds,outcome,summary,lead_score,score_label,created_at,analysis,transcript")
      .or(`lead_phone.eq.+${phoneClean},lead_phone.eq.${phoneClean}`)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (Array.isArray(data)) setCalls(data as CallSlim[]);
      });
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

  function copyPhone() {
    navigator.clipboard.writeText(lead.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const isVoice = lead.source === "voice_agent" || lead.source === "ringg";

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(2px)",
        zIndex: 100, display: "flex", justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <div
        className="panel"
        style={{
          background: "var(--panel)", width: "100%", maxWidth: 720, height: "100vh",
          overflowY: "auto", padding: 0, borderRadius: 0, borderLeft: "1px solid var(--line-strong)",
          animation: "slideIn 0.2s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero */}
        <div style={{
          padding: "26px 28px 22px",
          borderBottom: "1px solid var(--line)",
          background: "linear-gradient(180deg, rgba(201,168,90,0.04), transparent)",
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              position: "absolute", top: 18, right: 22, background: "transparent",
              border: "none", color: "var(--muted)", fontSize: 20, cursor: "pointer", lineHeight: 1,
            }}
            aria-label="Close"
          >×</button>

          <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 16 }}>
            <div className="avatar" style={{ width: 56, height: 56, fontSize: 20, flexShrink: 0 }}>
              {initials(lead.name ?? lead.phone)}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.3, marginBottom: 4 }}>
                {humanize(lead.name) !== "—" ? humanize(lead.name) : "Unnamed Lead"}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <SourceBadge source={lead.source} />
                <ScoreBadge score={lead.lead_score} />
                <StatusPill status={localStatus} />
              </div>
            </div>
          </div>

          <div style={{
            display: "grid", gridTemplateColumns: "1fr auto", gap: 14, alignItems: "center",
            padding: "12px 14px", background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 8,
          }}>
            <div>
              <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>Phone</div>
              <a href={`tel:${lead.phone}`} className="num" style={{
                fontSize: 16, color: "var(--text)", textDecoration: "none", fontWeight: 500, letterSpacing: 0.3,
              }}>
                {fmtPhoneFull(lead.phone)}
              </a>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={copyPhone} style={{
                padding: "7px 12px", fontSize: 11, fontWeight: 500, cursor: "pointer",
                background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 5,
                color: "var(--text-2)",
              }}>{copied ? "Copied ✓" : "Copy"}</button>
              <a href={`https://wa.me/${lead.phone.replace(/[^\d]/g, "")}`} target="_blank" rel="noreferrer" style={{
                padding: "7px 12px", fontSize: 11, fontWeight: 500, textDecoration: "none",
                background: "rgba(37,211,102,0.1)", border: "1px solid rgba(37,211,102,0.35)",
                borderRadius: 5, color: "#25d366",
              }}>WhatsApp</a>
            </div>
          </div>

          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span>Created {timeAgo(lead.created_at)}</span>
            <span>·</span>
            <span>Updated {timeAgo(lead.updated_at)}</span>
            <span>·</span>
            <span>{calls.length} {calls.length === 1 ? "voice call" : "voice calls"}</span>
          </div>
        </div>

        {/* Qualification tiles */}
        <SectionHeader title="Qualification" />
        <div style={{
          padding: "0 28px 24px",
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10,
        }}>
          <Tile label="Project" value={humanize(lead.project)} />
          <Tile label="Buyer Type" value={humanize(lead.buyer_type)} />
          <Tile label="Budget" value={humanizeBudget(lead.budget)} accent="var(--gold-2)" />
          <Tile label="Timeline" value={humanize(lead.timeline)} />
          <Tile label="Residency" value={lead.residency ? lead.residency.toUpperCase() : "—"} />
          <Tile label="Score" value={`${lead.lead_score} / 100`} />
        </div>

        {/* Voice Calls */}
        {calls.length > 0 && (
          <>
            <SectionHeader title={`Voice Calls (${calls.length})`} />
            <div style={{ padding: "0 28px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
              {calls.map((c) => {
                const a = (c.analysis ?? {}) as Record<string, unknown>;
                const siteVisit = a.site_visit_booked === true;
                // Prefer deep AI sentiment from enrichment; fall back to keyword heuristic.
                const aiSent = a.sentiment as { overall?: string } | null | undefined;
                const sent = aiSent?.overall
                  ? (aiSent.overall === "positive"
                      ? { label: "Positive", color: "#7dc77d", emoji: "▲", pos: 0, neg: 0 }
                      : aiSent.overall === "negative"
                      ? { label: "Negative", color: "#c97d7d", emoji: "▼", pos: 0, neg: 0 }
                      : aiSent.overall === "mixed"
                      ? { label: "Mixed", color: "#c9a85a", emoji: "◆", pos: 0, neg: 0 }
                      : { label: "Neutral", color: "var(--muted)", emoji: "•", pos: 0, neg: 0 })
                  : computeCallSentiment(c.transcript);
                const aiMot = a.motivation as { score?: number } | null | undefined;
                const motivation = typeof aiMot?.score === "number" ? Math.round(aiMot.score) : (c.lead_score ?? 0);
                const motivationColor = motivation >= 75 ? "#7dc77d" : motivation >= 50 ? "#c9a85a" : motivation > 0 ? "#c97d7d" : "var(--muted)";
                return (
                  <Link
                    key={c.id}
                    href={`/calls/${c.id}`}
                    style={{
                      display: "block", padding: "14px 16px", borderRadius: 8,
                      background: "var(--bg-2)", border: "1px solid var(--line)",
                      textDecoration: "none", color: "inherit", transition: "border-color 0.15s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--gold-dim)")}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--line)")}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <ScoreBadge score={c.lead_score} />
                        <span style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "capitalize" }}>
                          {c.outcome ?? "completed"} · {fmtDuration(c.duration_seconds ?? 0)}
                        </span>
                        {siteVisit && (
                          <span style={{
                            fontSize: 10, padding: "2px 7px", borderRadius: 999,
                            background: "rgba(125,199,125,0.12)", color: "#7dc77d",
                            border: "1px solid rgba(125,199,125,0.3)", fontWeight: 500,
                          }}>✓ Site visit</span>
                        )}
                      </div>
                      <span style={{ fontSize: 11, color: "var(--muted)" }} className="num">
                        {fmtDateTime(c.created_at)}
                      </span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginBottom: 8 }}>
                      <div style={{
                        padding: "8px 10px", borderRadius: 6,
                        background: "var(--panel)", border: "1px solid var(--line)",
                      }}>
                        <div style={{ fontSize: 9.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600 }}>
                          Motivation Score
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: motivationColor, marginTop: 3, letterSpacing: -0.3 }}>
                          {motivation > 0 ? `${motivation} / 100` : "—"}
                        </div>
                      </div>
                      <div style={{
                        padding: "8px 10px", borderRadius: 6,
                        background: "var(--panel)", border: "1px solid var(--line)",
                      }}>
                        <div style={{ fontSize: 9.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600 }}>
                          Sentiment
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: sent.color, marginTop: 4 }}>
                          {sent.emoji} {sent.label}
                          {(sent.pos > 0 || sent.neg > 0) && (
                            <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 6, fontWeight: 400 }}>
                              +{sent.pos}/-{sent.neg}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {c.summary && (
                      <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5, marginTop: 4 }}>
                        {c.summary}
                      </div>
                    )}
                    <div style={{ fontSize: 10.5, color: "var(--gold-2)", marginTop: 8 }}>
                      Open full transcript →
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}

        {/* Notes */}
        {lead.notes && (
          <>
            <SectionHeader title="Notes" />
            <div style={{ padding: "0 28px 24px" }}>
              <div className="panel" style={{ padding: "14px 16px", fontSize: 13, lineHeight: 1.55, color: "var(--text-2)" }}>
                {lead.notes}
              </div>
            </div>
          </>
        )}

        {calls.length === 0 && (
          <div style={{ padding: "0 28px 24px", fontSize: 12.5, color: "var(--muted)" }}>
            No voice calls yet for this lead.
          </div>
        )}

        {/* Status actions */}
        <div style={{
          position: "sticky", bottom: 0, padding: "14px 28px",
          background: "var(--panel)", borderTop: "1px solid var(--line)",
          display: "flex", gap: 8, flexWrap: "wrap",
        }}>
          <div style={{ fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.8, alignSelf: "center", marginRight: 6 }}>
            Move to:
          </div>
          {STATUS_OPTIONS.filter((s) => s !== localStatus).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => changeStatus(s)}
              disabled={updating}
              style={{
                padding: "7px 13px", background: "transparent", color: "var(--text-2)",
                border: "1px solid var(--line)", borderRadius: 5, cursor: "pointer",
                fontSize: 11.5, textTransform: "capitalize", fontWeight: 500,
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--gold-dim)";
                e.currentTarget.style.color = "var(--gold-2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--line)";
                e.currentTarget.style.color = "var(--text-2)";
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <style jsx>{`
        @keyframes slideIn {
          from { transform: translateX(40px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{
      padding: "20px 28px 10px",
      fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase",
      letterSpacing: 1.2, fontWeight: 600,
    }}>
      {title}
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{
      padding: "12px 14px", background: "var(--bg-2)", border: "1px solid var(--line)",
      borderRadius: 7, transition: "border-color 0.15s",
    }}>
      <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 500 }}>
        {label}
      </div>
      <div style={{ fontSize: 13.5, color: accent ?? "var(--text)", marginTop: 5, fontWeight: 500, lineHeight: 1.3 }}>
        {value}
      </div>
    </div>
  );
}
