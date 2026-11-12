
"use client";

import { useState, type ReactNode } from "react";


import { FactorySidebar } from "./factory-sidebar";
import { NavbarDemo } from "./navbarDemo";
export function FactoryShell({
  children,
}: {
  children: ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <main
      className="
        min-h-screen
        bg-gradient-to-br
        from-slate-50 via-white to-blue-50/50
        px-4 pt-[96px]
        text-slate-950
        transition-colors duration-300

        dark:from-[#0f172a]
        dark:via-[#111c30]
        dark:to-[#16243a]
        dark:text-slate-100
      "
    >
      <NavbarDemo
        variant="factory"
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() =>
          setSidebarCollapsed((previous) => !previous)
        }
        onOpenSidebar={() => setSidebarOpen(true)}
      />

      <FactorySidebar
        open={sidebarOpen}
        collapsed={sidebarCollapsed}
        onClose={() => setSidebarOpen(false)}
      />

      <div
        className={`
          min-h-[calc(100vh-96px)]
          transition-[margin] duration-300
          ${
            sidebarCollapsed
              ? "lg:ml-[92px]"
              : "lg:ml-[236px]"
          }
        `}
      >
        <div className="pb-6 pt-2 sm:px-2">{children}</div>
      </div>
    </main>
  );
}