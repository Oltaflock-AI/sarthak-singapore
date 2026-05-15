"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase, CallRow } from "@/lib/data";
import { PageHeader } from "@/components/PageHeader";
import { ScoreBadge } from "@/components/ScoreBadge";
import { fmtDuration, fmtPhone, timeAgo } from "@/lib/format";

type AnalysisBlob = {
  intent?: string;
  timeline?: string;
  callee_name?: string;
  next_action?: string;
  budget_range?: string;
  call_summary?: string;
  language_spoken?: string;
  project_interest?: string;
  site_visit_booked?: boolean;
  platform_summary?: string;
  classification?: string;
  key_points?: string[];
  action_items?: string[];
  recording_url?: string;
  custom_args?: Record<string, string>;
};

const POS_WORDS = /\b(haan|han|yes|yeah|sure|theek|sahi|ok|okay|booked|done|agreed|samajh|right|absolutely|definitely|interested|like|love)\b/i;
const NEG_WORDS = /\b(nahi|nahin|no|not|busy|cut|disconnect|wrong|bye|later|cancel|hate|don'?t)\b/i;

function computeSentiment(transcript: CallRow["transcript"]): { label: string; color: string; pos: number; neg: number } {
  if (!transcript || transcript.length === 0) return { label: "—", color: "var(--muted)", pos: 0, neg: 0 };
  let pos = 0, neg = 0;
  for (const t of transcript) {
    if (t.side !== "user" && t.speaker !== "user") continue;
    if (POS_WORDS.test(t.text)) pos++;
    if (NEG_WORDS.test(t.text)) neg++;
  }
  if (pos + neg === 0) return { label: "Neutral", color: "var(--muted)", pos, neg };
  if (pos > neg * 1.5) return { label: "Positive", color: "#7dc77d", pos, neg };
  if (neg > pos * 1.5) return { label: "Negative", color: "#c97d7d", pos, neg };
  return { label: "Mixed", color: "#c9a85a", pos, neg };
}

export default function CallDetailPage() {
  const params = useParams<{ id: string }>();
  const [call, setCall] = useState<CallRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOne = async () => {
      const { data } = await supabase.from("calls").select("*").eq("id", params.id).maybeSingle();
      setCall((data as CallRow) ?? null);
      setLoading(false);
    };
    fetchOne();
    const id = setInterval(fetchOne, 10000);
    return () => clearInterval(id);
  }, [params.id]);

  const analysis = (call?.analysis ?? {}) as AnalysisBlob;
  const sentiment = useMemo(() => computeSentiment(call?.transcript ?? null), [call?.transcript]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Loading…" subtitle="" />
        <div className="skeleton" style={{ height: 200 }} />
      </div>
    );
  }
  if (!call) {
    return (
      <div>
        <PageHeader title="Call not found" subtitle="" />
        <Link href="/calls" style={{ color: "var(--gold-2)" }}>← Back to calls</Link>
      </div>
    );
  }

  const stats: { label: string; value: string }[] = [];
  const pushStat = (label: string, v: unknown) => {
    if (v === null || v === undefined) return;
    const s = typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
    if (!s.trim() || s === "unclear") return;
    stats.push({ label, value: s });
  };
  pushStat("Phone", fmtPhone(call.lead_phone));
  pushStat("Project", call.project || analysis.project_interest);
  pushStat("Intent", analysis.intent);
  pushStat("Budget", analysis.budget_range);
  pushStat("Timeline", analysis.timeline);
  pushStat("Next action", analysis.next_action);
  pushStat("Site visit booked", analysis.site_visit_booked);
  pushStat("Language", call.language || analysis.language_spoken);
  pushStat("Classification", analysis.classification);
  pushStat("Duration", fmtDuration(call.duration_seconds ?? 0));
  pushStat("Outcome", call.outcome);

  return (
    <div>
      <Link href="/calls" style={{ fontSize: 12, color: "var(--muted)", textDecoration: "none" }}>
        ← Back to calls
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12, marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{call.lead_name ?? "Unknown caller"}</h1>
        <ScoreBadge score={call.lead_score} />
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 18 }}>
        {timeAgo(call.created_at)} · {call.source ?? "—"} · call_id {call.call_id?.slice(0, 8)}
      </div>

      {analysis.recording_url && (
        <div className="panel" style={{ padding: "14px 16px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Recording</div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={analysis.recording_url} style={{ width: "100%" }} />
        </div>
      )}

      {(call.summary || analysis.platform_summary) && (
        <div className="panel" style={{ padding: "16px 18px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Summary</div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text)" }}>
            {call.summary || analysis.platform_summary}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 16 }}>
        {stats.map((s) => (
          <div key={s.label} className="panel" style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>{s.label}</div>
            <div style={{ fontSize: 13, color: "var(--text)", marginTop: 4, fontWeight: 500 }}>{s.value}</div>
          </div>
        ))}
        <div className="panel" style={{ padding: "12px 14px" }}>
          <div style={{ fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Sentiment</div>
          <div style={{ fontSize: 13, color: sentiment.color, marginTop: 4, fontWeight: 600 }}>
            {sentiment.label}
            <span style={{ fontSize: 10.5, color: "var(--muted)", marginLeft: 6, fontWeight: 400 }}>
              {sentiment.pos > 0 || sentiment.neg > 0 ? `+${sentiment.pos} / -${sentiment.neg}` : ""}
            </span>
          </div>
        </div>
      </div>

      {Array.isArray(analysis.key_points) && analysis.key_points.length > 0 && (
        <div className="panel" style={{ padding: "16px 18px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Key Signals</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7, color: "var(--text-2)" }}>
            {analysis.key_points.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}

      {Array.isArray(analysis.action_items) && analysis.action_items.length > 0 && (
        <div className="panel" style={{ padding: "16px 18px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Action Items</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7, color: "var(--text-2)" }}>
            {analysis.action_items.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}

      {call.transcript && call.transcript.length > 0 && (
        <div className="panel" style={{ padding: "16px 18px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>Transcript</div>
          <div>
            {call.transcript.map((t, i) => (
              <div key={i} style={{ marginBottom: 14, fontSize: 13, lineHeight: 1.6 }}>
                <div style={{
                  fontWeight: 600, fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase",
                  color: t.side === "agent" ? "var(--gold-2)" : "var(--text)",
                }}>
                  {t.speaker}
                  {t.time && <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 8, fontWeight: 400 }}>{new Date(t.time).toLocaleTimeString()}</span>}
                </div>
                <div style={{ marginTop: 3, color: "var(--text-2)" }}>{t.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
