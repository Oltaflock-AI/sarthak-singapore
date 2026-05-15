"use client";

import { useMemo, useState } from "react";
import { useLiveData } from "@/lib/data";
import { PageHeader } from "@/components/PageHeader";
import { CallCard } from "@/components/CallCard";
import { EmptyState } from "@/components/EmptyState";

const FILTERS = ["All", "Hot", "Warm", "Cold"] as const;
type Filter = typeof FILTERS[number];

export default function CallsPage() {
  const { calls, loading } = useLiveData();
  const [filter, setFilter] = useState<Filter>("All");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return calls.filter((c) => {
      const score = c.lead_score ?? 0;
      if (filter === "Hot" && score < 80) return false;
      if (filter === "Warm" && (score < 60 || score >= 80)) return false;
      if (filter === "Cold" && score >= 60) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          c.lead_name?.toLowerCase().includes(q) ||
          c.lead_phone?.toLowerCase().includes(q) ||
          c.project?.toLowerCase().includes(q) ||
          c.outcome?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [calls, filter, search]);

  return (
    <>
      <PageHeader
        title="Voice Calls"
        subtitle={`${calls.length} ${calls.length === 1 ? "call" : "calls"} total · click any card to expand the transcript`}
      />

      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
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
              minWidth: 280,
              outline: "none",
              flex: 1,
              maxWidth: 400,
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--gold-dim)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--line)")}
          />
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
        </div>

        <div className="panel-body">
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[0,1,2,3].map((i) => <div key={i} className="skeleton" style={{ height: 90 }} />)}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              title={calls.length === 0 ? "No calls yet" : "No calls match your filter"}
              hint={calls.length === 0 ? "Trigger a test call from Ringg.ai to see it appear here." : "Try removing the filter or adjusting your search."}
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
