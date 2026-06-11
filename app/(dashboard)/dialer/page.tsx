"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { parseLeadsFile, type ParseResult } from "@/lib/parseLeads";
import type { LiveCallStatus, CallPhase } from "@/lib/elevenlabs";

interface PhoneNumber {
  id: string;
  phone_number: string;
  label: string | null;
  provider: string | null;
  agent: string | null;
}

interface QueueRow {
  id: string;
  lead_name: string | null;
  lead_phone: string;
  project: string | null;
  status: string;
  outcome: string | null;
  conversation_id: string | null;
  last_error: string | null;
  attempts: number;
}

interface Batch {
  id: string;
  label: string;
  status: string;
  concurrency: number;
}

interface ActiveCall {
  conversationId: string;
  name: string;
  phone: string;
}

const POLL_MS = 4000;
const LIVE_POLL_MS = 2000;

const inputStyle: React.CSSProperties = {
  background: "var(--bg-2)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "9px 12px",
  color: "var(--text)",
  fontSize: 13,
  outline: "none",
  width: "100%",
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    queued: { bg: "var(--panel-2)", color: "var(--muted)" },
    dialing: { bg: "var(--gold-soft-2)", color: "var(--gold-2)" },
    completed: { bg: "var(--hot-soft)", color: "var(--hot)" },
    failed: { bg: "var(--danger-soft)", color: "var(--danger)" },
    canceled: { bg: "var(--panel-2)", color: "var(--dim)" },
  };
  const s = map[status] ?? map.queued;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4, background: s.bg, color: s.color, textTransform: "uppercase" }}>
      {status === "dialing" && <span style={{ width: 6, height: 6, borderRadius: 6, background: "var(--gold)", animation: "pulse 1s ease-in-out infinite" }} />}
      {status}
    </span>
  );
}

const KEYPAD: { d: string; sub?: string }[] = [
  { d: "1" }, { d: "2", sub: "ABC" }, { d: "3", sub: "DEF" },
  { d: "4", sub: "GHI" }, { d: "5", sub: "JKL" }, { d: "6", sub: "MNO" },
  { d: "7", sub: "PQRS" }, { d: "8", sub: "TUV" }, { d: "9", sub: "WXYZ" },
  { d: "*" }, { d: "0", sub: "+" }, { d: "#" },
];

const btn = (primary = false): React.CSSProperties => ({
  padding: "9px 16px",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  border: "1px solid",
  background: primary ? "var(--gold)" : "var(--bg-2)",
  color: primary ? "#1a1611" : "var(--text-2)",
  borderColor: primary ? "var(--gold)" : "var(--line)",
  transition: "all 0.15s",
});

function mmss(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

// Visual treatment per live-call phase.
const PHASE_META: Record<CallPhase, { label: string; color: string; soft: string }> = {
  ringing: { label: "Ringing…", color: "var(--gold)", soft: "var(--gold-soft-2)" },
  connected: { label: "Connected", color: "var(--hot)", soft: "var(--hot-soft)" },
  ended: { label: "Call ended", color: "var(--muted)", soft: "var(--panel-2)" },
  failed: { label: "Not connected", color: "var(--danger)", soft: "var(--danger-soft)" },
  unknown: { label: "Connecting…", color: "var(--gold)", soft: "var(--gold-soft-2)" },
};

const PHONE_ICON = (
  <svg width="26" height="26" viewBox="0 0 20 20" fill="currentColor">
    <path d="M5.5 3.5h2l1.2 3-1.4 1c.7 1.6 2 2.9 3.6 3.6l1-1.4 3 1.2v2c0 .8-.7 1.5-1.5 1.5-6 0-11-5-11-11 0-.8.7-1.5 1.5-1.5z" />
  </svg>
);

// ── Live call card ────────────────────────────────────────────────────────
// Polls /api/voice/status while a call is in flight and renders the
// Ringing → Connected → Ended progression with a live timer.
function LiveCallCard({ call, onDismiss }: { call: ActiveCall; onDismiss: () => void }) {
  const [live, setLive] = useState<LiveCallStatus | null>(null);
  const [, setTick] = useState(0); // 1s heartbeat for the running timer
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  // reset when a new call starts
  useEffect(() => { setLive(null); }, [call.conversationId]);

  useEffect(() => {
    let alive = true;
    const fetchStatus = async () => {
      try {
        const r = await fetch(`/api/voice/status?conversation_id=${call.conversationId}`, { cache: "no-store" });
        const d = (await r.json()) as LiveCallStatus;
        if (!alive) return;
        setLive(d);
        if (d.phase === "ended" || d.phase === "failed") {
          if (poll.current) clearInterval(poll.current);
          poll.current = null;
        }
      } catch { /* transient — keep polling */ }
    };
    fetchStatus();
    poll.current = setInterval(fetchStatus, LIVE_POLL_MS);
    return () => { alive = false; if (poll.current) clearInterval(poll.current); };
  }, [call.conversationId]);

  // 1s heartbeat so the connected timer ticks
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const phase: CallPhase = live?.phase ?? "unknown";
  const meta = PHASE_META[phase];
  const done = phase === "ended" || phase === "failed";

  // elapsed: prefer final duration once ended; else count from accept (or start)
  let elapsed = 0;
  if (live?.duration_secs != null && done) {
    elapsed = live.duration_secs;
  } else if (live?.accepted_unix) {
    elapsed = Date.now() / 1000 - live.accepted_unix;
  } else if (live?.start_unix && phase === "connected") {
    elapsed = Date.now() / 1000 - live.start_unix;
  }
  const showTimer = phase === "connected" || (done && (live?.duration_secs ?? 0) > 0);

  return (
    <div
      className="panel"
      style={{ marginBottom: 18, borderColor: meta.color, boxShadow: `0 0 0 1px ${meta.color}, var(--shadow-2)`, overflow: "hidden" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "20px 22px", background: `linear-gradient(90deg, ${meta.soft} 0%, transparent 70%)` }}>
        {/* pulsing orb */}
        <div className="call-orb" style={{ width: 56, height: 56, color: meta.color, flexShrink: 0 }}>
          {!done && <span className="ring" />}
          {!done && <span className="ring b" />}
          <span style={{ width: 56, height: 56, borderRadius: "50%", display: "grid", placeItems: "center", background: meta.color, color: "#0a0908", boxShadow: `0 6px 18px -4px ${meta.color}` }}>
            {PHONE_ICON}
          </span>
        </div>

        {/* identity */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 17, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {call.name || "Unknown lead"}
            </span>
            {phase === "connected" && (
              <span className="eq" style={{ color: meta.color }}><i /><i /><i /><i /></span>
            )}
          </div>
          <div className="num" style={{ fontSize: 13, color: "var(--text-2)", marginTop: 3 }}>{call.phone}</div>
        </div>

        {/* status + timer */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: meta.color }}>
            {!done && <span style={{ width: 7, height: 7, borderRadius: 7, background: meta.color, animation: "pulse 1.1s ease-in-out infinite" }} />}
            {meta.label}
          </div>
          <div className="num" style={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.5, marginTop: 4, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
            {showTimer ? mmss(elapsed) : phase === "ringing" ? "··· " : "—"}
          </div>
          {done && (
            <button onClick={onDismiss} style={{ ...btn(), marginTop: 8, padding: "5px 12px", fontSize: 11.5 }}>
              {phase === "failed" ? "Dismiss" : "Done"}
            </button>
          )}
        </div>
      </div>

      {done && (live?.termination_reason || phase === "failed") && (
        <div style={{ padding: "9px 22px", borderTop: "1px solid var(--line)", fontSize: 11.5, color: "var(--muted)" }}>
          {live?.termination_reason
            ? `Ended — ${live.termination_reason.replace(/_/g, " ")}`
            : "The call did not connect (busy, no answer, or rejected)."}
        </div>
      )}
    </div>
  );
}

// ── Bulk-import preview modal ───────────────────────────────────────────────
// Shows the cleaned, deduped leads before any dialing starts so the operator
// can sanity-check the parse (names stripped of "ji", "Unknown" → no-name).
function ImportPreview({
  preview, canStart, busy, onCancel, onStart,
}: {
  preview: ParseResult;
  canStart: boolean;
  busy: boolean;
  onCancel: () => void;
  onStart: () => void;
}) {
  const { leads, totalRows, noNameCount, duplicates, skipped, nameHeader, phoneHeader } = preview;
  const stat = (label: string, value: number | string, danger = false) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="num" style={{ fontSize: 18, fontWeight: 700, color: danger ? "var(--danger)" : "var(--text)" }}>{value}</span>
      <span style={{ fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
    </div>
  );

  return (
    <div
      onClick={onCancel}
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center", padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="panel"
        style={{ width: "100%", maxWidth: 640, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-2)" }}
      >
        <div className="panel-head">
          <span className="panel-title">Review import — {leads.length} {leads.length === 1 ? "call" : "calls"} ready</span>
          <button onClick={onCancel} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        <div className="panel-body" style={{ display: "flex", gap: 24, flexWrap: "wrap", borderBottom: "1px solid var(--line)" }}>
          {stat("Will dial", leads.length)}
          {stat("Rows read", totalRows)}
          {stat("No name → generic", noNameCount)}
          {duplicates > 0 && stat("Duplicates skipped", duplicates)}
          {skipped.length > 0 && stat("Bad/no phone", skipped.length, true)}
        </div>

        <div style={{ padding: "8px 20px", fontSize: 11.5, color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
          Columns: <strong style={{ color: "var(--text-2)" }}>{nameHeader || "(name inferred)"}</strong> · <strong style={{ color: "var(--text-2)" }}>{phoneHeader || "(phone inferred)"}</strong>
          {" · "}the agent appends “जी”, so a no-name lead is greeted without a name.
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, position: "sticky", top: 0, background: "var(--panel)" }}>
                <th style={{ textAlign: "left", padding: "9px 20px" }}>#</th>
                <th style={{ textAlign: "left", padding: "9px 12px" }}>Name</th>
                <th style={{ textAlign: "left", padding: "9px 20px" }}>Phone</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l, i) => (
                <tr key={`${l.phone}-${i}`} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "8px 20px", color: "var(--muted)" }} className="num">{i + 1}</td>
                  <td style={{ padding: "8px 12px", color: l.name ? "var(--text)" : "var(--muted)", fontStyle: l.name ? "normal" : "italic" }}>
                    {l.name || "no name → generic greeting"}
                    {l.name && l.rawName && l.rawName !== l.name && (
                      <span style={{ color: "var(--muted)", fontSize: 11 }}> (from “{l.rawName}”)</span>
                    )}
                  </td>
                  <td style={{ padding: "8px 20px", color: "var(--text-2)" }} className="num">{l.phone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel-body" style={{ borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: canStart ? "var(--muted)" : "var(--danger)" }}>
            {canStart ? "Calls dial one at a time through the selected voice line." : "Select a voice line first (top of the page)."}
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onCancel} style={{ ...btn(), padding: "9px 16px" }}>Cancel</button>
            <button
              onClick={onStart}
              disabled={!canStart || busy}
              style={{ ...btn(true), padding: "9px 18px", opacity: !canStart || busy ? 0.5 : 1, cursor: !canStart || busy ? "default" : "pointer" }}
            >
              {busy ? "Starting…" : `Start ${leads.length} ${leads.length === 1 ? "call" : "calls"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DialerPage() {
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [numErr, setNumErr] = useState<string | null>(null);
  const [phoneId, setPhoneId] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState(false);

  // single call (keypad)
  const [sName, setSName] = useState("");
  const [sPhone, setSPhone] = useState("");
  const [singleMsg, setSingleMsg] = useState<string | null>(null);
  const [singleBusy, setSingleBusy] = useState(false);
  const zeroHold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zeroLong = useRef(false);

  // live call indicator
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);

  // active batch + live queue
  const [batch, setBatch] = useState<Batch | null>(null);
  const [rows, setRows] = useState<QueueRow[]>([]);
  const loopRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // bulk import (CSV/XLSX)
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParseResult | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // ── load phone numbers + restore saved selection ──────────────────────────
  useEffect(() => {
    fetch("/api/voice/phone-numbers")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) {
          setNumbers(d);
          const saved = localStorage.getItem("dialer_phone_id");
          const pick = (saved && d.find((n: PhoneNumber) => n.id === saved)) || d[0];
          if (pick) setPhoneId(pick.id);
        } else {
          setNumErr(d?.error || "Could not load phone numbers");
        }
      })
      .catch((e) => setNumErr(String(e)));
  }, []);

  useEffect(() => {
    if (phoneId) localStorage.setItem("dialer_phone_id", phoneId);
  }, [phoneId]);

  const selected = useMemo(() => numbers.find((n) => n.id === phoneId) ?? null, [numbers, phoneId]);

  // ── live queue polling + dialer loop for the active batch ──────────────────
  const refetchBatch = useCallback(async (id: string) => {
    const r = await fetch(`/api/voice/queue?batch_id=${id}`).then((x) => x.json());
    if (r?.batch) setBatch(r.batch);
    setRows(r?.rows ?? []);
    return r?.batch as Batch | undefined;
  }, []);

  const stopLoop = useCallback(() => {
    if (loopRef.current) clearInterval(loopRef.current);
    loopRef.current = null;
  }, []);

  const startLoop = useCallback(
    (id: string) => {
      stopLoop();
      const tick = async () => {
        await fetch("/api/voice/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batch_id: id }),
        }).catch(() => {});
        const b = await refetchBatch(id);
        if (b && (b.status === "done" || b.status === "canceled")) stopLoop();
      };
      tick();
      loopRef.current = setInterval(tick, POLL_MS);
    },
    [refetchBatch, stopLoop],
  );

  useEffect(() => () => stopLoop(), [stopLoop]);

  // ── actions ────────────────────────────────────────────────────────────────
  async function placeSingle() {
    if (!sPhone.trim() || !phoneId) return;
    setSingleBusy(true);
    setSingleMsg(null);
    try {
      const r = await fetch("/api/voice/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to_number: sPhone,
          lead_name: sName || null,
          agent_phone_number_id: phoneId,
        }),
      }).then((x) => x.json());
      if (r?.ok) {
        const name = sName.trim();
        const phone = sPhone.trim();
        if (r.conversation_id) {
          setActiveCall({ conversationId: r.conversation_id, name, phone });
        }
        setSingleMsg(null);
        setSName(""); setSPhone("");
        await refetchBatch(r.batch_id);
        setBatch((b) => b ?? { id: r.batch_id, label: "Single", status: "running", concurrency: 1 });
        startLoop(r.batch_id);
      } else {
        setSingleMsg(`Failed: ${r?.error ?? "unknown error"}`);
      }
    } catch (e) {
      setSingleMsg(`Failed: ${String(e)}`);
    } finally {
      setSingleBusy(false);
    }
  }

  // ── bulk import ──────────────────────────────────────────────────────────
  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setParseErr(null);
    setParsing(true);
    try {
      const result = await parseLeadsFile(file);
      if (!result.ok) {
        setParseErr(result.error || "Couldn't read the file.");
      } else if (result.leads.length === 0) {
        setParseErr("No dialable rows found — every row was missing a valid phone number.");
      } else {
        setPreview(result);
      }
    } catch {
      setParseErr("Couldn't read the file. Upload a .csv, .xlsx, or .xls.");
    } finally {
      setParsing(false);
    }
  }

  async function startBulk() {
    if (!preview || !phoneId || bulkBusy) return;
    setBulkBusy(true);
    try {
      const r = await fetch("/api/voice/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_phone_number_id: phoneId,
          label: "Bulk import",
          leads: preview.leads.map((l) => ({ name: l.name, phone: l.phone })),
        }),
      }).then((x) => x.json());
      if (r?.ok) {
        setPreview(null);
        await refetchBatch(r.batch_id);
        setBatch((b) => b ?? { id: r.batch_id, label: "Bulk import", status: "running", concurrency: 1 });
        startLoop(r.batch_id);
      } else {
        setParseErr(`Failed to start: ${r?.error ?? "unknown error"}`);
      }
    } catch (e) {
      setParseErr(`Failed to start: ${String(e)}`);
    } finally {
      setBulkBusy(false);
    }
  }

  async function control(action: "pause" | "resume" | "cancel") {
    if (!batch) return;
    await fetch("/api/voice/queue", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batch_id: batch.id, action }),
    });
    const b = await refetchBatch(batch.id);
    if (action === "cancel") stopLoop();
    if (action === "resume" && b?.status === "running") startLoop(batch.id);
  }

  // keypad input
  const press = (d: string) => setSPhone((p) => p + d);
  const backspace = () => setSPhone((p) => p.slice(0, -1));
  const clearAll = () => setSPhone("");
  // tap 0 → "0"; long-press 0 → "+"
  const zeroDown = () => {
    zeroLong.current = false;
    zeroHold.current = setTimeout(() => {
      zeroLong.current = true;
      setSPhone((p) => p + "+");
    }, 450);
  };
  const zeroUp = () => {
    if (zeroHold.current) clearTimeout(zeroHold.current);
    if (!zeroLong.current) setSPhone((p) => p + "0");
  };

  const counts = useMemo(() => {
    const c = { queued: 0, dialing: 0, completed: 0, failed: 0, canceled: 0 };
    for (const r of rows) c[r.status as keyof typeof c] = (c[r.status as keyof typeof c] ?? 0) + 1;
    return c;
  }, [rows]);

  const running = batch?.status === "running";
  const paused = batch?.status === "paused";
  const callDisabled = !sPhone.trim() || !phoneId || singleBusy;

  return (
    <>
      <PageHeader
        title="Dialer"
        subtitle="Place a call through the ElevenLabs voice agent"
        right={
          <>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              style={{ display: "none" }}
              onChange={onFilePicked}
            />
            <button
              onClick={() => fileInput.current?.click()}
              disabled={parsing}
              title="Bulk call from a CSV or XLSX of leads"
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                padding: "7px 13px", borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                cursor: parsing ? "default" : "pointer",
                border: "1px solid var(--gold-dim)", background: "var(--gold-soft)", color: "var(--gold-2)",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {parsing ? "Reading…" : "Import CSV / XLSX"}
            </button>
          </>
        }
      />

      {parseErr && (
        <div style={{ marginBottom: 14, padding: "10px 16px", background: "var(--danger-soft)", border: "1px solid var(--danger-soft)", borderRadius: 8, fontSize: 12.5, color: "var(--danger)", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span>⚠ {parseErr}</span>
          <button onClick={() => setParseErr(null)} style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", fontWeight: 600 }}>Dismiss</button>
        </div>
      )}

      {preview && (
        <ImportPreview
          preview={preview}
          canStart={!!phoneId}
          busy={bulkBusy}
          onCancel={() => setPreview(null)}
          onStart={startBulk}
        />
      )}

      {/* ── Voice line card ─────────────────────────────────────────────── */}
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-body" style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--gold-soft-2)", color: "var(--gold)", flexShrink: 0 }}>
            <svg width="19" height="19" viewBox="0 0 20 20" fill="currentColor"><path d="M5.5 3.5h2l1.2 3-1.4 1c.7 1.6 2 2.9 3.6 3.6l1-1.4 3 1.2v2c0 .8-.7 1.5-1.5 1.5-6 0-11-5-11-11 0-.8.7-1.5 1.5-1.5z" /></svg>
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 600 }}>Voice line</div>
            {selected ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 3, flexWrap: "wrap" }}>
                <span className="num" style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", letterSpacing: 0.3 }}>{selected.phone_number}</span>
                {selected.label && <span style={{ fontSize: 12, color: "var(--text-2)" }}>{selected.label}</span>}
                {selected.provider && (
                  <span style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 999, background: "var(--panel-2)", color: "var(--muted)", border: "1px solid var(--line)", letterSpacing: 0.3 }}>
                    {selected.provider.replace(/_/g, " ")}
                  </span>
                )}
              </div>
            ) : numbers.length === 0 && !numErr ? (
              <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 4 }}>Loading…</div>
            ) : (
              <input
                placeholder="Paste agent_phone_number_id"
                value={phoneId}
                onChange={(e) => setPhoneId(e.target.value)}
                style={{ ...inputStyle, marginTop: 4, minWidth: 280 }}
              />
            )}
          </div>

          {/* ready dot */}
          {selected && (
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--hot)", fontWeight: 600, letterSpacing: 0.3 }}>
              <span className="live-dot" style={{ background: "var(--hot)" }} /> Ready
            </span>
          )}

          {/* switch line — only when there's a real choice */}
          {numbers.length > 1 && (
            <div style={{ position: "relative", marginLeft: selected ? 0 : "auto" }}>
              <button style={btn()} onClick={() => setPickerOpen((o) => !o)}>Switch ▾</button>
              {pickerOpen && (
                <div className="panel" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 20, minWidth: 280, boxShadow: "var(--shadow-2)", padding: 6 }}>
                  {numbers.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => { setPhoneId(n.id); setPickerOpen(false); }}
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 13, background: n.id === phoneId ? "var(--gold-soft)" : "transparent", color: n.id === phoneId ? "var(--gold-2)" : "var(--text-2)" }}
                    >
                      <span className="num" style={{ fontWeight: 600 }}>{n.phone_number}</span>
                      {n.label ? <span style={{ color: "var(--muted)" }}> · {n.label}</span> : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {numErr && <span style={{ fontSize: 12, color: "var(--danger)", flexBasis: "100%" }}>⚠ {numErr} — paste the ID manually.</span>}
        </div>
      </div>

      {/* ── Live call indicator ─────────────────────────────────────────── */}
      {activeCall && (
        <LiveCallCard
          key={activeCall.conversationId}
          call={activeCall}
          onDismiss={() => setActiveCall(null)}
        />
      )}

      {/* ── Keypad ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div className="panel" style={{ width: "100%", maxWidth: 440 }}>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, paddingTop: 26 }}>
            <input
              style={{ ...inputStyle, maxWidth: 280, textAlign: "center" }}
              placeholder="Lead name (optional)"
              value={sName}
              onChange={(e) => setSName(e.target.value)}
            />

            {/* number display */}
            <div style={{ minHeight: 48, display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
              <input
                value={sPhone}
                onChange={(e) => setSPhone(e.target.value)}
                placeholder="Enter a number"
                inputMode="tel"
                style={{
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  textAlign: "center",
                  fontSize: 34,
                  fontWeight: 500,
                  letterSpacing: 1,
                  color: "var(--text)",
                  width: "100%",
                  fontVariantNumeric: "tabular-nums",
                }}
              />
            </div>

            {/* keypad grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 70px)", gap: 16, justifyContent: "center" }}>
              {KEYPAD.map((k) => {
                const isZero = k.d === "0";
                return (
                  <button
                    key={k.d}
                    onClick={isZero ? undefined : () => press(k.d)}
                    onPointerDown={isZero ? zeroDown : undefined}
                    onPointerUp={isZero ? zeroUp : undefined}
                    onPointerLeave={isZero ? () => { if (zeroHold.current) clearTimeout(zeroHold.current); } : undefined}
                    style={{
                      width: 70,
                      height: 70,
                      borderRadius: "50%",
                      border: "1px solid var(--line)",
                      background: "var(--bg-2)",
                      color: "var(--text)",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 1,
                      transition: "background 0.1s, transform 0.06s",
                      userSelect: "none",
                    }}
                    onMouseDown={(e) => { e.currentTarget.style.background = "var(--panel-3)"; e.currentTarget.style.transform = "scale(0.94)"; }}
                    onMouseUp={(e) => { e.currentTarget.style.background = "var(--bg-2)"; e.currentTarget.style.transform = "scale(1)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-2)"; e.currentTarget.style.transform = "scale(1)"; }}
                  >
                    <span style={{ fontSize: 25, fontWeight: 500, lineHeight: 1 }}>{k.d}</span>
                    {k.sub && <span style={{ fontSize: 9, letterSpacing: 1.5, color: "var(--muted)" }}>{k.sub}</span>}
                  </button>
                );
              })}
            </div>

            {/* call row: call button + backspace */}
            <div style={{ display: "grid", gridTemplateColumns: "70px 70px 70px", gap: 16, alignItems: "center", justifyContent: "center", marginTop: 4 }}>
              <span />
              <button
                disabled={callDisabled}
                onClick={placeSingle}
                title={!phoneId ? "Select a voice number first" : "Call"}
                style={{
                  width: 70,
                  height: 70,
                  borderRadius: "50%",
                  border: "none",
                  background: callDisabled ? "var(--line)" : "var(--hot)",
                  color: "#0a0908",
                  cursor: callDisabled ? "default" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "transform 0.1s, box-shadow 0.15s",
                  boxShadow: callDisabled ? "none" : "0 6px 18px -4px var(--hot)",
                }}
              >
                {singleBusy ? (
                  <span style={{ fontSize: 11, fontWeight: 600 }}>…</span>
                ) : PHONE_ICON}
              </button>
              <button
                onClick={backspace}
                onDoubleClick={clearAll}
                aria-label="Backspace"
                style={{
                  width: 70,
                  height: 70,
                  borderRadius: "50%",
                  border: "none",
                  background: "transparent",
                  color: sPhone ? "var(--text-2)" : "transparent",
                  cursor: sPhone ? "pointer" : "default",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 5H8.5L3 12l5.5 7H21a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z" />
                  <path d="M12 9.5l4 4M16 9.5l-4 4" />
                </svg>
              </button>
            </div>

            <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", marginTop: 2 }}>
              Tap a 10-digit number (auto +91) or hold <strong>0</strong> for <strong>+</strong>. Double-tap ⌫ to clear.
            </div>
            {singleMsg && <div style={{ fontSize: 12, color: "var(--danger)", textAlign: "center" }}>{singleMsg}</div>}
          </div>
        </div>
      </div>

      {/* Live queue */}
      {batch && (
        <div className="panel" style={{ marginTop: 18 }}>
          <div className="panel-head">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="panel-title">{batch.label}</span>
              <StatusBadge status={batch.status} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {running && <button style={btn()} onClick={() => control("pause")}>Pause</button>}
              {paused && <button style={btn(true)} onClick={() => control("resume")}>Resume</button>}
              {(running || paused) && <button style={{ ...btn(), color: "var(--danger)", borderColor: "var(--danger-soft)" }} onClick={() => control("cancel")}>Cancel</button>}
            </div>
          </div>
          <div className="panel-body" style={{ display: "flex", gap: 16, flexWrap: "wrap", borderBottom: "1px solid var(--line)", paddingBottom: 14 }}>
            {(["queued", "dialing", "completed", "failed", "canceled"] as const).map((k) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <StatusBadge status={k} />
                <span className="num" style={{ fontSize: 14, fontWeight: 600 }}>{counts[k]}</span>
              </div>
            ))}
          </div>
          <div className="panel-body flush">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  <th style={{ textAlign: "left", padding: "10px 20px" }}>Lead</th>
                  <th style={{ textAlign: "left", padding: "10px 12px" }}>Phone</th>
                  <th style={{ textAlign: "left", padding: "10px 12px" }}>Project</th>
                  <th style={{ textAlign: "left", padding: "10px 12px" }}>Status</th>
                  <th style={{ textAlign: "left", padding: "10px 20px" }}>Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "10px 20px", color: "var(--text)" }}>{r.lead_name || "—"}</td>
                    <td style={{ padding: "10px 12px", color: "var(--text-2)" }} className="num">{r.lead_phone}</td>
                    <td style={{ padding: "10px 12px", color: "var(--muted)" }}>{r.project || "—"}</td>
                    <td style={{ padding: "10px 12px" }}><StatusBadge status={r.status} /></td>
                    <td style={{ padding: "10px 20px", color: r.last_error ? "var(--danger)" : "var(--muted)", fontSize: 12 }}>
                      {r.last_error || r.outcome || (r.status === "dialing" ? "in progress…" : "")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
