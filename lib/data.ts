"use client";

import { useEffect, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DASHBOARD_SINCE } from "./config";

// Anon client (client-side live polling). Created lazily so importing this
// module never throws when the NEXT_PUBLIC_* vars are empty at build time
// (e.g. /_not-found prerender); it is only instantiated on first real use.
let _anon: SupabaseClient | null = null;
function getAnon(): SupabaseClient {
  if (!_anon) {
    _anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
    );
  }
  return _anon;
}
export const supabase = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    const c = getAnon();
    const v = c[prop as keyof SupabaseClient];
    return typeof v === "function" ? v.bind(c) : v;
  },
});

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
    let q = supabase
      .from("calls")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (DASHBOARD_SINCE) q = q.gte("created_at", DASHBOARD_SINCE);
    const { data: c } = await q;
    setCalls((c as CallRow[]) ?? []);
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
