"use client";

import { PROJECTS, getProjectByName } from "@/lib/projects";
import { useLiveData, bucketByScore } from "@/lib/data";
import { PageHeader } from "@/components/PageHeader";

export default function ProjectsPage() {
  const { calls } = useLiveData();

  // Compute per-project stats from real call data
  const projectStats = PROJECTS.map((p) => {
    const projectCalls = calls.filter((c) => {
      const matched = getProjectByName(c.project);
      return matched?.slug === p.slug;
    });
    const { hot, warm, cold } = bucketByScore(projectCalls);
    const visits = projectCalls.filter((c) => (c.outcome ?? "").toLowerCase().includes("site visit")).length;
    return { project: p, total: projectCalls.length, hot: hot.length, warm: warm.length, cold: cold.length, visits };
  });

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Six active projects across Mhow · live demand and qualification rate"
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
        {projectStats.map(({ project: p, total, hot, warm, visits }) => (
          <div key={p.slug} className="panel" style={{ overflow: "hidden", transition: "border-color 0.15s, transform 0.15s" }}
               onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--line-strong)"; }}
               onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line)"; }}>
            {/* Card header — gradient gold accent */}
            <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--line)", position: "relative", background: "linear-gradient(180deg, var(--panel-2) 0%, var(--panel) 100%)" }}>
              <div style={{ position: "absolute", top: 14, right: 16 }}>
                <span className="badge" style={{ background: p.type === "Commercial" ? "var(--gold-soft-2)" : "var(--gold-soft)" }}>
                  {p.type}
                </span>
              </div>
              <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: -0.2, marginBottom: 4 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{p.configurations}</div>
              <div style={{ fontSize: 11.5, color: "var(--gold-dim)", marginTop: 8, letterSpacing: 0.2 }}>{p.hero}</div>
            </div>

            {/* Stats */}
            <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Stat label="Total Leads" value={total} />
              <Stat label="Hot" value={hot} color="var(--hot)" />
              <Stat label="Warm" value={warm} color="var(--warm)" />
              <Stat label="Site Visits" value={visits} color="var(--gold-2)" />
            </div>

            {/* Footer meta */}
            <div style={{ padding: "12px 20px", borderTop: "1px solid var(--line)", background: "var(--bg-2)", display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)" }}>
              <span>📍 {p.location}</span>
              <span>Possession · <strong style={{ color: "var(--text-2)" }}>{p.possession}</strong></span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: color ?? "var(--text)", letterSpacing: -0.3 }} className="num">{value}</div>
    </div>
  );
}
