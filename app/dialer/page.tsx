"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";

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

const POLL_MS = 4000;

// Parse pasted leads: one per line, "name, phone, project" (phone required).
// A line with a single column is treated as a bare phone number.
function parseLeads(text: string): { lead_name: string | null; lead_phone: string; project: string | null }[] {
  const out: { lead_name: string | null; lead_phone: string; project: string | null }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const cols = t.split(/[,\t]/).map((c) => c.trim());
    if (cols.length === 1) {
      out.push({ lead_name: null, lead_phone: cols[0], project: null });
    } else {
      out.push({ lead_name: cols[0] || null, lead_phone: cols[1], project: cols[2] || null });
    }
  }
  return out.filter((r) => /\d/.test(r.lead_phone));
}

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
  const map: Record<string, { cls: string; bg: string; color: string }> = {
    queued: { cls: "", bg: "var(--panel-2)", color: "var(--muted)" },
    dialing: { cls: "", bg: "var(--gold-soft-2)", color: "var(--gold-2)" },
    completed: { cls: "", bg: "var(--hot-soft)", color: "var(--hot)" },
    failed: { cls: "", bg: "var(--danger-soft)", color: "var(--danger)" },
    canceled: { cls: "", bg: "var(--panel-2)", color: "var(--dim)" },
  };
  const s = map[status] ?? map.queued;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4, background: s.bg, color: s.color, textTransform: "uppercase" }}>
      {status === "dialing" && <span style={{ width: 6, height: 6, borderRadius: 6, background: "var(--gold)", animation: "pulse 1s ease-in-out infinite" }} />}
      {status}
    </span>
  );
}

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

export default function DialerPage() {
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [numErr, setNumErr] = useState<string | null>(null);
  const [phoneId, setPhoneId] = useState<string>("");

  // single call
  const [sName, setSName] = useState("");
  const [sPhone, setSPhone] = useState("");
  const [sProject, setSProject] = useState("");
  const [singleMsg, setSingleMsg] = useState<string | null>(null);
  const [singleBusy, setSingleBusy] = useState(false);

  // bulk
  const [bulkText, setBulkText] = useState("");
  const [bulkLabel, setBulkLabel] = useState("");
  const parsed = useMemo(() => parseLeads(bulkText), [bulkText]);

  // active batch + live queue
  const [batch, setBatch] = useState<Batch | null>(null);
  const [rows, setRows] = useState<QueueRow[]>([]);
  const loopRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
          project: sProject || null,
          agent_phone_number_id: phoneId,
        }),
      }).then((x) => x.json());
      if (r?.ok) {
        setSingleMsg(`Calling ${sName || sPhone}… (conversation ${r.conversation_id ?? "—"})`);
        setSName(""); setSPhone(""); setSProject("");
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

  async function startCampaign() {
    if (!parsed.length || !phoneId) return;
    const r = await fetch("/api/voice/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: parsed,
        label: bulkLabel || `Campaign · ${parsed.length} leads`,
        agent_phone_number_id: phoneId,
        concurrency: 1,
      }),
    }).then((x) => x.json());
    if (r?.ok) {
      setBulkText(""); setBulkLabel("");
      await refetchBatch(r.batch_id);
      startLoop(r.batch_id);
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

  const counts = useMemo(() => {
    const c = { queued: 0, dialing: 0, completed: 0, failed: 0, canceled: 0 };
    for (const r of rows) c[r.status as keyof typeof c] = (c[r.status as keyof typeof c] ?? 0) + 1;
    return c;
  }, [rows]);

  const running = batch?.status === "running";
  const paused = batch?.status === "paused";

  return (
    <>
      <PageHeader title="Dialer" subtitle="Place a single call or run a bulk calling campaign through the ElevenLabs voice agent" />

      {/* Voice number selector */}
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-body" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600 }}>
            Voice number
          </label>
          {numbers.length > 0 ? (
            <select value={phoneId} onChange={(e) => setPhoneId(e.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 280 }}>
              {numbers.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.phone_number} {n.label ? `· ${n.label}` : ""} {n.provider ? `(${n.provider})` : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              placeholder="agent_phone_number_id (paste manually)"
              value={phoneId}
              onChange={(e) => setPhoneId(e.target.value)}
              style={{ ...inputStyle, width: "auto", minWidth: 320 }}
            />
          )}
          {numErr && <span style={{ fontSize: 12, color: "var(--danger)" }}>⚠ {numErr} — paste the ID manually.</span>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "start" }}>
        {/* Single call */}
        <div className="panel">
          <div className="panel-head"><span className="panel-title">Single call</span></div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input style={inputStyle} placeholder="Lead name (optional)" value={sName} onChange={(e) => setSName(e.target.value)} />
            <input style={inputStyle} placeholder="Phone (+91… or 10-digit)" value={sPhone} onChange={(e) => setSPhone(e.target.value)} />
            <input style={inputStyle} placeholder="Project (optional)" value={sProject} onChange={(e) => setSProject(e.target.value)} />
            <button style={{ ...btn(true), opacity: !sPhone.trim() || !phoneId || singleBusy ? 0.5 : 1 }} disabled={!sPhone.trim() || !phoneId || singleBusy} onClick={placeSingle}>
              {singleBusy ? "Dialing…" : "Call now"}
            </button>
            {singleMsg && <div style={{ fontSize: 12, color: "var(--text-2)" }}>{singleMsg}</div>}
          </div>
        </div>

        {/* Bulk campaign */}
        <div className="panel">
          <div className="panel-head"><span className="panel-title">Bulk campaign</span></div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input style={inputStyle} placeholder="Campaign name (optional)" value={bulkLabel} onChange={(e) => setBulkLabel(e.target.value)} />
            <textarea
              style={{ ...inputStyle, minHeight: 120, fontFamily: "var(--font-geist-mono), monospace", resize: "vertical" }}
              placeholder={"One lead per line:\nName, +919876543210, Project\n…or just a phone per line"}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{parsed.length} valid {parsed.length === 1 ? "lead" : "leads"}</span>
              <button style={{ ...btn(true), marginLeft: "auto", opacity: !parsed.length || !phoneId ? 0.5 : 1 }} disabled={!parsed.length || !phoneId} onClick={startCampaign}>
                Start campaign
              </button>
            </div>
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
