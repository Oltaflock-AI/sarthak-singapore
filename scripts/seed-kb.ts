// One-shot seed for kb_projects. Run after `supabase/kb_projects.sql` is executed.
// Usage: npx tsx scripts/seed-kb.ts

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY"); process.exit(1); }

const supabase = createClient(url, key);

const seed = [
  { slug: "grand-virasat", name: "Grand Virasat", type: "Residential", configurations: "2 BHK · 3 BHK", location: "Mhow Main Road", possession: "Dec 2026", hero: "Flagship residential — RERA approved.", display_order: 1 },
  { slug: "singapore-pink-city", name: "Singapore Pink City", type: "Residential", configurations: "3 BHK", location: "Mhow Main Road", possession: "Dec 2026", hero: "Premium 3 BHK living near Mhow main road.", display_order: 2 },
  { slug: "modern-city", name: "Modern City", type: "Residential", configurations: "Plots & Flats", location: "Mhow", possession: "Phased", hero: "Plotted development with modern amenities.", display_order: 3 },
  { slug: "oracle-city", name: "Oracle City", type: "Commercial", configurations: "Shops · Showrooms", location: "Mhow Main Road", possession: "2027", hero: "Premium-frontage commercial address.", display_order: 4 },
  { slug: "one-street", name: "One Street", type: "Commercial", configurations: "Retail · Office", location: "Mhow", possession: "Phased", hero: "High-street retail in the heart of Mhow.", display_order: 5 },
  { slug: "king-estate", name: "King Estate", type: "Residential", configurations: "Premium Villas", location: "Mhow", possession: "Phased", hero: "Premium villa estate.", display_order: 6 },
];

async function main() {
  for (const row of seed) {
    const { error } = await supabase.from("kb_projects").upsert(row, { onConflict: "slug" });
    if (error) console.error(row.slug, error.message);
    else console.log("✓", row.slug);
  }
}
main();
