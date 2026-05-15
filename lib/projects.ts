// Sarthak Singapore project portfolio — source of truth for the Projects page.
// From the Oltaflock × Sarthak Singapore proposal (April 2026).

export type ProjectType = "Residential" | "Commercial" | "Mixed";

export interface Project {
  slug: string;
  name: string;
  type: ProjectType;
  configurations: string;
  location: string;
  possession: string;
  hero: string; // short tagline
}

export const PROJECTS: Project[] = [
  {
    slug: "grand-virasat",
    name: "Grand Virasat",
    type: "Residential",
    configurations: "2 BHK · 3 BHK",
    location: "Mhow Main Road",
    possession: "Dec 2026",
    hero: "Flagship residential — RERA approved.",
  },
  {
    slug: "singapore-pink-city",
    name: "Singapore Pink City",
    type: "Residential",
    configurations: "3 BHK",
    location: "Mhow Main Road",
    possession: "Dec 2026",
    hero: "Premium 3 BHK living near Mhow main road.",
  },
  {
    slug: "modern-city",
    name: "Modern City",
    type: "Residential",
    configurations: "Plots & Flats",
    location: "Mhow",
    possession: "Phased",
    hero: "Plotted development with modern amenities.",
  },
  {
    slug: "oracle-city",
    name: "Oracle City",
    type: "Commercial",
    configurations: "Shops · Showrooms",
    location: "Mhow Main Road",
    possession: "2027",
    hero: "Premium-frontage commercial address.",
  },
  {
    slug: "one-street",
    name: "One Street",
    type: "Commercial",
    configurations: "Retail · Office",
    location: "Mhow",
    possession: "Phased",
    hero: "High-street retail in the heart of Mhow.",
  },
  {
    slug: "king-estate",
    name: "King Estate",
    type: "Residential",
    configurations: "Premium Villas",
    location: "Mhow",
    possession: "Phased",
    hero: "Premium villa estate.",
  },
];

export const getProjectByName = (name: string | null | undefined): Project | undefined => {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  return PROJECTS.find((p) =>
    lower.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(lower.split("·")[0].trim())
  );
};
