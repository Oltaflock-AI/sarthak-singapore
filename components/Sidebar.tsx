"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLiveData, bucketByScore } from "@/lib/data";
import { ThemeToggle } from "@/components/ThemeToggle";

const ICONS = {
  overview: (
    <svg className="sb-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" /><rect x="11.5" y="2.5" width="6" height="6" rx="1.5" />
      <rect x="2.5" y="11.5" width="6" height="6" rx="1.5" /><rect x="11.5" y="11.5" width="6" height="6" rx="1.5" />
    </svg>
  ),
  voice: (
    <svg className="sb-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 3.5h2l1.2 3-1.4 1c.7 1.6 2 2.9 3.6 3.6l1-1.4 3 1.2v2c0 .8-.7 1.5-1.5 1.5-6 0-11-5-11-11 0-.8.7-1.5 1.5-1.5z" />
    </svg>
  ),
  leads: (
    <svg className="sb-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="3.5" width="4" height="13" rx="1" /><rect x="8" y="3.5" width="4" height="9" rx="1" /><rect x="13.5" y="3.5" width="4" height="6" rx="1" />
    </svg>
  ),
  visits: (
    <svg className="sb-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="14" height="13" rx="1.5" /><path d="M3 8h14" /><path d="M7 2v3M13 2v3" />
    </svg>
  ),
  dialer: (
    <svg className="sb-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 3.5h2l1.2 3-1.4 1c.7 1.6 2 2.9 3.6 3.6l1-1.4 3 1.2v2c0 .8-.7 1.5-1.5 1.5-6 0-11-5-11-11 0-.8.7-1.5 1.5-1.5z" />
      <path d="M13 2.5l4 4M17 2.5l-4 4" />
    </svg>
  ),
};

export function Sidebar() {
  const pathname = usePathname();
  const { calls } = useLiveData();
  const { hot } = bucketByScore(calls);

  const links: { href: string; label: string; icon: React.ReactNode; count?: number; pulse?: boolean }[] = [
    { href: "/", label: "Overview", icon: ICONS.overview },
    { href: "/calls", label: "Voice Calls", icon: ICONS.voice, count: calls.length },
    { href: "/dialer", label: "Dialer", icon: ICONS.dialer },
    { href: "/leads", label: "Leads", icon: ICONS.leads, count: hot.length, pulse: hot.length > 0 },
    { href: "/site-visits", label: "Site Visits", icon: ICONS.visits },
  ];

  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <div className="sb-mark" style={{ overflow: "hidden", padding: 0 }}>
          <img src="/logo.jpg" alt="Sarthak" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </div>
        <div className="sb-brand-text">
          <span className="name">Sarthak Singapore</span>
          <span className="sub">AI Sales Engine</span>
        </div>
      </div>

      <nav className="sb-nav">
        <div className="sb-nav-label">Workspace</div>
        {links.map((l) => {
          const active = pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href));
          return (
            <Link key={l.href} href={l.href} className={`sb-link${active ? " active" : ""}`}>
              {l.icon}
              <span>{l.label}</span>
              {typeof l.count === "number" && <span className="sb-count">{l.count}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="sb-foot">
        <div className="who">Khush</div>
        <div>admin@oltaflock.ai</div>
        <div style={{ marginTop: 10, fontSize: 10, letterSpacing: 0.4 }}>OLTAFLOCK · v1.0</div>
        <ThemeToggle />
        <form action="/api/logout" method="post" style={{ marginTop: 12 }}>
          <button
            type="submit"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--muted)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 3.5H4.5A1.5 1.5 0 0 0 3 5v10a1.5 1.5 0 0 0 1.5 1.5H7" />
              <path d="M13 14l4-4-4-4M17 10H8" />
            </svg>
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
