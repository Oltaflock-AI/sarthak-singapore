import { Sidebar } from "@/components/Sidebar";

// Dashboard chrome (sidebar + main shell). Lives in the (dashboard) route group
// so the /login screen — which uses the bare root layout — renders without it.
export default function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="shell">
      <Sidebar />
      <main>
        {children}
        <footer className="foot">
          <span>Oltaflock × Sarthak Singapore</span>
          <span>AI Sales Engine · v1.0</span>
        </footer>
      </main>
    </div>
  );
}
