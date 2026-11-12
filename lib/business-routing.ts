// Only authenticated backend data may be passed to these routing decisions.
export const SHOP_TYPES = ["SUPERMARKET", "RESTAURANT", "FASHION", "FRUIT", "BOTH"] as const;
export function homeForBusinessType(value: unknown): string | null {
  if (value === "FACTORY") return "/factory";
  return SHOP_TYPES.some(type => type === value) ? "/dashboard" : null;
}
export function safeInternalPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || [...value].some(c => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127 || c.charCodeAt(0) === 92)) return null;
  try {
    const url = new URL(value, "https://pos.internal");
    if (url.origin !== "https://pos.internal" || /%/.test(url.pathname)) return null;
    return url.pathname + url.search + url.hash;
  } catch { return null; }
}
export function isWithin(path: string, base: string) {
  return path === base || path.startsWith(base + "/");
}
export function destinationForBusinessType(type: unknown, callback?: string | null): string | null {
  const home = homeForBusinessType(type);
  if (!home) return null;
  const safe = safeInternalPath(callback);
  if (!safe) return home;
  const pathname = new URL(safe, "https://pos.internal").pathname;
  return isWithin(pathname, home) ? safe : home;
}
// The entry route resolves the account against the backend before choosing a home.
export function businessEntryPath(callback?: string | null) {
  const safe = safeInternalPath(callback);
  const pathname = safe ? new URL(safe, "https://pos.internal").pathname : "";
  return safe && (isWithin(pathname, "/factory") || isWithin(pathname, "/dashboard"))
    ? `/entry?next=${encodeURIComponent(safe)}` : "/entry";
}
export const factoryNavigation = [
  { title: "Overview", href: "/factory" },
  { title: "Receiving", href: "/factory/receiving" },
  { title: "Warehouse", href: "/factory/warehouse" },
  { title: "Production", href: "/factory/production" },
  { title: "Packing", href: "/factory/packing" },
  { title: "Shop Orders", href: "/factory/orders" },
  { title: "Dispatch", href: "/factory/dispatch" },
  { title: "Reports", href: "/factory/reports" },
  { title: "Settings", href: "/factory/settings" },
] as const;
export function activeFactoryRoute(pathname: string) {
  return [...factoryNavigation].sort((a, b) => b.href.length - a.href.length)
    .find(item => isWithin(pathname, item.href));
}
