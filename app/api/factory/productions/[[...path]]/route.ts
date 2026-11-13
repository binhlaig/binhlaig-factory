import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/next-auth";
type Context = { params: Promise<{ path?: string[] }> };
async function proxy(request: NextRequest, context: Context) {
  const fail = (message: string, status: number) =>
    NextResponse.json(
      { message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  const path = (await context.params).path ?? [],
    method = request.method;
  const id = path.length >= 1 && /^[1-9]\d*$/.test(path[0]);
  const allowed =
    path.length === 0
      ? ["GET", "POST"]
      : path.length === 1 && id
        ? ["GET", "PUT"]
        : path.length === 2 && id && ["confirm", "cancel"].includes(path[1])
          ? ["POST"]
          : [];
  if (!allowed.includes(method))
    return fail("Production endpoint မရှိပါ။", 404);
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
  if (method === "POST" && (path.length === 0 || path[1] === "confirm")) {
    const key = request.headers.get("idempotency-key") || "";
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key))
      return fail("Invalid Idempotency-Key", 400);
    headers.set("Idempotency-Key", key);
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
        if (length > 65536) {
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
    const upstream = new URL(
      `${base.endsWith("/api") ? base : `${base}/api`}/factory/productions${path.length ? `/${path.join("/")}` : ""}`,
    );
    if (method === "GET" && path.length === 0)
      for (const [k, v] of request.nextUrl.searchParams) {
        if (
          ![
            "page",
            "size",
            "status",
            "from",
            "to",
            "barcode",
            "outputBatch",
          ].includes(k)
        )
          return fail("Unknown query", 400);
        upstream.searchParams.append(k, v);
      }
    const res = await fetch(upstream, {
      method,
      headers,
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(25000),
    });
    const payload = await res.json().catch(() => null);
    if (payload === null) return fail("Production API response ဖတ်မရပါ။", 502);
    return NextResponse.json(payload, {
      status: res.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return fail(
      "Production server ဆက်သွယ်မှု မပြည့်စုံပါ။ Request တူကိုသာ ပြန်စမ်းပါ။",
      502,
    );
  }
}
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
