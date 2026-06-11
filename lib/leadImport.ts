// Pure helpers for importing leads from an uploaded CSV/XLSX. No secrets, no
// browser/server-only APIs — safe to import from both the client (preview) and
// the server (the /api/voice/bulk safety net), so cleaning rules never diverge.

// Normalize a lead name from a sheet cell:
//  - trim + collapse whitespace
//  - strip a trailing standalone honorific "ji"/"जी" — the agent already appends
//    जी after the name, so "Ajay Ji" → "Ajay" (avoids "Ajay जी जी")
//  - "Unknown" or blank → null (no-name lead → agent uses a name-less greeting,
//    never "Unknown जी")
// Only a SEPARATE trailing word is stripped, so "Raji" stays "Raji".
export function cleanLeadName(raw: unknown): string | null {
  if (raw == null) return null;
  let s = String(raw).replace(/\s+/g, " ").trim();
  if (!s) return null;
  s = s.replace(/[\s,]+(ji|जी)\.?$/i, "").trim();
  if (!s) return null;
  if (s.toLowerCase() === "unknown") return null;
  return s;
}

// Validate + lightly normalize a phone cell. Returns null when there aren't
// enough digits to be a real number (the server's normalisePhone does the final
// +91 shaping at dial time). Keeps a leading "+" if present.
export function cleanPhone(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  const hadPlus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return hadPlus ? `+${digits}` : digits;
}

// Digits-only key for de-duplicating numbers regardless of +/spacing/+91.
export function phoneKey(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}
