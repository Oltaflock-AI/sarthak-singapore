"use client";

import { useState } from "react";
import { CallRow } from "@/lib/data";
import { ScoreBadge } from "./ScoreBadge";
import { timeAgo, fmtDuration } from "@/lib/format";

interface Props {
  call: CallRow;
  defaultOpen?: boolean;
}

export function CallCard({ call, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      onClick={() => setOpen((o) => !o)}
      style={{
        background: "var(--panel-2)",
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: "14px 16px",
        cursor: "pointer",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--line-strong)")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--line)")}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{call.lead_name ?? "Unknown caller"}</span>
        <span style={{ fontSize: 11, color: "var(--muted)" }} className="num">
          {timeAgo(call.created_at)} · {fmtDuration(call.duration_seconds ?? 0)}
        </span>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: "var(--muted)", flexWrap: "wrap" }}>
        <ScoreBadge score={call.lead_score} />
        {call.source && <span className="badge">{call.source}</span>}
        {call.project && <span style={{ color: "var(--text-2)" }}>{call.project}</span>}
      </div>
      {call.outcome && (
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
          → {call.outcome}
        </div>
      )}
      {(() => {
        const a = (call.analysis ?? {}) as Record<string, unknown>;
        const chips: { label: string; value: string }[] = [];
        const get = (k: string) => {
          const v = a[k];
          return typeof v === "string" && v.trim() && v !== "unclear" ? v : null;
        };
        const intent = get("intent");
        const budget = get("budget_range");
        const timeline = get("timeline");
        const next = get("next_action");
        const nri = get("nri_status");
        const siteVisit = a["site_visit_booked"];
        if (intent) chips.push({ label: "intent", value: intent });
        if (budget) chips.push({ label: "budget", value: budget });
        if (timeline) chips.push({ label: "timeline", value: timeline });
        if (nri) chips.push({ label: "nri", value: nri });
        if (siteVisit === true) chips.push({ label: "site visit", value: "booked" });
        if (next) chips.push({ label: "next", value: next });
        if (chips.length === 0) return null;
        return (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {chips.map((c) => (
              <span key={c.label} style={{
                fontSize: 10.5, padding: "3px 8px", borderRadius: 5,
                background: "var(--bg-2)", border: "1px solid var(--line)",
                color: "var(--text-2)",
              }}>
                <span style={{ color: "var(--muted)" }}>{c.label}:</span> {c.value}
              </span>
            ))}
          </div>
        );
      })()}
      {call.summary && (
        <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 10, lineHeight: 1.45, fontStyle: "italic" }}>
          “{call.summary}”
        </div>
      )}
      {open && call.transcript && call.transcript.length > 0 && (
        <div
          className="fade-in"
          style={{
            marginTop: 12,
            padding: 14,
            background: "var(--bg-2)",
            borderRadius: 6,
            border: "1px solid var(--line)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {call.transcript.map((t, i) => (
            <div key={i} style={{ marginBottom: i === call.transcript!.length - 1 ? 0 : 12, fontSize: 12.5, lineHeight: 1.55 }}>
              <span style={{ fontWeight: 600, color: t.side === "ai" ? "var(--gold)" : "var(--text)", fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase" }}>
                {t.speaker}
              </span>
              <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 8 }}>{t.time}</span>
              <div style={{ marginTop: 2, color: "var(--text-2)" }}>{t.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
