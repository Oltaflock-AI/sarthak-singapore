"use client";

import { useState, useMemo } from "react";
import { useLiveData, bucketByScore, CallRow } from "@/lib/data";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ScoreBadge } from "@/components/ScoreBadge";
import { timeAgo, fmtDuration, initials } from "@/lib/format";

export default function LeadsPage() {
  const { calls, loading } = useLiveData();
  const { hot, warm, cold } = useMemo(() => bucketByScore(calls), [calls]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = calls.find((c) => c.id === selectedId);

  const columns = [
    { key: "hot", label: "Hot", hint: "Score 80+ · Ready to buy", items: hot, fg: "var(--hot)", bg: "var(--hot-soft)" },
    { key: "warm", label: "Warm", hint: "Score 60–79 · Nurture & schedule", items: warm, fg: "var(--warm)", bg: "var(--warm-soft)" },
    { key: "cold", label: "Cold", hint: "Score <60 · 14-day drip", items: cold, fg: "var(--cold)", bg: "var(--cold-soft)" },
  ];

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle={`${calls.length} qualified by the AI · drag your eye across the funnel`}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        {columns.map((col) => (
          <div key={col.key} className="panel" style={{ display: "flex", flexDirection: "column", minHeight: 400 }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className={`score ${col.key}`}>{col.label.toUpperCase()}</span>
                <span style={{ fontSize: 20, fontWeight: 600, color: col.fg }} className="num">{col.items.length}</span>
              </div>
              <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{col.hint}</span>
            </div>

            <div style={{ flex: 1, padding: 12, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>
              {loading ? (
                [0,1,2].map((i) => <div key={i} className="skeleton" style={{ height: 96 }} />)
              ) : col.items.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
                  No {col.label.toLowerCase()} leads yet
                </div>
              ) : (
                col.items.map((c) => <LeadCard key={c.id} call={c} onClick={() => setSelectedId(c.id)} />)
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Detail drawer */}
      {selected && <LeadDrawer call={selected} onClose={() => setSelectedId(null)} />}
    </>
  );
}

function LeadCard({ call, onClick }: { call: CallRow; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left",
        background: "var(--panel-2)",
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: "12px 14px",
        cursor: "pointer",
        transition: "border-color 0.15s, transform 0.15s",
        color: "var(--text)",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--line-strong)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line)"; }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div className="avatar sm">{initials(call.lead_name)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{call.lead_name ?? "Unknown"}</div>
          <div style={{ fontSize: 10.5, color: "var(--muted)" }} className="num">{call.lead_phone ?? "—"}</div>
        </div>
        <ScoreBadge score={call.lead_score} showScore={false} />
      </div>
      {call.project && <div style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 4 }}>{call.project}</div>}
      {call.outcome && <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>→ {call.outcome}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, color: "var(--muted)" }}>
        {call.source && <span>{call.source}</span>}
        <span className="num">{timeAgo(call.created_at)}</span>
      </div>
    </button>
  );
}

function LeadDrawer({ call, onClose }: { call: CallRow; onClose: () => void }) {
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 90, backdropFilter: "blur(2px)",
          animation: "fade-in 0.18s ease-out",
        }}
      />
      <div
        className="fade-in"
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 480, maxWidth: "92vw", zIndex: 100,
          background: "var(--panel)", borderLeft: "1px solid var(--line)",
          display: "flex", flexDirection: "column",
          boxShadow: "-12px 0 32px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{call.lead_name ?? "Unknown"}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }} className="num">{call.lead_phone ?? "—"}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", padding: 4 }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5 5l10 10M15 5L5 15" /></svg>
          </button>
        </div>

        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--line)", display: "flex", flexWrap: "wrap", gap: 8 }}>
          <ScoreBadge score={call.lead_score} />
          {call.source && <span className="badge">{call.source}</span>}
          {call.project && <span className="badge subtle">{call.project}</span>}
        </div>

        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--line)" }}>
          <Row label="Call duration" value={fmtDuration(call.duration_seconds ?? 0)} />
          <Row label="When" value={`${timeAgo(call.created_at)} · ${new Date(call.created_at).toLocaleString()}`} />
          <Row label="Outcome" value={call.outcome ?? "—"} />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 12, fontWeight: 600 }}>Transcript</div>
          {call.transcript && call.transcript.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {call.transcript.map((t, i) => (
                <div key={i}>
                  <div style={{ fontWeight: 600, color: t.side === "ai" ? "var(--gold)" : "var(--text)", fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>
                    {t.speaker} <span style={{ color: "var(--muted)", marginLeft: 6 }}>{t.time}</span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-2)" }}>{t.text}</div>
                </div>
              ))}
            </div>
          ) : <div style={{ fontSize: 12, color: "var(--muted)" }}>No transcript available.</div>}
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 12.5 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ color: "var(--text-2)", textAlign: "right", maxWidth: "60%" }}>{value}</span>
    </div>
  );
}
