interface Props {
  label: string;
  value: string | number;
  unit?: string;
  sub?: string;
  icon?: React.ReactNode;
  progress?: number; // 0..1 — renders a thin usage bar when provided
  progressColor?: string;
}

export function KpiCard({ label, value, unit, sub, icon, progress, progressColor }: Props) {
  const pct = progress == null ? null : Math.max(0, Math.min(1, progress)) * 100;
  return (
    <div className="kpi">
      <div className="kpi-label">
        {icon}
        {label}
      </div>
      <div className={`kpi-value${unit ? " small-unit" : ""}`}>
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {pct != null && (
        <div
          style={{ height: 5, borderRadius: 999, background: "var(--line)", overflow: "hidden", margin: "8px 0 2px" }}
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div style={{ height: "100%", width: `${pct}%`, borderRadius: 999, background: progressColor || "#22c55e", transition: "width .4s ease" }} />
        </div>
      )}
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
