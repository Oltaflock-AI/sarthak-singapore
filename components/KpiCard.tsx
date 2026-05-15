interface Props {
  label: string;
  value: string | number;
  unit?: string;
  sub?: string;
  icon?: React.ReactNode;
}

export function KpiCard({ label, value, unit, sub, icon }: Props) {
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
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
