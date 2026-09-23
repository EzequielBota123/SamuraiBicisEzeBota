import { useState } from "react";
import AdminSidebar from "../../components/admin/AdminSidebar";
import AdminTopbar from "../../components/admin/AdminTopbar";

export default function AdminLayout({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50 text-slate-900 dark:bg-black dark:text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.12),_transparent_60%),radial-gradient(circle_at_bottom,_rgba(165,180,252,0.12),_transparent_55%)] dark:bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.1),_transparent_60%),radial-gradient(circle_at_bottom,_rgba(99,102,241,0.12),_transparent_55%)]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-sky-400 via-indigo-400 to-slate-300 dark:to-neutral-700" />

      <div
        className="relative z-10 min-h-screen lg:grid"
        style={{ gridTemplateColumns: collapsed ? "88px 1fr" : "300px 1fr" }}
      >
        {mobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        <aside
          className={`fixed inset-y-0 left-0 z-40 w-[280px] max-w-[85vw] transform overflow-y-auto border-r border-slate-200/80 bg-white shadow-2xl transition-transform duration-300 lg:sticky lg:top-0 lg:z-auto lg:min-h-screen lg:w-auto lg:max-w-none lg:translate-x-0 lg:bg-white/80 lg:shadow-none lg:backdrop-blur-xl dark:border-neutral-800/80 dark:bg-black dark:lg:bg-neutral-950/80 ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <AdminSidebar
            collapsed={collapsed}
            onToggle={() => setCollapsed(!collapsed)}
            onNavigate={() => setMobileOpen(false)}
          />
        </aside>

        <section className="flex min-h-screen min-w-0 flex-col">
          <AdminTopbar onToggleSidebar={() => setMobileOpen((v) => !v)} mobileOpen={mobileOpen} />
          <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8 lg:px-10">
            <div className="mx-auto max-w-[1400px] space-y-10">
              {children}
            </div>
          </main>
        </section>
      </div>
    </div>
  );
}
