"use client";

// Parse an uploaded CSV/XLSX of leads entirely in the browser. SheetJS is
// loaded on demand (dynamic import) so it stays out of the main bundle and only
// downloads when someone actually imports a file.

import { cleanLeadName, cleanPhone, phoneKey } from "@/lib/leadImport";

export interface ParsedLead {
  name: string | null; // cleaned; null → no-name (agent uses generic greeting)
  rawName: string; // original cell, shown in the preview
  phone: string; // cleaned, dialable
}

export interface SkippedRow {
  row: number; // 1-based sheet row, for the preview
  rawName: string;
  rawPhone: string;
  reason: string;
}

export interface ParseResult {
  ok: boolean;
  error?: string; // fatal: wrong format / no phone column
  leads: ParsedLead[]; // valid, deduped, dialable
  totalRows: number; // data rows seen (excl. header)
  noNameCount: number; // leads that will use the name-less greeting
  duplicates: number; // rows dropped as duplicate phones
  skipped: SkippedRow[]; // rows dropped (bad/missing phone)
  nameHeader: string | null;
  phoneHeader: string | null;
}

const NAME_RE = /\b(name|lead|customer|contact\s*name|full\s*name)\b/i;
const PHONE_RE = /\b(phone|mobile|number|contact|cell|tel|whatsapp|msisdn)\b/i;

function looksLikePhone(v: unknown): boolean {
  return String(v ?? "").replace(/\D/g, "").length >= 10;
}

const MAX_LEADS = 1000;

export async function parseLeadsFile(file: File): Promise<ParseResult> {
  const empty: ParseResult = {
    ok: false, leads: [], totalRows: 0, noNameCount: 0, duplicates: 0,
    skipped: [], nameHeader: null, phoneHeader: null,
  };

  let rows: unknown[][];
  try {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return { ...empty, error: "The file has no sheets." };
    const ws = wb.Sheets[sheetName];
    rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: "" });
  } catch {
    return { ...empty, error: "Couldn't read the file. Upload a .csv, .xlsx, or .xls." };
  }

  if (!rows.length) return { ...empty, error: "The file is empty." };

  // Locate the header row: one cell name-ish AND one phone-ish.
  let headerIdx = rows.findIndex(
    (r) => Array.isArray(r) && r.some((c) => NAME_RE.test(String(c))) && r.some((c) => PHONE_RE.test(String(c))),
  );
  let nameCol = -1;
  let phoneCol = -1;
  let nameHeader: string | null = null;
  let phoneHeader: string | null = null;

  if (headerIdx >= 0) {
    const header = rows[headerIdx];
    phoneCol = header.findIndex((c) => PHONE_RE.test(String(c)));
    nameCol = header.findIndex((c) => NAME_RE.test(String(c)));
    nameHeader = nameCol >= 0 ? String(header[nameCol]) : null;
    phoneHeader = phoneCol >= 0 ? String(header[phoneCol]) : null;
  } else {
    // No recognizable header — infer columns from the data itself.
    headerIdx = -1;
    const width = Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 0)));
    let bestPhoneCol = -1, bestPhoneHits = 0;
    for (let c = 0; c < width; c++) {
      const hits = rows.filter((r) => looksLikePhone(r?.[c])).length;
      if (hits > bestPhoneHits) { bestPhoneHits = hits; bestPhoneCol = c; }
    }
    if (bestPhoneCol < 0 || bestPhoneHits === 0) {
      return { ...empty, error: "Couldn't find a phone column. Add a header like \"Phone\"." };
    }
    phoneCol = bestPhoneCol;
    // name = first non-phone column that has some text
    for (let c = 0; c < width; c++) {
      if (c === phoneCol) continue;
      if (rows.some((r) => String(r?.[c] ?? "").trim() && !looksLikePhone(r?.[c]))) { nameCol = c; break; }
    }
  }

  if (phoneCol < 0) {
    return { ...empty, error: "Couldn't find a phone column. Add a header like \"Phone\"." };
  }

  const dataRows = headerIdx >= 0 ? rows.slice(headerIdx + 1) : rows;
  const leads: ParsedLead[] = [];
  const skipped: SkippedRow[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let totalRows = 0;

  dataRows.forEach((r, i) => {
    const rawNameCell = nameCol >= 0 ? r?.[nameCol] : "";
    const rawPhoneCell = r?.[phoneCol];
    const rawName = String(rawNameCell ?? "").trim();
    const rawPhone = String(rawPhoneCell ?? "").trim();
    // fully-blank row → ignore silently
    if (!rawName && !rawPhone) return;
    totalRows++;
    const sheetRow = (headerIdx >= 0 ? headerIdx + 1 : 0) + i + 1;

    const phone = cleanPhone(rawPhoneCell);
    if (!phone) {
      skipped.push({ row: sheetRow, rawName, rawPhone, reason: rawPhone ? "Invalid phone" : "No phone" });
      return;
    }
    const key = phoneKey(phone);
    if (seen.has(key)) { duplicates++; return; }
    seen.add(key);

    leads.push({ name: cleanLeadName(rawNameCell), rawName, phone });
  });

  const trimmed = leads.slice(0, MAX_LEADS);
  return {
    ok: true,
    leads: trimmed,
    totalRows,
    noNameCount: trimmed.filter((l) => !l.name).length,
    duplicates,
    skipped,
    nameHeader,
    phoneHeader,
    ...(leads.length > MAX_LEADS ? { error: undefined } : {}),
  };
}
