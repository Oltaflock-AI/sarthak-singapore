"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { timeAgo, initials } from "@/lib/format";

type SiteVisit = {
  id: string;
  lead_phone: string;
  lead_name: string | null;
  project: string | null;
  scheduled_for: string | null;
  scheduled_for_text: string | null;
  status: string;
  notes: string | null;
  created_at: string;
};

const STATUSES = ["pending", "confirmed", "done", "cancelled"] as const;

export default function SiteVisitsPage() {
  const [visits, setVisits] = useState<SiteVisit[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const res = await fetch("/api/site-visits", { cache: "no-store" });
    const data = await res.json();
    if (Array.isArray(data)) setVisits(data);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, []);

  async function updateStatus(id: string, status: string) {
    await fetch("/api/site-visits", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    refresh();
  }

  const pending = visits.filter((v) => v.status === "pending");
  const confirmed = visits.filter((v) => v.status === "confirmed");
  const done = visits.filter((v) => v.status === "done");

  return (
    <>
      <PageHeader
        title="Site Visits"
        subtitle={`${visits.length} bookings · ${pending.length} pending · ${confirmed.length} confirmed`}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 18 }}>
        <Stat label="Pending" value={pending.length} color="var(--warm)" />
        <Stat label="Confirmed" value={confirmed.length} color="var(--gold)" />
        <Stat label="Done" value={done.length} color="var(--cold)" />
      </div>

      <div className="panel" style={{ overflow: "hidden" }}>
        {loading && visits.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Loading…</div>
        ) : visits.length === 0 ? (
          <EmptyState title="No site visits yet" hint="Visits booked on voice calls will appear here" />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--line)", background: "var(--bg-2)" }}>
                <Th>Lead</Th>
                <Th>Phone</Th>
                <Th>Project</Th>
                <Th>When</Th>
                <Th>Status</Th>
                <Th>Booked</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {visits.map((v) => (
                <tr key={v.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <Td>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div className="avatar">{initials(v.lead_name ?? v.lead_phone)}</div>
                      <div style={{ fontWeight: 600 }}>{v.lead_name ?? "—"}</div>
                    </div>
                  </Td>
                  <Td><span className="num" style={{ fontSize: 12 }}>{v.lead_phone}</span></Td>
                  <Td>{v.project ?? "—"}</Td>
                  <Td>{v.scheduled_for_text ?? (v.scheduled_for ? new Date(v.scheduled_for).toLocaleString() : "—")}</Td>
                  <Td><StatusPill status={v.status} /></Td>
                  <Td><span style={{ fontSize: 11, color: "var(--muted)" }}>{timeAgo(v.created_at)}</span></Td>
                  <Td>
                    <select
                      aria-label="Status"
                      value={v.status}
                      onChange={(e) => updateStatus(v.id, e.target.value)}
                      style={{ padding: "4px 8px", background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 4, color: "var(--text)", fontSize: 11.5 }}
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="panel" style={{ padding: "16px 20px" }}>
      <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>{label}</div>
      <div className="num" style={{ fontSize: 24, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600 }}>{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "12px 16px", fontSize: 12.5 }}>{children}</td>;
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === "confirmed" ? "var(--gold)" :
    status === "done" ? "var(--cold)" :
    status === "cancelled" ? "var(--hot)" :
    "var(--warm)";
  return (
    <span style={{ display: "inline-block", padding: "3px 10px", fontSize: 10.5, fontWeight: 600, color, border: `1px solid ${color}`, borderRadius: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>
      {status}
    </span>
  );
}
