"use client";

import { useState, useMemo, useEffect } from "react";
import { useLiveData, WaRow } from "@/lib/data";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { timeAgo, initials } from "@/lib/format";

export default function WhatsAppPage() {
  const { waMessages, loading } = useLiveData();
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);

  // Group messages by from_number to make distinct conversations
  const conversations = useMemo(() => {
    const map = new Map<string, { number: string; name: string; messages: WaRow[]; lastAt: string }>();
    for (const m of waMessages) {
      const key = m.from_number ?? m.id;
      const existing = map.get(key);
      if (existing) {
        existing.messages.push(m);
        if (new Date(m.created_at) > new Date(existing.lastAt)) existing.lastAt = m.created_at;
      } else {
        map.set(key, { number: key, name: m.name ?? m.from_number ?? "Unknown", messages: [m], lastAt: m.created_at });
      }
    }
    return Array.from(map.values()).sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  }, [waMessages]);

  // Auto-select the most recent conversation on first load
  useEffect(() => {
    if (!selectedNumber && conversations.length > 0) setSelectedNumber(conversations[0].number);
  }, [conversations, selectedNumber]);

  const selected = conversations.find((c) => c.number === selectedNumber);

  return (
    <>
      <PageHeader
        title="WhatsApp"
        subtitle={`${conversations.length} ${conversations.length === 1 ? "conversation" : "conversations"} · Priya replies via GPT-4.1-mini`}
      />

      <div className="panel" style={{ overflow: "hidden", height: "calc(100vh - 200px)", minHeight: 480, display: "grid", gridTemplateColumns: "320px 1fr" }}>
        {/* Left pane — conversation list */}
        <div style={{ borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", fontSize: 11, color: "var(--muted)", letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600 }}>
            Inbox
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {loading ? (
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                {[0,1,2,3,4].map((i) => <div key={i} className="skeleton" style={{ height: 56 }} />)}
              </div>
            ) : conversations.length === 0 ? (
              <EmptyState title="No conversations" hint="Send a WhatsApp message to +1 814 404 5578 to start." />
            ) : (
              conversations.map((c) => (
                <button
                  key={c.number}
                  onClick={() => setSelectedNumber(c.number)}
                  style={{
                    width: "100%",
                    display: "grid",
                    gridTemplateColumns: "36px 1fr auto",
                    gap: 12,
                    padding: "12px 16px",
                    border: "none",
                    background: selectedNumber === c.number ? "var(--panel-2)" : "transparent",
                    borderLeft: selectedNumber === c.number ? "2px solid var(--gold)" : "2px solid transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    alignItems: "center",
                    transition: "background 0.12s",
                  }}
                  onMouseEnter={(e) => { if (selectedNumber !== c.number) e.currentTarget.style.background = "var(--bg-2)"; }}
                  onMouseLeave={(e) => { if (selectedNumber !== c.number) e.currentTarget.style.background = "transparent"; }}
                >
                  <div className="avatar sm">{initials(c.name)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{c.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.messages[0]?.text_in ?? c.messages[0]?.text_out ?? "—"}
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap" }} className="num">{timeAgo(c.lastAt)}</div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right pane — thread */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "var(--bg-2)" }}>
          {selected ? (
            <>
              <div style={{ padding: "16px 22px", borderBottom: "1px solid var(--line)", background: "var(--panel)", display: "flex", alignItems: "center", gap: 12 }}>
                <div className="avatar">{initials(selected.name)}</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{selected.name}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }} className="num">{selected.number}</div>
                </div>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
                {selected.messages.slice().reverse().map((m) => (
                  <div key={m.id} className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {m.text_in && <Bubble side="in" text={m.text_in} time={m.created_at} />}
                    {m.text_out && <Bubble side="out" text={m.text_out} time={m.created_at} />}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ display: "grid", placeItems: "center", flex: 1, color: "var(--muted)", fontSize: 13 }}>
              Select a conversation
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Bubble({ side, text, time }: { side: "in" | "out"; text: string; time: string }) {
  const isOut = side === "out";
  return (
    <div style={{ display: "flex", justifyContent: isOut ? "flex-end" : "flex-start" }}>
      <div style={{ maxWidth: "70%", display: "flex", flexDirection: "column", gap: 4 }}>
        {isOut && <div style={{ fontSize: 9.5, color: "var(--gold-dim)", letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600 }}>Priya (AI)</div>}
        <div style={{
          padding: "10px 14px",
          borderRadius: 12,
          fontSize: 13,
          lineHeight: 1.5,
          background: isOut ? "var(--gold-soft-2)" : "var(--panel)",
          color: isOut ? "var(--text)" : "var(--text-2)",
          border: `1px solid ${isOut ? "var(--gold-dim)" : "var(--line)"}`,
          borderBottomRightRadius: isOut ? 4 : 12,
          borderBottomLeftRadius: isOut ? 12 : 4,
          whiteSpace: "pre-wrap",
        }}>{text}</div>
        <div style={{ fontSize: 10, color: "var(--muted)", textAlign: isOut ? "right" : "left" }} className="num">{timeAgo(time)}</div>
      </div>
    </div>
  );
}
