"use client";

import Link from "next/link";
import { CallRow } from "@/lib/data";
import { ScoreBadge } from "./ScoreBadge";
import { fmtDuration, fmtDateTime } from "@/lib/format";

interface Props {
  call: CallRow;
}

function humanize(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const s = String(v).trim();
  if (!s || s === "unclear") return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeBudget(v: string | null): string {
  if (!v) return "—";
  const m = v.toLowerCase().match(/^(\d+(?:\.\d+)?)[_\s-]*(lakh|lakhs|cr|crore|crores|k)$/i);
  if (m) {
    const n = Number(m[1]);
    const u = m[2].toLowerCase();
    if (u.startsWith("lakh")) return `₹${n}L`;
    if (u.startsWith("cr")) return `₹${n}Cr`;
    if (u === "k") return `₹${n}K`;
  }
  return humanize(v);
}

const POS_WORDS = /\b(haan|han|yes|yeah|sure|theek|sahi|ok|okay|booked|done|agreed|samajh|right|absolutely|definitely|interested|like|love|good|great)\b/i;
const NEG_WORDS = /\b(nahi|nahin|no|not|busy|cut|disconnect|wrong|bye|later|cancel|hate|don'?t)\b/i;

function sentimentOf(transcript: CallRow["transcript"]) {
  if (!transcript || transcript.length === 0) return null;
  let pos = 0, neg = 0;
  for (const t of transcript) {
    if (t.side !== "user" && t.speaker !== "user") continue;
    if (POS_WORDS.test(t.text)) pos++;
    if (NEG_WORDS.test(t.text)) neg++;
  }
  if (pos + neg === 0) return { label: "Neutral", color: "var(--muted)", emoji: "•" };
  if (pos > neg * 1.5) return { label: "Positive", color: "#7dc77d", emoji: "▲" };
  if (neg > pos * 1.5) return { label: "Negative", color: "#c97d7d", emoji: "▼" };
  return { label: "Mixed", color: "#c9a85a", emoji: "◆" };
}

export function CallCard({ call }: Props) {
  const a = (call.analysis ?? {}) as Record<string, unknown>;
  const get = (k: string) => {
    const v = a[k];
    return typeof v === "string" && v.trim() && v !== "unclear" ? v : null;
  };
  const intent = get("intent");
  const budget = get("budget_range");
  const timeline = get("timeline");
  const siteVisit = a["site_visit_booked"] === true;
  // Prefer the deep AI sentiment from enrichment; fall back to keyword heuristic.
  const aiSent = a["sentiment"] as { overall?: string } | null | undefined;
  const sentiment = aiSent?.overall
    ? (() => {
        const o = aiSent.overall!;
        if (o === "positive") return { label: "Positive", color: "#7dc77d", emoji: "▲" };
        if (o === "negative") return { label: "Negative", color: "#c97d7d", emoji: "▼" };
        if (o === "mixed") return { label: "Mixed", color: "#c9a85a", emoji: "◆" };
        return { label: "Neutral", color: "var(--muted)", emoji: "•" };
      })()
    : sentimentOf(call.transcript);

  const score = call.lead_score ?? 0;
  const scoreColor = score >= 80 ? "#7dc77d" : score >= 60 ? "#c9a85a" : score > 0 ? "#c97d7d" : "var(--muted)";

  return (
    <Link
      href={`/calls/${call.id}`}
      style={{
        display: "block",
        textDecoration: "none",
        color: "inherit",
        background: "var(--panel-2)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: "16px 18px",
        cursor: "pointer",
        transition: "border-color 0.15s, transform 0.15s",
        position: "relative",
        overflow: "hidden",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--gold-dim)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--line)";
      }}
    >
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
        background: scoreColor, opacity: 0.6,
      }} />

      {/* Header: name + score + datetime */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        gap: 12, marginBottom: 10, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: -0.2 }}>
            {call.lead_name ? humanize(call.lead_name) : "Unknown caller"}
          </span>
          {call.lead_phone && (
            <span className="num" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: 0.3 }}>
              {call.lead_phone}
            </span>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11.5, color: "var(--text-2)" }} className="num">
            {fmtDateTime(call.created_at)}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }} className="num">
            {fmtDuration(call.duration_seconds ?? 0)} · {call.outcome ?? "completed"}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
        gap: 8,
        marginBottom: chipsExist(intent, budget, timeline, siteVisit) ? 12 : 0,
      }}>
        <MiniStat label="Score" value={score > 0 ? `${score}` : "—"} accent={scoreColor} />
        <MiniStat label="Status" value={(call.score_label ?? "—").toUpperCase()} accent={scoreColor} />
        {sentiment && (
          <MiniStat
            label="Sentiment"
            value={<><span>{sentiment.emoji}</span> {sentiment.label}</>}
            accent={sentiment.color}
          />
        )}
        {call.source && (
          <MiniStat
            label="Source"
            value={(call.source ?? "").toLowerCase() === "ringg" ? "Voice Agent" : humanize(call.source)}
            accent="#c9a85a"
          />
        )}
        {call.project && (
          <MiniStat label="Project" value={humanize(call.project)} accent="#7a9ac7" />
        )}
      </div>

      {/* Qualification chips */}
      {(intent || budget || timeline || siteVisit) && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {intent && <Chip label="Intent" value={humanize(intent)} />}
          {budget && <Chip label="Budget" value={humanizeBudget(budget)} accent="#c9a85a" />}
          {timeline && <Chip label="Timeline" value={humanize(timeline)} />}
          {siteVisit && (
            <span style={{
              fontSize: 10.5, padding: "3px 9px", borderRadius: 999,
              background: "rgba(125,199,125,0.12)", color: "#7dc77d",
              border: "1px solid rgba(125,199,125,0.3)", fontWeight: 600,
            }}>
              ✓ Site visit booked
            </span>
          )}
        </div>
      )}

      {call.summary && (
        <div style={{
          fontSize: 12.5, color: "var(--text-2)", marginTop: 12, lineHeight: 1.55,
          padding: "10px 12px", background: "var(--bg-2)", borderRadius: 6,
          borderLeft: "2px solid var(--gold-dim)",
        }}>
          {call.summary}
        </div>
      )}
    </Link>
  );
}

function chipsExist(...vals: unknown[]): boolean {
  return vals.some(Boolean);
}

function MiniStat({ label, value, accent }: { label: string; value: React.ReactNode; accent: string }) {
  return (
    <div style={{
      padding: "7px 9px", borderRadius: 6,
      background: "var(--bg-2)", border: "1px solid var(--line)",
    }}>
      <div style={{
        fontSize: 9, color: "var(--muted)", textTransform: "uppercase",
        letterSpacing: 0.7, fontWeight: 600, marginBottom: 3,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 12.5, color: accent, fontWeight: 600, lineHeight: 1.2 }}>
        {value}
      </div>
    </div>
  );
}

function Chip({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <span style={{
      fontSize: 10.5, padding: "3px 9px", borderRadius: 5,
      background: "var(--bg-2)", border: "1px solid var(--line)",
      color: accent ?? "var(--text-2)",
    }}>
      <span style={{ color: "var(--muted)" }}>{label}:</span> {value}
    </span>
  );
}

// Keep ScoreBadge import alive for future use elsewhere
void ScoreBadge;
