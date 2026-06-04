import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service role client — server-side only, bypasses RLS.
// Created lazily so importing this module never throws when env vars are absent
// (e.g. during Next's build-time page-data collection). The client is only
// instantiated on first actual use, by which point runtime env is available.
let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY are not set");
    _client = createClient(url, key);
  }
  return _client;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getClient();
    const value = client[prop as keyof SupabaseClient];
    return typeof value === "function" ? value.bind(client) : value;
  },
});
