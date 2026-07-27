// Shimmer rows for the first paint of a list, so the dashboard never shows the
// word "Loading…" — the shape of the data arrives before the data does.
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "13px 20px",
            borderBottom: i === rows - 1 ? "none" : "1px solid var(--line)",
          }}
        >
          <div className="skeleton" style={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            {/* Varied widths so it reads as rows of text, not a loading bar. */}
            <div className="skeleton" style={{ height: 11, width: `${38 + ((i * 13) % 26)}%`, marginBottom: 6 }} />
            <div className="skeleton" style={{ height: 9, width: `${22 + ((i * 17) % 22)}%` }} />
          </div>
          <div className="skeleton" style={{ width: 62, height: 20, borderRadius: 999, flexShrink: 0 }} />
        </div>
      ))}
    </div>
  );
}
