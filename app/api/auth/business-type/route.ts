import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/next-auth";
// export const dynamic = "force-dynamic";
// export const runtime = "nodejs";
function reply(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const auth = session as (typeof session & { accessToken?: string; error?: string });
    if (auth?.error && auth.error !== "AccessTokenExpired") return reply({ error: "Session refresh temporarily unavailable" }, 503);
    if (!auth?.accessToken || auth.error === "AccessTokenExpired") return reply({ error: "Login required" }, 401);
    const base = (process.env.REMOTE_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080").replace(/[/]+$/, "");
    // Do not authorize using cached localStorage or stale business type claims.
    // Existing getMyShop()/ShopSettings contract owns businessType (not the user profile).
    const response = await fetch(`${base}/api/me/shop`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` }, cache: "no-store",
      signal: AbortSignal.timeout(10000), redirect: "error",
    });
    if (response.status === 401 || response.status === 403) return reply({ error: "Access denied" }, response.status);
    if (!response.ok) return reply({ error: "Business access service unavailable" }, 502);
    const profile: unknown = await response.json();
    const businessType = profile && typeof profile === "object" && "businessType" in profile ? profile.businessType : null;
    return reply({ businessType: typeof businessType === "string" ? businessType : null });
  } catch { return reply({ error: "Business access service unavailable" }, 503); }
}
