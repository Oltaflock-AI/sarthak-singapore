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
