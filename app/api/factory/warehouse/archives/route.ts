import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/next-auth";

async function proxy(request: NextRequest) {
  const fail = (message: string, status: number) => NextResponse.json({message},{status,headers:{"Cache-Control":"no-store"}});
  const method=request.method;
  if(!["GET","POST","DELETE"].includes(method))return fail("Method not allowed",405);
  const writing = method !== "GET";
  if (
    writing &&
    (request.headers.get("origin") !== request.nextUrl.origin ||
      request.headers.get("sec-fetch-site") === "cross-site")
  )
    return fail("Allowed Origin required", 403);
  const headers = new Headers({ Accept: "application/json" });
  if (writing) {
    if (
      !(request.headers.get("content-type") || "").includes("application/json")
    )
      return fail("JSON body required", 415);
    headers.set("Content-Type", "application/json");
  }
  try {
    const session = await getServerSession(authOptions);
    const token = (session as unknown as { accessToken?: string } | null)
      ?.accessToken;
    if (!token) return fail("Login ပြန်ဝင်ပါ။", 401);
    headers.set("Authorization", `Bearer ${token.replace(/^Bearer\s+/i, "")}`);
    let body: string | undefined;
    if (writing) {
      // Bound the stream itself; Content-Length is optional and untrusted.
      const reader = request.body?.getReader();
      if (!reader) return fail("Body required", 400);
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 16384) {
          await reader.cancel();
          return fail("Body too large", 413);
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      body = new TextDecoder().decode(bytes);
      try {
        JSON.parse(body);
      } catch {
        return fail("Invalid JSON", 400);
      }
    }
    const base = (
      process.env.REMOTE_API_BASE_URL ||
      process.env.NEXT_PUBLIC_API_BASE_URL ||
      "http://localhost:8080"
    ).replace(/\/+$/, "");
    const upstream = new URL(`${base.endsWith("/api")?base:`${base}/api`}/factory/warehouse/archives`);
    if(request.nextUrl.search)return fail("Unknown query",400);
    const res = await fetch(upstream, {
      method,
      headers,
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(25000),
    });
    const payload = await res.json().catch(() => null);
    if (payload === null) return fail("Warehouse Archive API response ဖတ်မရပါ။", 502);
    return NextResponse.json(payload, {
      status: res.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return fail(
      "Warehouse Archive server ဆက်သွယ်မှု မပြည့်စုံပါ။ စာရင်းပြန်ယူပြီး ရလဒ်ကို စစ်ပါ။",
      502,
    );
  }
}
export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
