"use client";

import { useMemo, useState } from "react";
import { useLiveData, useAutoRefresh, isMissedCall, type CallRow } from "@/lib/data";
import { PageHeader } from "@/components/PageHeader";
import { CallCard } from "@/components/CallCard";
import { MissedCallCard } from "@/components/MissedCallCard";
import { EmptyState } from "@/components/EmptyState";

const FILTERS = ["All", "Hot", "Warm", "Cold"] as const;
type Filter = typeof FILTERS[number];
type View = "connected" | "insightful" | "booked" | "missed";

export default function CallsPage() {
  const { calls, loading } = useLiveData();
  const [view, setView] = useState<View>("connected");
  const [filter, setFilter] = useState<Filter>("All");
  const [search, setSearch] = useState("");
  // Booking truth lives in the site_visits table (written by the ElevenLabs
  // webhook straight from the cal.com result). analysis.site_visit_booked is
  // only set by the enrich route and is absent on every real booked call, so
  // keying the tab off that flag showed an empty list.
  const [bookedCallIds, setBookedCallIds] = useState<Set<string>>(new Set());
  // Booked calls that fall outside the 500-row list window are fetched by id so
  // the tab shows every booking, not just the recent ones.
  const [extraBooked, setExtraBooked] = useState<CallRow[]>([]);

  // No client-side enrichment. The browser used to fire /api/calls/enrich for
  // any call missing the deep analysis, which meant an un-enriched backlog
  // retried forever on every 10s poll — the "AI analysing…" banner never
  // cleared, and a dead API key turned it into an endless 500 loop.
  // Enrichment is now a server job: /api/calls/enrich/backfill, on a cron.

  useAutoRefresh(async () => {
    try {
      const res = await fetch("/api/site-visits");
      if (!res.ok) return;
      const rows = (await res.json()) as { call_id: string | null }[];
      if (!Array.isArray(rows)) return;
      const ids = rows.map((r) => r.call_id).filter((v): v is string => Boolean(v));
      setBookedCallIds(new Set(ids));
      if (ids.length) {
        const cRes = await fetch(`/api/calls?ids=${encodeURIComponent(ids.join(","))}`, { cache: "no-store" });
        if (cRes.ok) {
          const cJson = await cRes.json().catch(() => ({}));
          setExtraBooked((cJson.calls as CallRow[]) ?? []);
        }
      }
    } catch {
      /* keep the last known set */
    }
  }, 30000);

  // Connected conversations vs. calls that never connected (not picked up).
  const connected = useMemo(() => calls.filter((c) => !isMissedCall(c)), [calls]);
  const missed = useMemo(() => calls.filter((c) => isMissedCall(c)), [calls]);

  // Conversations that ran past a minute AND actually completed — a call the
  // platform tagged `failure` (quota exceeded, LLM timeout) can still burn 90
  // seconds of dead air and carries no signal, so it's excluded.
  const insightful = useMemo(
    () =>
      connected.filter((c) => {
        if ((c.duration_seconds ?? 0) <= 60) return false;
        const status = (c.analysis ?? {} as Record<string, unknown>).call_successful;
        if (status === "failure") return false;
        return String(c.outcome ?? "").toLowerCase() !== "failure";
      }),
    [connected],
  );
  // Calls where the agent actually closed a site visit — a row in site_visits,
  // or (legacy/enriched calls) the analysis flag.
  const booked = useMemo(() => {
    const inWindow = connected.filter(
      (c) =>
        bookedCallIds.has(String(c.call_id ?? c.id)) ||
        ((c.analysis ?? {}) as Record<string, unknown>).site_visit_booked === true,
    );
    const seen = new Set(inWindow.map((c) => c.id));
    const merged = [...inWindow, ...extraBooked.filter((c) => !seen.has(c.id))];
    return merged.sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    );
  }, [connected, bookedCallIds, extraBooked]);

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

  const base = view === "insightful" ? insightful : view === "booked" ? booked : connected;

  const filtered = useMemo(() => {
    return base.filter((c) => {
      const score = c.lead_score ?? 0;
      if (filter === "Hot" && score < 80) return false;
      if (filter === "Warm" && (score < 60 || score >= 80)) return false;
      if (filter === "Cold" && score >= 60) return false;
      return matchesSearch(c);
    });
  }, [base, filter, search]);

  const filteredMissed = useMemo(() => missed.filter(matchesSearch), [missed, search]);

  return (
    <>
      <PageHeader
        title="Voice Calls"
        subtitle={
          view === "missed"
            ? `${missed.length} ${missed.length === 1 ? "call" : "calls"} that never became a conversation — voicemail, no answer, or a platform error`
            : view === "insightful"
            ? `${insightful.length} ${insightful.length === 1 ? "conversation" : "conversations"} that ran longer than a minute`
            : view === "booked"
            ? `${booked.length} ${booked.length === 1 ? "call" : "calls"} where the lead booked a site visit`
            : `${connected.length} ${connected.length === 1 ? "call" : "calls"} · click any card to expand the transcript`
        }
      />

      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
          {/* Connected vs. not-picked-up — keeps missed calls out of the main list */}
          <div style={{ display: "inline-flex", gap: 3, background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 9, padding: 3 }}>
            {([["connected", "Calls", connected.length], ["insightful", "Insightful conversations", insightful.length], ["booked", "Site visits booked", booked.length], ["missed", "Not picked up", missed.length]] as const).map(([key, label, n]) => (
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
          {view !== "missed" && (
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
                hint={missed.length === 0 ? "Calls that hit voicemail, went unanswered, or failed on the platform side will appear here." : "Try a different search."}
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {filteredMissed.map((c) => <MissedCallCard key={c.id} call={c} />)}
              </div>
            )
          ) : filtered.length === 0 ? (
            <EmptyState
              title={
                base.length === 0
                  ? view === "insightful"
                    ? "No conversations over a minute yet"
                    : view === "booked"
                    ? "No site visits booked yet"
                    : "No calls yet"
                  : "No calls match your filter"
              }
              hint={
                base.length === 0
                  ? view === "insightful"
                    ? "Calls that run longer than 60 seconds will appear here."
                    : view === "booked"
                    ? "Calls where the agent locks in a site visit will appear here."
                    : "Place a test call through the ElevenLabs voice agent to see it appear here."
                  : "Try removing the filter or adjusting your search."
              }
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
