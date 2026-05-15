export function timeAgo(ts: string | Date): string {
  const date = typeof ts === "string" ? new Date(ts) : ts;
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function fmtDuration(sec: number): string {
  if (!sec || sec < 0) return "0s";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export function fmtPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  // Mask middle digits for display
  return phone.replace(/(\+\d{1,3}\s?\d{2,4})(\s?\d{3,})/, (_, a, b) => {
    const masked = b.replace(/\d(?=\d{2})/g, "•");
    return `${a}${masked}`;
  });
}

export function scoreLabel(score: number): "HOT" | "WARM" | "COLD" {
  if (score >= 80) return "HOT";
  if (score >= 60) return "WARM";
  return "COLD";
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function fmtDateTime(ts: string | Date): string {
  const d = typeof ts === "string" ? new Date(ts) : ts;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function fmtDateShort(ts: string | Date): string {
  const d = typeof ts === "string" ? new Date(ts) : ts;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Canonicalize a phone for use as a lead identity key.
// Strategy: keep only digits, then prefix with `+`. So "919589594181",
// "+91 9589594181", and "+919589594181" all collapse to "+919589594181".
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = String(raw).replace(/[^\d]/g, "");
  return digits ? `+${digits}` : "";
}

export function fmtTime(ts: string | Date): string {
  const d = typeof ts === "string" ? new Date(ts) : ts;
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}
