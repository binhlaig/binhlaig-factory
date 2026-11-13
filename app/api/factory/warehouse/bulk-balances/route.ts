import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/next-auth";
// GET /api/factory/warehouse/bulk-balances — fixed read-only upstream, server-held token.
export async function GET() {
  const error = (message: string, status: number) =>
    NextResponse.json(
      { message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  try {
    const session = await getServerSession(authOptions);
    const token = (session as unknown as { accessToken?: string } | null)
      ?.accessToken;
    if (!token) return error("Login ပြန်ဝင်ပါ။", 401);
    const base = (
      process.env.REMOTE_API_BASE_URL ||
      process.env.NEXT_PUBLIC_API_BASE_URL ||
      "http://localhost:8080"
    ).replace(/\/+$/, "");
    const upstream = await fetch(
      `${base.endsWith("/api") ? base : `${base}/api`}/factory/receivings/bulk-stock-balances`,
      {
        headers: {
          Authorization: `Bearer ${token.replace(/^Bearer\s+/i, "")}`,
          Accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(35000),
      },
    );
    const payload = await upstream.json().catch(() => null);
    if (payload === null)
      return error(
        "Bulk Stock API response ဖတ်မရပါ။",
        upstream.ok ? 502 : upstream.status,
      );
    return NextResponse.json(payload, {
      status: upstream.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return error("Bulk Stock server ချိတ်ဆက်မရပါ။ ပြန်စမ်းပါ။", 502);
  }
}
