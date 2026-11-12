


"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  LayoutDashboard, Package, Settings2, X, Factory,
  PackageOpen, Warehouse, Cog, Truck,PackageCheck, type LucideIcon,
  SquareLibrary,
} from "lucide-react";

type FactorySidebarProps = {
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
};


type SidebarItem = { title: string; href: string; icon: LucideIcon };

const sidebarItems: SidebarItem[] = [
  { title: "Overview", href: "/factory", icon: LayoutDashboard },
  { title: "Receiving", href: "/factory/receiving", icon: PackageOpen },
  { title: "Warehouse", href: "/factory/warehouse", icon: Warehouse },
  { title: "Production", href: "/factory/production", icon: Cog },
  { title: "Packing", href: "/factory/packing", icon: Package },
  { title: "Dispatch", href: "/factory/dispatch", icon: Truck },
  { title: "Costing", href: "/factory/costing", icon: PackageCheck },
  { title: "Library", href: "/factory/costing/products", icon: SquareLibrary }
];
const settingsItem: SidebarItem = {
  title: "Shop Settings", href: "/dashboard/settings", icon: Settings2,
};

export function FactorySidebar({ open, collapsed, onClose }: FactorySidebarProps) {
  const pathname = usePathname();
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);
  // Only the most specific matching route is highlighted.
  const activeHref = [...sidebarItems, settingsItem]
    .filter(({ href }) => pathname === href || (href !== "/factory" && pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  function renderItem(item: SidebarItem) {
    const Icon = item.icon;
    const active = item.href === activeHref;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onClose}
        title={collapsed ? item.title : undefined}
        aria-label={item.title}
        aria-current={active ? "page" : undefined}
        className={`group flex min-h-12 items-center gap-3 rounded-xl px-2.5 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${collapsed ? "lg:justify-center lg:px-0" : ""} ${active ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"}`}
      >
        <span className={`grid size-8 shrink-0 place-items-center rounded-lg border transition-colors duration-150 ${active ? "border-blue-200/70 bg-white text-blue-600 shadow-sm dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-300" : "border-slate-200/70 bg-slate-100/70 text-slate-500 group-hover:border-slate-300 group-hover:bg-white group-hover:text-slate-800 dark:border-white/5 dark:bg-white/5 dark:text-slate-400 dark:group-hover:border-white/10 dark:group-hover:bg-white/10 dark:group-hover:text-slate-200"}`}>
          <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <span className={`min-w-0 flex-1 whitespace-nowrap ${collapsed ? "lg:hidden" : ""}`}>{item.title}</span>
        {active && <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full bg-blue-600 dark:bg-blue-300 ${collapsed ? "lg:hidden" : ""}`} />}
      </Link>
    );
  }

  return (
    <>
      {open && <button type="button" aria-label="Close sidebar" onClick={onClose} className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm lg:hidden" />}
      <aside aria-label="Dashboard sidebar" className={`fixed bottom-4 left-4 top-[94px] z-[70] flex w-[270px] flex-col rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-900/5 transition-[width,transform] duration-300 ease-in-out motion-reduce:transition-none dark:border-white/10 dark:bg-slate-950 lg:z-40 lg:translate-x-0 ${collapsed ? "lg:w-[76px]" : "lg:w-[220px]"} ${open ? "translate-x-0" : "-translate-x-[calc(100%+2rem)]"}`}>
        <div className={`flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-4 dark:border-white/10 ${collapsed ? "lg:justify-center lg:px-2" : ""}`}>
          <Link href="/factory" onClick={onClose} aria-label="Binhlaig factory dashboard" className="flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-blue-500">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-900 text-white shadow-sm dark:bg-blue-500/15 dark:text-blue-300"><Factory size={21} strokeWidth={1.75} aria-hidden="true" /></span>
            <span className={`min-w-0 ${collapsed ? "lg:hidden" : ""}`}>
              <span className="block whitespace-nowrap text-sm font-bold text-slate-950 dark:text-white">Binhlaig Factory</span>
              <span className="mt-0.5 block whitespace-nowrap text-[11px] text-slate-500 dark:text-slate-400">Factory Dashboard</span>
            </span>
          </Link>
          <button type="button" aria-label="Close sidebar" onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10 lg:hidden"><X size={19} aria-hidden="true" /></button>
        </div>
        <nav aria-label="Main menu" className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden p-3">
          <p className={`mb-3 px-2.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 ${collapsed ? "lg:hidden" : ""}`}>Main menu</p>
          {sidebarItems.map(renderItem)}
        </nav>
        <div className="shrink-0 border-t border-slate-200 p-3 dark:border-white/10">
          {renderItem(settingsItem)}

        </div>
      </aside>
    </>
  );
}
