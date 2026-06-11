"use client";

import { CallRow, missedReason } from "@/lib/data";
import { fmtDateTime } from "@/lib/format";

interface Props {
  call: CallRow;
}

function humanize(v: string): string {
  return v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Compact log row for a call that never connected (busy / no answer / rejected).
// Deliberately lighter than CallCard — no score/sentiment/transcript, since
// there's no conversation. Shows just who we tried, the number, and why.
export function MissedCallCard({ call }: Props) {
  const name = call.lead_name ? humanize(call.lead_name) : (call.lead_phone || "Unknown number");
  const showPhone = !!call.lead_name && !!call.lead_phone;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        background: "var(--panel-2)",
        border: "1px solid var(--line)",
        borderLeft: "3px solid #c97d7d",
        borderRadius: 10,
        padding: "14px 18px",
      }}
    >
      {/* missed-call glyph */}
      <div
        aria-hidden
        style={{
          flexShrink: 0,
          width: 36,
          height: 36,
          borderRadius: 9,
          display: "grid",
          placeItems: "center",
          background: "rgba(201, 125, 125, 0.12)",
          color: "#c97d7d",
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
          <line x1="23" y1="1" x2="1" y2="23" />
        </svg>
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: 14, letterSpacing: -0.2 }}>{name}</span>
          {showPhone && (
            <span className="num" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: 0.3 }}>
              {call.lead_phone}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: "#c97d7d", marginTop: 3 }}>
          Not picked up · {missedReason(call)}
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: "var(--text-2)", whiteSpace: "nowrap" }} className="num">
        {fmtDateTime(call.created_at)}
      </div>
    </div>
  );
}
