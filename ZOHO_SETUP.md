# Connecting Zoho CRM to the AI Calling System

This is a **one-time setup** (about 5 minutes) that lets our AI calling system
read new leads from your Zoho CRM and write the call results back into it —
automatically, both ways.

You only do **Part 1** below. Send us the three items at the end and we handle
the rest.

---

## Part 1 — For the Sarthak Singapore team (do this in Zoho)

You'll create something called a **"Self Client"**. Think of it as a secure
key that lets our system talk to your Zoho account without anyone having to log
in each time. Nothing is exposed to the public — only we get the key.

### Steps

1. **Open the Zoho API Console**
   Go to **https://api-console.zoho.in** and sign in with your Zoho CRM
   **admin** account.
   *(The `.in` matters — your account is on Zoho's India servers.)*

2. **Create the Self Client**
   - Click **Self Client**
   - Click **Create Now**
   - Zoho instantly shows you a **Client ID** and a **Client Secret**.
     Keep this tab open.

3. **Set the permissions (scopes)**
   - Go to the **Generate Code** tab.
   - In the **Scope** box, paste this line exactly:

     ```
     ZohoCRM.modules.leads.READ,ZohoCRM.modules.leads.UPDATE,ZohoCRM.modules.notes.CREATE,ZohoCRM.coql.READ,ZohoCRM.settings.fields.READ
     ```

   - Set **Time Duration** to **10 minutes**.
   - Add any description (e.g. "AI Calling System").
   - Click **Create** / **Generate**.
   - Zoho shows a **Grant Code** — copy it.

4. **Send us three things** (please do this **within 10 minutes**, because the
   grant code expires quickly):
   1. **Client ID**
   2. **Client Secret**
   3. **Grant Code**

   > If 10 minutes feels tight, just message us first and we'll hop on a quick
   > call — you generate the code and we grab it live.

That's everything on your side. Once we have those three items, the connection
is permanent and you never have to repeat this.

### What these permissions allow (in plain terms)

We asked for the **minimum** needed — nothing more:

| Permission | What it lets the system do |
|---|---|
| Read Leads | See new leads so the AI can call them |
| Update Leads | Write the call result back onto the lead |
| Create Notes | Attach a call summary + recording link to the lead |
| Query Leads | Efficiently find only the leads that changed |
| Read Fields | Match your field names correctly during setup |

We intentionally did **not** ask for access to anything else in your CRM
(deals, contacts, reports, etc.).

### Two quick things to confirm

- **A dedicated user is best.** If possible, do the steps above logged in as a
  dedicated **"Integration"** user in Zoho (with permission to view and edit
  Leads), rather than a personal employee login. That way the connection keeps
  working even if a team member leaves.
- **Field mapping.** Tell us which fields in your Leads hold the **name,
  phone, project, budget, and timeline**. We'll also suggest adding two small
  custom fields — **Call Outcome** and **Next Follow-up** — so the AI's results
  have a clean place to land.

---

## Part 2 — For the Oltaflock team (technical, internal)

Everything below runs on our side. Included here so the setup is documented in
one place.

### Data center

Sarthak is on the **India** data center. All domains are `.in`:

- Accounts / OAuth: `accounts.zoho.in`
- API: `www.zohoapis.in`
- API version: **v8** (current)
- Auth header on every API call: `Authorization: Zoho-oauthtoken <access_token>`

If the client's CRM URL turns out to be `crm.zoho.com` instead of `crm.zoho.in`,
swap every `.in` below for `.com`.

### One-time: grant code → refresh token

The client's grant code is short-lived. Exchange it once for a **refresh
token**, which never expires:

```bash
curl -X POST "https://accounts.zoho.in/oauth/v2/token" \
  -d "grant_type=authorization_code" \
  -d "client_id=$ZOHO_CLIENT_ID" \
  -d "client_secret=$ZOHO_CLIENT_SECRET" \
  -d "code=THE_GRANT_CODE"
# → save response.refresh_token as ZOHO_REFRESH_TOKEN
```

### Environment variables

```env
ZOHO_ACCOUNTS_DOMAIN=accounts.zoho.in
ZOHO_API_DOMAIN=www.zohoapis.in
ZOHO_CLIENT_ID=1000.xxxxxxxx
ZOHO_CLIENT_SECRET=xxxxxxxx
ZOHO_REFRESH_TOKEN=1000.xxxxxxxx      # obtained once above, then permanent
```

### Scopes requested

`ZohoCRM.modules.leads.READ`, `ZohoCRM.modules.leads.UPDATE`,
`ZohoCRM.modules.notes.CREATE`, `ZohoCRM.coql.READ`,
`ZohoCRM.settings.fields.READ`.
*(Add `ZohoCRM.modules.tasks.CREATE` later if we want to auto-create a Zoho Task
on a booked visit / hot transfer.)*

### How it plugs into the existing pipeline

The dialer already ingests from a source-agnostic queue
(`call_queue` → `lib/dialer.ts`). Zoho is just a new feeder:

- **Read:** poll `getLeads(modifiedSince)` (or a Zoho workflow webhook on
  lead-create for instant speed-to-lead) → upsert into `call_queue`, deduped by
  `phoneKey()`.
- **Write-back:** on call completion, `updateLead()` pushes outcome + score +
  next-follow-up onto the lead, and a Note carries the summary + recording link.

Access tokens last 1 hour — refresh on demand and cache in memory. See
`lib/zoho.ts` for the client.

### References

- [Zoho CRM API v8 — Scopes](https://www.zoho.com/crm/developer/docs/api/v8/scopes.html)
- [Zoho CRM API v8 — OAuth 2.0 Overview](https://www.zoho.com/crm/developer/docs/api/v8/oauth-overview.html)
- [Zoho CRM API v8 — Access & Refresh Tokens](https://www.zoho.com/crm/developer/docs/api/v8/access-refresh.html)
</content>
</invoke>
