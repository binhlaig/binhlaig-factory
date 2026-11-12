import { homeForBusinessType } from "./business-routing";
export type BusinessAccess =
  | { kind: "ready"; businessType: string }
  | { kind: "unauthenticated" }
  | { kind: "denied" }
  | { kind: "unknown" }
  | { kind: "error" };
export async function loadBusinessAccess(request: typeof fetch = fetch, signal?: AbortSignal): Promise<BusinessAccess> {
  try {
    const response = await request("/api/auth/business-type", { cache: "no-store", signal });
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "denied" };
    if (!response.ok) return { kind: "error" };
    const data: unknown = await response.json();
    const businessType = data && typeof data === "object" && "businessType" in data ? data.businessType : null;
    if (typeof businessType !== "string" || !homeForBusinessType(businessType)) return { kind: "unknown" };
    return { kind: "ready", businessType };
  } catch { return { kind: "error" }; }
}
