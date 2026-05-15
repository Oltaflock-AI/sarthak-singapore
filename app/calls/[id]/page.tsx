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

// ── UI bits ────────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{
        fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase",
        letterSpacing: 1.2, fontWeight: 600, marginBottom: 10, paddingLeft: 2,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function StatCell({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="panel" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 14, color: accent ?? "var(--text)", marginTop: 6, fontWeight: 500, lineHeight: 1.35 }}>{value}</div>
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

  return (
    <div style={{ maxWidth: 920, margin: "0 auto" }}>
      <Link href="/calls" style={{ fontSize: 12, color: "var(--muted)", textDecoration: "none", display: "inline-block", marginBottom: 18 }}>
        ← Back to calls
      </Link>

      {/* ── Hero ──────────────────────────────────────────── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 10 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>
            {call.lead_name ? humanize(call.lead_name) : "Unknown caller"}
          </h1>
          <ScoreBadge score={call.lead_score} />
          {analysis.site_visit_booked === true && (
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

      {/* ── Lead Contact ──────────────────────────────────── */}
      <Section title="Lead Contact">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <div className="panel" style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.8 }}>Phone</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
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
          <StatCell label="Project Interest" value={projectName} />
          <StatCell label="Language" value={humanizeLang(call.language || analysis.language_spoken)} />
        </div>
      </Section>

      {/* ── Recording ─────────────────────────────────────── */}
      {analysis.recording_url && (
        <Section title="Recording">
          <div className="panel" style={{ padding: "16px 18px" }}>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio controls src={analysis.recording_url} style={{ width: "100%" }} />
          </div>
        </Section>
      )}

      {/* ── AI Summary ────────────────────────────────────── */}
      {(call.summary || analysis.platform_summary) && (
        <Section title="AI Summary">
          <div className="panel" style={{ padding: "18px 22px", background: "linear-gradient(135deg, rgba(201,168,90,0.04), rgba(201,168,90,0.01))" }}>
            <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text)" }}>
              {call.summary || analysis.platform_summary}
            </div>
          </div>
        </Section>
      )}

      {/* ── Qualification ─────────────────────────────────── */}
      <Section title="Qualification">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <StatCell label="Intent" value={humanize(analysis.intent)} />
          <StatCell label="Budget" value={humanizeBudget(analysis.budget_range)} accent="var(--gold-2)" />
          <StatCell label="Timeline" value={humanizeTimeline(analysis.timeline)} />
          <StatCell label="Next Action" value={humanize(analysis.next_action)} />
          <StatCell
            label="Sentiment"
            value={
              <span style={{ color: sentiment.color, fontWeight: 600 }}>
                <span style={{ marginRight: 6 }}>{sentiment.emoji}</span>{sentiment.label}
                {(sentiment.pos > 0 || sentiment.neg > 0) && (
                  <span style={{ fontSize: 10.5, color: "var(--muted)", marginLeft: 8, fontWeight: 400 }}>
                    +{sentiment.pos} / -{sentiment.neg}
                  </span>
                )}
              </span>
            }
          />
          {analysis.classification && <StatCell label="Classification" value={humanize(analysis.classification)} />}
        </div>
      </Section>

      {/* ── Key Signals ───────────────────────────────────── */}
      {Array.isArray(analysis.key_points) && analysis.key_points.length > 0 && (
        <Section title="Key Signals">
          <div className="panel" style={{ padding: "18px 22px" }}>
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {analysis.key_points.map((p, i) => (
                <li key={i} style={{
                  fontSize: 13.5, lineHeight: 1.65, color: "var(--text-2)",
                  paddingLeft: 18, position: "relative",
                  marginBottom: i === analysis.key_points!.length - 1 ? 0 : 10,
                }}>
                  <span style={{ position: "absolute", left: 0, top: 0, color: "var(--gold-2)" }}>→</span>
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
                  paddingLeft: 22, position: "relative",
                  marginBottom: i === analysis.action_items!.length - 1 ? 0 : 12,
                }}>
                  <span style={{
                    position: "absolute", left: 0, top: 4, width: 14, height: 14,
                    borderRadius: 3, border: "1.5px solid var(--gold-dim)",
                    display: "inline-block",
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
        <Section title="Conversation">
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
