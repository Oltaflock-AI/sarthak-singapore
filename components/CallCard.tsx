"use client";

import Link from "next/link";
import { CallRow } from "@/lib/data";
import { ScoreBadge } from "./ScoreBadge";
import { timeAgo, fmtDuration } from "@/lib/format";

interface Props {
  call: CallRow;
}

export function CallCard({ call }: Props) {
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
  const siteVisit = a["site_visit_booked"];
  if (intent) chips.push({ label: "intent", value: intent });
  if (budget) chips.push({ label: "budget", value: budget });
  if (timeline) chips.push({ label: "timeline", value: timeline });
  if (siteVisit === true) chips.push({ label: "site visit", value: "booked" });
  if (next) chips.push({ label: "next", value: next });

  return (
    <Link
      href={`/calls/${call.id}`}
      style={{
        display: "block",
        textDecoration: "none",
        color: "inherit",
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
      {chips.length > 0 && (
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
      )}
      {call.summary && (
        <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 10, lineHeight: 1.45, fontStyle: "italic" }}>
          &ldquo;{call.summary}&rdquo;
        </div>
      )}
    </Link>
  );
}
