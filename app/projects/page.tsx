"use client";

import { useEffect, useState } from "react";
import { useLiveData, bucketByScore } from "@/lib/data";
import { PageHeader } from "@/components/PageHeader";

type KbProject = {
  id: string;
  slug: string;
  name: string;
  type: string;
  configurations: string | null;
  location: string | null;
  possession: string | null;
  hero: string | null;
  pricing_notes: string | null;
  usps: string | null;
  amenities: string | null;
  brochure_url: string | null;
  rera_number: string | null;
  custom_notes: string | null;
  is_active: boolean;
  display_order: number;
};

const EMPTY_PROJECT: Omit<KbProject, "id"> = {
  slug: "",
  name: "",
  type: "Residential",
  configurations: "",
  location: "",
  possession: "",
  hero: "",
  pricing_notes: "",
  usps: "",
  amenities: "",
  brochure_url: "",
  rera_number: "",
  custom_notes: "",
  is_active: true,
  display_order: 0,
};

export default function ProjectsPage() {
  const { calls } = useLiveData();
  const [projects, setProjects] = useState<KbProject[]>([]);
  const [editing, setEditing] = useState<KbProject | null>(null);
  const [creating, setCreating] = useState(false);

  async function refresh() {
    const res = await fetch("/api/kb", { cache: "no-store" });
    const data = await res.json();
    if (Array.isArray(data)) setProjects(data);
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, []);

  async function toggleActive(p: KbProject) {
    await fetch("/api/kb", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, is_active: !p.is_active }),
    });
    refresh();
  }

  async function deleteProject(p: KbProject) {
    if (!confirm(`Delete "${p.name}"? This removes it from Priya's KB.`)) return;
    await fetch(`/api/kb?id=${p.id}`, { method: "DELETE" });
    refresh();
  }

  const projectStats = projects.map((p) => {
    const projectCalls = calls.filter((c) =>
      (c.project ?? "").toLowerCase().includes(p.name.toLowerCase())
    );
    const { hot, warm, cold } = bucketByScore(projectCalls);
    const visits = projectCalls.filter((c) =>
      (c.outcome ?? "").toLowerCase().includes("site visit")
    ).length;
    return { project: p, total: projectCalls.length, hot: hot.length, warm: warm.length, cold: cold.length, visits };
  });

  return (
    <>
      <PageHeader
        title="Projects · Knowledge Base"
        subtitle="Live KB Priya uses to answer WhatsApp leads. Edit a card to update what she knows."
      />

      <div style={{ marginBottom: 16, display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={() => setCreating(true)}
          style={{ padding: "8px 16px", background: "var(--gold)", color: "#000", border: "none", borderRadius: 6, fontWeight: 600, cursor: "pointer" }}
        >
          + Add Project
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
        {projectStats.map(({ project: p, total, hot, warm, visits }) => (
          <div
            key={p.id}
            className="panel"
            style={{ overflow: "hidden", opacity: p.is_active ? 1 : 0.5, position: "relative" }}
          >
            <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--line)", background: "linear-gradient(180deg, var(--panel-2) 0%, var(--panel) 100%)" }}>
              <div style={{ position: "absolute", top: 14, right: 16, display: "flex", gap: 6 }}>
                <span className="badge" style={{ background: p.type === "Commercial" ? "var(--gold-soft-2)" : "var(--gold-soft)" }}>
                  {p.type}
                </span>
              </div>
              <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{p.configurations}</div>
              {p.hero && <div style={{ fontSize: 11.5, color: "var(--gold-dim)", marginTop: 8 }}>{p.hero}</div>}
            </div>

            <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Stat label="Total Leads" value={total} />
              <Stat label="Hot" value={hot} color="var(--hot)" />
              <Stat label="Warm" value={warm} color="var(--warm)" />
              <Stat label="Site Visits" value={visits} color="var(--gold-2)" />
            </div>

            <div style={{ padding: "12px 20px", borderTop: "1px solid var(--line)", background: "var(--bg-2)", display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)" }}>
              <span>📍 {p.location ?? "—"}</span>
              <span>Possession · <strong style={{ color: "var(--text-2)" }}>{p.possession ?? "—"}</strong></span>
            </div>

            <div style={{ padding: "10px 20px", borderTop: "1px solid var(--line)", display: "flex", gap: 8, fontSize: 12 }}>
              <button onClick={() => setEditing(p)} style={btn()}>Edit</button>
              <button onClick={() => toggleActive(p)} style={btn(p.is_active ? "var(--warm)" : "var(--gold)")}>
                {p.is_active ? "Disable" : "Enable"}
              </button>
              <button onClick={() => deleteProject(p)} style={{ ...btn("var(--hot)"), marginLeft: "auto" }}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      {(editing || creating) && (
        <EditModal
          project={editing ?? { ...EMPTY_PROJECT, id: "" }}
          isNew={creating}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); refresh(); }}
        />
      )}
    </>
  );
}

function btn(color = "var(--line-strong)"): React.CSSProperties {
  return {
    padding: "6px 12px",
    background: "transparent",
    color: color,
    border: `1px solid ${color}`,
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 11.5,
  };
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: color ?? "var(--text)", letterSpacing: -0.3 }} className="num">{value}</div>
    </div>
  );
}

function EditModal({
  project,
  isNew,
  onClose,
  onSaved,
}: {
  project: KbProject | (Omit<KbProject, "id"> & { id: string });
  isNew: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(project);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    const res = await fetch("/api/kb", {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "Save failed");
      return;
    }
    onSaved();
  }

  function field<K extends keyof typeof form>(key: K, label: string, multiline = false) {
    const v = (form[key] ?? "") as string;
    return (
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{label}</label>
        {multiline ? (
          <textarea
            aria-label={label}
            value={v}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            rows={3}
            style={inputStyle()}
          />
        ) : (
          <input
            aria-label={label}
            value={v}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            style={inputStyle()}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div className="panel" style={{ background: "var(--panel)", maxWidth: 640, width: "100%", maxHeight: "90vh", overflowY: "auto", padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 18 }}>
          {isNew ? "Add Project" : `Edit · ${project.name}`}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>{field("name", "Name")}</div>
          <div>{field("slug", "Slug (url-safe)")}</div>
          <div>
            <label style={{ display: "block", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Type</label>
            <select aria-label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={inputStyle()}>
              <option>Residential</option>
              <option>Commercial</option>
              <option>Mixed</option>
            </select>
          </div>
          <div>{field("configurations", "Configurations")}</div>
          <div>{field("location", "Location")}</div>
          <div>{field("possession", "Possession")}</div>
        </div>

        {field("hero", "Tagline (short)")}
        {field("pricing_notes", "Pricing notes (Priya will quote this verbatim)", true)}
        {field("usps", "USPs", true)}
        {field("amenities", "Amenities", true)}
        {field("brochure_url", "Brochure URL")}
        {field("rera_number", "RERA Number")}
        {field("custom_notes", "Custom notes (anything else Priya should know)", true)}

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            id="active"
          />
          <label htmlFor="active" style={{ fontSize: 13 }}>Active (visible to Priya)</label>
        </div>

        {err && <div style={{ color: "var(--hot)", marginBottom: 12, fontSize: 13 }}>{err}</div>}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={btn()}>Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            style={{ ...btn("var(--gold)"), background: "var(--gold)", color: "#000" }}
          >
            {saving ? "Saving…" : isNew ? "Create" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    padding: "8px 10px",
    background: "var(--bg-2)",
    border: "1px solid var(--line)",
    borderRadius: 4,
    color: "var(--text)",
    fontSize: 13,
    fontFamily: "inherit",
  };
}
