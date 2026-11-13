import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/next-auth";
type Context = { params: Promise<{ path?: string[] }> };
async function proxy(req: NextRequest, context: Context) {
  const error = (message: string, status: number) =>
    NextResponse.json(
      { message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  const { path = [] } = await context.params;
  const id = (s: string) =>
    /^[1-9]\d*$/.test(s) && Number.isSafeInteger(Number(s));
  const root = path.length === 0;
  const single = path.length === 1 && id(path[0]);
  const action =
    path.length === 2 && id(path[0]) && ["confirm", "cancel"].includes(path[1]);
  const staticRead =
    path.length === 1 && ["sources", "stock-balances"].includes(path[0]);
  const warehouses = path.length === 1 && path[0] === "warehouses";
  const warehouse =
    path.length === 2 && path[0] === "warehouses" && id(path[1]);
  const locations =
    path.length === 3 &&
    path[0] === "warehouses" &&
    id(path[1]) &&
    path[2] === "locations";
  const location =
    path.length === 4 &&
    path[0] === "warehouses" &&
    id(path[1]) &&
    path[2] === "locations" &&
    id(path[3]);
  const movements = path.length === 2 && id(path[0]) && path[1] === "movements";
  const allowed =
    root || warehouses || locations
      ? ["GET", "POST"]
      : single
        ? ["GET", "PUT"]
        : action
          ? ["POST"]
          : warehouse || location
            ? ["PUT"]
            : staticRead || movements
              ? ["GET"]
              : [];
  if (!allowed.includes(req.method))
    return error("Invalid receiving API path/method.", 400);
  if (req.method !== "GET") {
    const origin = req.headers.get("origin");
    if (
      origin !== new URL(req.url).origin ||
      req.headers.get("sec-fetch-site") === "cross-site"
    )
      return error("Same-origin request required.", 403);
  }
  const session = await getServerSession(authOptions);
  const token = (session as unknown as { accessToken?: string } | null)
    ?.accessToken;
  if (!token) return error("Session expired. Sign in again.", 401);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token.replace(/^Bearer\s+/i, "")}`,
    Accept: "application/json",
  };
  if (req.method === "POST" && (root || (action && path[1] === "confirm"))) {
    const key = req.headers.get("idempotency-key");
    if (!key || !/^[-A-Za-z0-9._:]{8,128}$/.test(key))
      return error("A valid Idempotency-Key is required.", 400);
    headers["Idempotency-Key"] = key;
  }
  let body: string | undefined;
  if (req.method !== "GET") {
    try {
      const raw = await req.text();
      if (raw.length > 65536) return error("Request too large.", 413);
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return error("JSON object required.", 400);
      body = JSON.stringify(parsed);
      headers["Content-Type"] = "application/json";
    } catch {
      return error("Invalid JSON.", 400);
    }
  }
  const query = new URLSearchParams();
  const keys = root
    ? [
        "page",
        "size",
        "status",
        "from",
        "to",
        "receivingNumber",
        "barcode",
        "batch",
      ]
    : staticRead && path[0] === "sources"
      ? ["barcode"]
      : [];
  for (const k of keys) {
    const v = req.nextUrl.searchParams.get(k);
    if (v !== null) query.set(k, v);
  }
  try {
    const base = (
      process.env.REMOTE_API_BASE_URL ||
      process.env.NEXT_PUBLIC_API_BASE_URL ||
      "http://localhost:8080"
    ).replace(/\/+$/, "");
    const url = `${base.endsWith("/api") ? base : `${base}/api`}/factory/receivings${path.length ? `/${path.join("/")}` : ""}${query.size ? `?${query}` : ""}`;
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(35000),
      redirect: "error",
    });
    const payload = await upstream.json().catch(() => null);
    return NextResponse.json(
      payload ?? {
        message:
          "Invalid backend response. Check the server record before retrying.",
      },
      {
        status: upstream.ok && payload === null ? 502 : upstream.status,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return error(
      "Backend connection failed. The operation may have completed; check or retry with the same idempotency key.",
      502,
    );
  }
}
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
