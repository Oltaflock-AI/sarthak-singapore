"use client";

import { useEffect, useState } from "react";

// All reads go through gated server routes (/api/calls), which use the service
// key behind the password proxy. The client no longer talks to Supabase with
// the public anon key — that exposed every row to anyone with the bundle.

export interface CallRow {
  id: string;
  call_id: string | null;
  lead_name: string | null;
  lead_phone: string | null;
  project: string | null;
  source: string | null;
  lead_score: number | null;
  score_label: string | null;
  duration_seconds: number | null;
  outcome: string | null;
  summary: string | null;
  language: string | null;
  analysis: Record<string, unknown> | null;
  transcript: { speaker: string; time: string; text: string; side: string }[] | null;
  created_at: string;
}

// ── Shared live-data hook (polls every 10s) ─────────────────────────────────
export function useLiveData() {
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<Date>(new Date());

  const refetch = async () => {
    try {
      const res = await fetch("/api/calls", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      setCalls((json.calls as CallRow[]) ?? []);
    } catch {
      /* leave previous data on transient failure */
    }
    setLastSync(new Date());
    setLoading(false);
  };

  useEffect(() => {
    refetch();
    const id = setInterval(refetch, 10000);
    return () => clearInterval(id);
  }, []);

  return { calls, loading, lastSync, refetch };
}

// ── One-off reads (gated /api/calls) ────────────────────────────────────────
export async function fetchCall(id: string): Promise<CallRow | null> {
  const res = await fetch(`/api/calls?id=${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json().catch(() => ({}));
  return (json.call as CallRow) ?? null;
}

export async function fetchCallsByPhone(phone: string): Promise<CallRow[]> {
  const res = await fetch(`/api/calls?phone=${encodeURIComponent(phone)}`, { cache: "no-store" });
  if (!res.ok) return [];
  const json = await res.json().catch(() => ({}));
  return (json.calls as CallRow[]) ?? [];
}

// ── Derived stats helpers ───────────────────────────────────────────────────
export function bucketByScore(calls: CallRow[]) {
  const hot: CallRow[] = [];
  const warm: CallRow[] = [];
  const cold: CallRow[] = [];
  for (const c of calls) {
    const s = c.lead_score ?? 0;
    if (s >= 80) hot.push(c);
    else if (s >= 60) warm.push(c);
    else cold.push(c);
  }
  return { hot, warm, cold };
}

export function groupByProject(calls: CallRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of calls) {
    const k = (c.project ?? "Unassigned").split("·")[0].trim();
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export function groupBySource(calls: CallRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of calls) {
    const k = c.source ?? "Direct";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}
