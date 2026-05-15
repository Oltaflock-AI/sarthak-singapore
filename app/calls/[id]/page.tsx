"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase, CallRow } from "@/lib/data";
import { ScoreBadge } from "@/components/ScoreBadge";
import { fmtDuration, timeAgo } from "@/lib/format";

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

// ── Humanizers ─────────────────────────────────────────────────────────────
function humanize(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const s = String(v).trim();
  if (!s || s === "unclear") return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeBudget(v?: string): string {
  if (!v) return "—";
  const s = v.toLowerCase().trim();
  const m = s.match(/^(\d+(?:\.\d+)?)[_\s-]*(lakh|lakhs|cr|crore|crores|k)$/i);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    if (unit.startsWith("lakh")) return `₹${n} Lakh${n === 1 ? "" : "s"}`;
    if (unit.startsWith("cr")) return `₹${n} Crore${n === 1 ? "" : "s"}`;
    if (unit === "k") return `₹${n}K`;
  }
  return humanize(v);
}

function humanizeTimeline(v?: string): string {
  if (!v) return "—";
  const s = v.toLowerCase();
  if (s.includes("immediate")) return "Immediate possession";
  if (s.includes("ready")) return "Ready possession";
  if (s.includes("3") || s.includes("three")) return "Within 3 months";
  if (s.includes("6") || s.includes("six")) return "Within 6 months";
  if (s.includes("year")) return "Within a year";
  if (s.includes("explor")) return "Just exploring";
  return humanize(v);
}

function humanizeLang(v?: string | null): string {
  if (!v) return "—";
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
}

function fmtPhoneFull(p?: string | null): string {
  if (!p) return "—";
  const clean = p.replace(/[^\d+]/g, "");
  if (clean.startsWith("+91") && clean.length === 13) {
    return `+91 ${clean.slice(3, 8)} ${clean.slice(8)}`;
  }
  return p;
}

// ── Sentiment ──────────────────────────────────────────────────────────────
const POS_WORDS = /\b(haan|han|yes|yeah|sure|theek|sahi|ok|okay|booked|done|agreed|samajh|right|absolutely|definitely|interested|like|love|good|great)\b/i;
const NEG_WORDS = /\b(nahi|nahin|no|not|busy|cut|disconnect|wrong|bye|later|cancel|hate|don'?t)\b/i;

function computeSentiment(transcript: CallRow["transcript"]) {
  if (!transcript || transcript.length === 0) return { label: "—", color: "var(--muted)", emoji: "•", pos: 0, neg: 0, ratio: 0 };
  let pos = 0, neg = 0;
  for (const t of transcript) {
    if (t.side !== "user" && t.speaker !== "user") continue;
    if (POS_WORDS.test(t.text)) pos++;
    if (NEG_WORDS.test(t.text)) neg++;
  }
  const total = pos + neg;
  const ratio = total === 0 ? 0.5 : pos / total;
  if (total === 0) return { label: "Neutral", color: "var(--muted)", emoji: "•", pos, neg, ratio };
  if (pos > neg * 1.5) return { label: "Positive", color: "#7dc77d", emoji: "▲", pos, neg, ratio };
  if (neg > pos * 1.5) return { label: "Negative", color: "#c97d7d", emoji: "▼", pos, neg, ratio };
  return { label: "Mixed", color: "#c9a85a", emoji: "◆", pos, neg, ratio };
}

// ── UI bits ────────────────────────────────────────────────────────────────
function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 12, paddingLeft: 2,
      }}>
        <div style={{
          fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase",
          letterSpacing: 1.4, fontWeight: 600,
        }}>
          {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function KpiTile({
  label, value, sub, accent, icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      className="panel"
      style={{
        position: "relative",
        padding: "18px 18px 16px",
        overflow: "hidden",
        background: `linear-gradient(135deg, ${accent}10, transparent 70%)`,
      }}
    >
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
        background: accent, opacity: 0.7,
      }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{
          fontSize: 10, color: "var(--muted)", textTransform: "uppercase",
          letterSpacing: 1.1, fontWeight: 600,
        }}>
          {label}
        </div>
        <div style={{
          width: 26, height: 26, borderRadius: 6,
          background: `${accent}1a`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: accent, fontSize: 13,
        }}>
          {icon}
        </div>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", lineHeight: 1.1, letterSpacing: -0.3 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6, letterSpacing: 0.2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function StatTile({
  label, value, accent, icon,
}: {
  label: string;
  value: React.ReactNode;
  accent?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className="panel"
      style={{
        position: "relative",
        padding: "14px 16px",
        overflow: "hidden",
      }}
    >
      {accent && (
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: 2,
          background: accent, opacity: 0.6,
        }} />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        {icon && (
          <div style={{ fontSize: 11, color: accent ?? "var(--muted)", lineHeight: 1 }}>{icon}</div>
        )}
        <div style={{
          fontSize: 10, color: "var(--muted)", textTransform: "uppercase",
          letterSpacing: 0.9, fontWeight: 600,
        }}>
          {label}
        </div>
      </div>
      <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 500, lineHeight: 1.35 }}>
        {value}
      </div>
    </div>
  );
}

export default function CallDetailPage() {
  const params = useParams<{ id: string }>();
  const [call, setCall] = useState<CallRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

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
    return <div className="skeleton" style={{ height: 240, marginTop: 24 }} />;
  }
  if (!call) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>Call not found</div>
        <Link href="/calls" style={{ color: "var(--gold-2)", fontSize: 13 }}>← Back to calls</Link>
      </div>
    );
  }

  const copyPhone = () => {
    if (!call.lead_phone) return;
    navigator.clipboard.writeText(call.lead_phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const projectName = humanize(call.project || analysis.project_interest);
  const turns = call.transcript?.length ?? 0;
  const visitBooked = analysis.site_visit_booked === true;
  const scoreNum = call.lead_score ?? 0;
  const scoreColor = scoreNum >= 80 ? "#7dc77d" : scoreNum >= 60 ? "#c9a85a" : "#c97d7d";

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <Link href="/calls" style={{ fontSize: 12, color: "var(--muted)", textDecoration: "none", display: "inline-block", marginBottom: 18 }}>
        ← Back to calls
      </Link>

      {/* ── Hero ──────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 10 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: -0.4 }}>
            {call.lead_name ? humanize(call.lead_name) : "Unknown caller"}
          </h1>
          <ScoreBadge score={call.lead_score} />
          {visitBooked && (
            <span style={{
              fontSize: 11, padding: "4px 10px", borderRadius: 999,
              background: "rgba(125, 199, 125, 0.12)", color: "#7dc77d",
              border: "1px solid rgba(125, 199, 125, 0.3)", fontWeight: 500,
            }}>
              ✓ Site visit booked
            </span>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span>{timeAgo(call.created_at)}</span>
          <span>·</span>
          <span>{fmtDuration(call.duration_seconds ?? 0)} call</span>
          <span>·</span>
          <span style={{ textTransform: "capitalize" }}>{call.source ?? "voice"}</span>
          {call.outcome && (
            <>
              <span>·</span>
              <span style={{ textTransform: "capitalize" }}>{call.outcome}</span>
            </>
          )}
        </div>
      </div>

      {/* ── KPI Strip ─────────────────────────────────────── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: 10,
        marginBottom: 30,
      }}>
        <KpiTile
          label="Lead Score"
          value={scoreNum > 0 ? scoreNum : "—"}
          sub={call.score_label ? call.score_label.toUpperCase() : "Unscored"}
          accent={scoreColor}
          icon="◆"
        />
        <KpiTile
          label="Call Duration"
          value={fmtDuration(call.duration_seconds ?? 0)}
          sub={`${turns} exchange${turns === 1 ? "" : "s"}`}
          accent="#c9a85a"
          icon="◷"
        />
        <KpiTile
          label="Sentiment"
          value={
            <span style={{ color: sentiment.color }}>
              {sentiment.emoji} {sentiment.label}
            </span>
          }
          sub={
            sentiment.pos + sentiment.neg > 0
              ? `${sentiment.pos} positive · ${sentiment.neg} negative cues`
              : "No clear signal"
          }
          accent={sentiment.color}
          icon="❤"
        />
        <KpiTile
          label="Outcome"
          value={visitBooked ? "Visit Booked" : humanize(analysis.classification || call.outcome || "—")}
          sub={visitBooked ? "Ready for site visit" : humanize(analysis.next_action) || "—"}
          accent={visitBooked ? "#7dc77d" : "#9d8a4f"}
          icon={visitBooked ? "✓" : "→"}
        />
      </div>

      {/* ── Lead Contact ──────────────────────────────────── */}
      <Section title="Lead Contact">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
          <div className="panel" style={{ padding: "14px 16px", position: "relative", overflow: "hidden" }}>
            <div style={{
              position: "absolute", left: 0, top: 0, bottom: 0, width: 2,
              background: "#c9a85a", opacity: 0.6,
            }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#c9a85a" }}>☎</span>
              <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.9, fontWeight: 600 }}>Phone</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <a href={`tel:${call.lead_phone ?? ""}`} style={{
                fontSize: 15, color: "var(--text)", fontWeight: 500, textDecoration: "none",
                fontFamily: "var(--font-mono, ui-monospace, monospace)", letterSpacing: 0.3,
              }}>
                {fmtPhoneFull(call.lead_phone)}
              </a>
              <button onClick={copyPhone} style={{
                fontSize: 10.5, padding: "4px 9px", borderRadius: 5, cursor: "pointer",
                background: "var(--bg-2)", border: "1px solid var(--line)", color: "var(--text-2)",
              }}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
          <StatTile label="Project Interest" value={projectName} accent="#c9a85a" icon="◈" />
          <StatTile label="Language" value={humanizeLang(call.language || analysis.language_spoken)} accent="#7a9ac7" icon="✦" />
        </div>
      </Section>

      {/* ── Recording ─────────────────────────────────────── */}
      {analysis.recording_url && (
        <Section title="Recording">
          <div className="panel" style={{
            padding: "18px 20px",
            background: "linear-gradient(135deg, rgba(201,168,90,0.05), rgba(201,168,90,0.01))",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: "rgba(201,168,90,0.12)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#c9a85a", fontSize: 14,
              }}>
                ▶
              </div>
              <div>
                <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>Call audio</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{fmtDuration(call.duration_seconds ?? 0)} · Ringg recording</div>
              </div>
            </div>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio controls src={analysis.recording_url} style={{ width: "100%" }} />
          </div>
        </Section>
      )}

      {/* ── AI Summary ────────────────────────────────────── */}
      {(call.summary || analysis.platform_summary) && (
        <Section title="AI Summary">
          <div className="panel" style={{
            padding: "20px 24px",
            background: "linear-gradient(135deg, rgba(201,168,90,0.05), rgba(201,168,90,0.01))",
            position: "relative",
            overflow: "hidden",
          }}>
            <div style={{
              position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
              background: "#c9a85a", opacity: 0.5,
            }} />
            <div style={{ fontSize: 14.5, lineHeight: 1.75, color: "var(--text)", paddingLeft: 6 }}>
              {call.summary || analysis.platform_summary}
            </div>
          </div>
        </Section>
      )}

      {/* ── Qualification ─────────────────────────────────── */}
      <Section title="Qualification">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          <StatTile label="Intent" value={humanize(analysis.intent)} accent="#7a9ac7" icon="◎" />
          <StatTile label="Budget" value={humanizeBudget(analysis.budget_range)} accent="#c9a85a" icon="₹" />
          <StatTile label="Timeline" value={humanizeTimeline(analysis.timeline)} accent="#b07ac7" icon="⏱" />
          <StatTile label="Next Action" value={humanize(analysis.next_action)} accent="#7dc77d" icon="→" />
          {analysis.classification && (
            <StatTile label="Classification" value={humanize(analysis.classification)} accent="#c9a85a" icon="◈" />
          )}
        </div>
      </Section>

      {/* ── Sentiment Detail ──────────────────────────────── */}
      {(sentiment.pos > 0 || sentiment.neg > 0) && (
        <Section title="Sentiment Breakdown">
          <div className="panel" style={{ padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontSize: 13, color: "var(--text-2)" }}>
                <span style={{ color: sentiment.color, fontWeight: 600 }}>{sentiment.label}</span>
                <span style={{ color: "var(--muted)", marginLeft: 8 }}>
                  · {sentiment.pos} positive cues · {sentiment.neg} negative cues
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                {Math.round(sentiment.ratio * 100)}% positive
              </div>
            </div>
            <div style={{
              height: 6, borderRadius: 999, overflow: "hidden",
              background: "rgba(201,125,125,0.18)",
              position: "relative",
            }}>
              <div style={{
                position: "absolute", left: 0, top: 0, bottom: 0,
                width: `${sentiment.ratio * 100}%`,
                background: "rgba(125,199,125,0.7)",
                transition: "width 0.4s ease",
              }} />
            </div>
          </div>
        </Section>
      )}

      {/* ── Key Signals ───────────────────────────────────── */}
      {Array.isArray(analysis.key_points) && analysis.key_points.length > 0 && (
        <Section title="Key Signals">
          <div className="panel" style={{ padding: "18px 22px" }}>
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {analysis.key_points.map((p, i) => (
                <li key={i} style={{
                  fontSize: 13.5, lineHeight: 1.65, color: "var(--text-2)",
                  paddingLeft: 22, position: "relative",
                  marginBottom: i === analysis.key_points!.length - 1 ? 0 : 12,
                }}>
                  <span style={{
                    position: "absolute", left: 0, top: 7,
                    width: 6, height: 6, borderRadius: "50%",
                    background: "#c9a85a", opacity: 0.9,
                  }} />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </Section>
      )}

      {/* ── Action Items ──────────────────────────────────── */}
      {Array.isArray(analysis.action_items) && analysis.action_items.length > 0 && (
        <Section title="Action Items">
          <div className="panel" style={{ padding: "18px 22px" }}>
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {analysis.action_items.map((p, i) => (
                <li key={i} style={{
                  fontSize: 13.5, lineHeight: 1.65, color: "var(--text-2)",
                  paddingLeft: 26, position: "relative",
                  marginBottom: i === analysis.action_items!.length - 1 ? 0 : 12,
                }}>
                  <span style={{
                    position: "absolute", left: 0, top: 3, width: 16, height: 16,
                    borderRadius: 4, border: "1.5px solid var(--gold-dim)",
                    display: "inline-block",
                    background: "rgba(201,168,90,0.05)",
                  }} />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </Section>
      )}

      {/* ── Transcript ────────────────────────────────────── */}
      {call.transcript && call.transcript.length > 0 && (
        <Section
          title="Conversation"
          action={
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              {turns} message{turns === 1 ? "" : "s"}
            </div>
          }
        >
          <div className="panel" style={{ padding: "22px 24px" }}>
            {call.transcript.map((t, i) => {
              const isAgent = t.side === "agent" || /agent|bot|assistant/i.test(t.speaker);
              return (
                <div key={i} style={{
                  display: "flex", gap: 14,
                  marginBottom: i === call.transcript!.length - 1 ? 0 : 18,
                  flexDirection: isAgent ? "row" : "row-reverse",
                }}>
                  <div style={{
                    flexShrink: 0, width: 32, height: 32, borderRadius: "50%",
                    background: isAgent ? "var(--gold-soft)" : "var(--bg-2)",
                    border: `1px solid ${isAgent ? "var(--gold-dim)" : "var(--line)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 600,
                    color: isAgent ? "var(--gold-2)" : "var(--text-2)",
                  }}>
                    {isAgent ? "AI" : "U"}
                  </div>
                  <div style={{
                    maxWidth: "80%", padding: "10px 14px", borderRadius: 10,
                    background: isAgent ? "rgba(201,168,90,0.06)" : "var(--bg-2)",
                    border: `1px solid ${isAgent ? "rgba(201,168,90,0.15)" : "var(--line)"}`,
                  }}>
                    <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text)" }}>
                      {t.text}
                    </div>
                    {t.time && (
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 5, letterSpacing: 0.3 }}>
                        {new Date(t.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
