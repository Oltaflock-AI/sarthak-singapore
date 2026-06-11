"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveData, isMissedCall } from "@/lib/data";
import { PageHeader } from "@/components/PageHeader";
import { CallCard } from "@/components/CallCard";
import { MissedCallCard } from "@/components/MissedCallCard";
import { EmptyState } from "@/components/EmptyState";

const FILTERS = ["All", "Hot", "Warm", "Cold"] as const;
type Filter = typeof FILTERS[number];
type View = "connected" | "missed";

export default function CallsPage() {
  const { calls, loading } = useLiveData();
  const [view, setView] = useState<View>("connected");
  const [filter, setFilter] = useState<Filter>("All");
  const [search, setSearch] = useState("");
  const [enriching, setEnriching] = useState<Set<string>>(new Set());
  const enrichedRef = useRef<Set<string>>(new Set());

  // Auto-enrich when a call lacks a score OR lacks the deep sentiment/motivation
  // blob. Ringg sets a heuristic lead_score, so the score-null check alone never
  // fires for real calls — gate on missing analysis.sentiment too.
  useEffect(() => {
    for (const c of calls) {
      const an = (c.analysis ?? {}) as Record<string, unknown>;
      const needsDeep = !an.sentiment || !an.motivation;
      if (
        (c.lead_score == null || needsDeep) &&
        Array.isArray(c.transcript) &&
        c.transcript.length > 0 &&
        !enrichedRef.current.has(c.id)
      ) {
        enrichedRef.current.add(c.id);
        setEnriching((s) => new Set(s).add(c.id));
        fetch("/api/calls/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: c.id }),
        })
          .catch(() => {})
          .finally(() => {
            setEnriching((s) => {
              const next = new Set(s);
              next.delete(c.id);
              return next;
            });
          });
      }
    }
  }, [calls]);

  // Connected conversations vs. calls that never connected (not picked up).
  const connected = useMemo(() => calls.filter((c) => !isMissedCall(c)), [calls]);
  const missed = useMemo(() => calls.filter((c) => isMissedCall(c)), [calls]);

  const matchesSearch = (c: (typeof calls)[number]) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return Boolean(
      c.lead_name?.toLowerCase().includes(q) ||
        c.lead_phone?.toLowerCase().includes(q) ||
        c.project?.toLowerCase().includes(q) ||
        c.outcome?.toLowerCase().includes(q),
    );
  };

  const filtered = useMemo(() => {
    return connected.filter((c) => {
      const score = c.lead_score ?? 0;
      if (filter === "Hot" && score < 80) return false;
      if (filter === "Warm" && (score < 60 || score >= 80)) return false;
      if (filter === "Cold" && score >= 60) return false;
      return matchesSearch(c);
    });
  }, [connected, filter, search]);

  const filteredMissed = useMemo(() => missed.filter(matchesSearch), [missed, search]);

  return (
    <>
      <PageHeader
        title="Voice Calls"
        subtitle={
          view === "connected"
            ? `${connected.length} ${connected.length === 1 ? "call" : "calls"} · click any card to expand the transcript`
            : `${missed.length} ${missed.length === 1 ? "call" : "calls"} that didn't connect (busy, no answer, or rejected)`
        }
      />

      {enriching.size > 0 && (
        <div style={{ marginBottom: 14, padding: "10px 16px", background: "var(--gold-soft)", border: "1px solid var(--gold-dim)", borderRadius: 6, fontSize: 12, color: "var(--gold-2)", display: "flex", alignItems: "center", gap: 10 }}>
          <span className="pulse-dot" style={{ width: 8, height: 8, borderRadius: 8, background: "var(--gold)", animation: "pulse 1s ease-in-out infinite" }} />
          AI analysing {enriching.size} {enriching.size === 1 ? "call" : "calls"}… score, summary, project will populate within a few seconds.
        </div>
      )}

      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
          {/* Connected vs. not-picked-up — keeps missed calls out of the main list */}
          <div style={{ display: "inline-flex", gap: 3, background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 9, padding: 3 }}>
            {([["connected", "Calls", connected.length], ["missed", "Not picked up", missed.length]] as const).map(([key, label, n]) => (
              <button
                key={key}
                onClick={() => setView(key)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  border: "none",
                  background: view === key ? "var(--panel)" : "transparent",
                  color: view === key ? "var(--text)" : "var(--muted)",
                  boxShadow: view === key ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                  transition: "all 0.15s",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                }}
              >
                {label}
                <span className="num" style={{ fontSize: 11, opacity: 0.65 }}>{n}</span>
              </button>
            ))}
          </div>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, project…"
            style={{
              background: "var(--bg-2)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: "8px 12px",
              color: "var(--text)",
              fontSize: 13,
              minWidth: 240,
              outline: "none",
              flex: 1,
              maxWidth: 400,
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--gold-dim)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--line)")}
          />
          {view === "connected" && (
            <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
              {FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 7,
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                    border: "1px solid",
                    background: filter === f ? "var(--gold-soft)" : "var(--bg-2)",
                    color: filter === f ? "var(--gold-2)" : "var(--muted)",
                    borderColor: filter === f ? "var(--gold-dim)" : "var(--line)",
                    transition: "all 0.15s",
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="panel-body">
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[0,1,2,3].map((i) => <div key={i} className="skeleton" style={{ height: 90 }} />)}
            </div>
          ) : view === "missed" ? (
            filteredMissed.length === 0 ? (
              <EmptyState
                title={missed.length === 0 ? "No missed calls" : "No missed calls match your search"}
                hint={missed.length === 0 ? "Calls that don't connect (busy, no answer, or rejected) will appear here." : "Try a different search."}
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {filteredMissed.map((c) => <MissedCallCard key={c.id} call={c} />)}
              </div>
            )
          ) : filtered.length === 0 ? (
            <EmptyState
              title={connected.length === 0 ? "No calls yet" : "No calls match your filter"}
              hint={connected.length === 0 ? "Place a test call through the ElevenLabs voice agent to see it appear here." : "Try removing the filter or adjusting your search."}
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filtered.map((c) => <CallCard key={c.id} call={c} />)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
