// Zoho CRM (India DC) client: refresh-token OAuth + Leads read / write-back.
//
// Access tokens live ~1 hour; we mint one from the permanent refresh token and
// cache it in memory, refreshing on demand. All API calls hit v8 and carry
// `Authorization: Zoho-oauthtoken <access_token>`.
//
// Env (see .env.example):
//   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN
//   ZOHO_ACCOUNTS_DOMAIN (default accounts.zoho.in), ZOHO_API_DOMAIN (default www.zohoapis.in)

// Accept "https://www.zohoapis.in", "www.zohoapis.in/", or bare host → bare host.
function host(v: string | undefined, fallback: string): string {
  const s = (v ?? "").trim();
  if (!s) return fallback;
  return s.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const ACCOUNTS = host(process.env.ZOHO_ACCOUNTS_DOMAIN, "accounts.zoho.in");
const API = host(process.env.ZOHO_API_DOMAIN, "www.zohoapis.in");

let cached: { token: string; exp: number } | null = null;

// A valid access token, refreshed from the refresh token when expired.
export async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const res = await fetch(`https://${ACCOUNTS}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: required("ZOHO_REFRESH_TOKEN"),
      client_id: required("ZOHO_CLIENT_ID"),
      client_secret: required("ZOHO_CLIENT_SECRET"),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Zoho token refresh failed (${res.status}): ${JSON.stringify(data)}`);
  }
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function crm(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  return fetch(`https://${API}/crm/v8/${path}`, {
    ...init,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

interface ZohoLead {
  id: string;
  Project_Name?: string;
  [k: string]: unknown;
}

// Normalized lead for the dialer.
export interface MiracleLead {
  zohoId: string;
  name: string | null;
  phone: string | null;
  temperature: string | null; // Hot / Warm / Cold, from Enquiry_For1
  status: string | null;      // Lead_Status
}

// Fields we pull. Zoho v8 REQUIRES an explicit `fields` param on list calls
// (omitting it → HTTP 400 REQUIRED_PARAM_MISSING).
const LEAD_FIELDS = [
  "Full_Name", "First_Name", "Last_Name", "Phone", "Mobile", "Email",
  "Project_Name", "Enquiry_For1", "Lead_Source", "Lead_Status", "City",
].join(",");

// Sarthak's CRM holds ~30k leads across ~60 projects; "Singapore Miracle" is the
// subset whose Project_Name contains "Miracle" (~1k leads, some multi-project
// like "Miracle,Marina"). Filter on the structured field, NOT a free-text search.
function isMiracle(lead: ZohoLead): boolean {
  return String(lead.Project_Name ?? "")
    .split(",")
    .some((p) => p.trim().toLowerCase() === "miracle");
}

// Human callers mark leads they couldn't reach as Lead_Status = "Not Answer".
// That subset (~286 Miracle leads) is what the AI dialer chases.
export const NOT_ANSWER = "not answer";

function normalize(l: ZohoLead): MiracleLead {
  const str = (v: unknown) => (v == null ? "" : String(v).trim());
  const name = str(l.Full_Name) || [str(l.First_Name), str(l.Last_Name)].filter(Boolean).join(" ");
  const enquiry = str(l.Enquiry_For1);
  return {
    zohoId: l.id,
    name: name || null,
    phone: str(l.Phone) || str(l.Mobile) || null,
    temperature: enquiry ? enquiry.split("-")[0].trim() : null,
    status: str(l.Lead_Status) || null,
  };
}

// All Singapore Miracle leads whose Lead_Status == "Not Answer". Full page_token
// scan of the module (search criteria hard-caps at 2000, which would miss some),
// so this is heavy but the target set is small and the sync runs infrequently.
export async function getMiracleNoAnswerLeads(): Promise<MiracleLead[]> {
  const out: MiracleLead[] = [];
  let token: string | null = null;
  for (let page = 0; page < 250; page++) {
    const qs = new URLSearchParams({ fields: LEAD_FIELDS, per_page: "200" });
    if (token) qs.set("page_token", token);
    const res = await crm(`Leads?${qs.toString()}`);
    if (res.status === 204) break;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Zoho getMiracleNoAnswerLeads failed (${res.status}): ${JSON.stringify(data)}`);
    for (const l of (data.data ?? []) as ZohoLead[]) {
      if (isMiracle(l) && String(l.Lead_Status ?? "").toLowerCase() === NOT_ANSWER) out.push(normalize(l));
    }
    token = data.info?.next_page_token ?? null;
    if (!data.info?.more_records || !token) break;
  }
  return out;
}

// Write fields back onto a lead (e.g. call outcome / score / next follow-up).
export async function updateLead(id: string, fields: Record<string, unknown>): Promise<void> {
  const res = await crm("Leads", {
    method: "PUT",
    body: JSON.stringify({ data: [{ id, ...fields }] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.data?.[0]?.status === "error") {
    throw new Error(`Zoho updateLead failed (${res.status}): ${JSON.stringify(data)}`);
  }
}

// Attach a Note (call summary + recording link) to a lead.
export async function addLeadNote(leadId: string, title: string, content: string): Promise<void> {
  const res = await crm("Notes", {
    method: "POST",
    body: JSON.stringify({
      data: [{ Note_Title: title, Note_Content: content, Parent_Id: leadId, se_module: "Leads" }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.data?.[0]?.status === "error") {
    throw new Error(`Zoho addLeadNote failed (${res.status}): ${JSON.stringify(data)}`);
  }
}
