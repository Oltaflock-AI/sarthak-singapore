import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

// Service role client — server-side only, bypasses RLS
export const supabase = createClient(supabaseUrl, supabaseServiceKey);
