
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/next-auth";
type Context = { params: Promise<{ path?: string[] }> };
async function proxy(req: NextRequest, context: Context) {
  const error = (message: string, status: number) =>
    NextResponse.json({ message }, { status, headers: { "Cache-Control": "no-store" } });
  const { path = [] } = await context.params;
  const id = (s: string) => /^[1-9]\d*$/.test(s);
  const root = path.length === 0,
    sheet = path.length === 1 && id(path[0]);
  const itemDelete =
    path.length === 3 && id(path[0]) && path[1] === "items" && id(path[2]);
  const action =
    path.length === 2 && id(path[0]) && ["finalize", "copy", "archive"].includes(path[1]) ||
    path.length === 4 && id(path[0]) && path[1] === "items" && id(path[2]) && path[3] === "archive";
  const image =
    path.length === 5 &&
    id(path[0]) &&
    path[1] === "items" &&
    id(path[2]) &&
    path[3] === "images" &&
    ["ORIGINAL", "PACKAGED"].includes(path[4]);
  const allowed = root
    ? ["GET", "POST"]
    : sheet
      ? ["GET", "PUT", "DELETE"]
      : itemDelete
        ? ["DELETE"]
        : action
          ? ["POST"]
          : image
            ? ["GET", "PUT", "DELETE"]
            : [];
  if (!allowed.includes(req.method))
    return error("Invalid costing API path/method.", 400);
  if (req.method !== "GET") {
    const origin = req.headers.get("origin");
    if (
      req.headers.get("sec-fetch-site") === "cross-site" ||
      (origin && origin !== new URL(req.url).origin)
    )
      return error("Cross-origin mutation rejected.", 403);
  }
  const session = await getServerSession(authOptions);
  const token = (session as unknown as { accessToken?: string } | null)?.accessToken;
  if (!token) return error("Session expired. Sign in again.", 401);
  const q = new URLSearchParams();
  if (root && req.method === "GET")
    for (const key of ["page", "size", "search", "status"]) {
      const v = req.nextUrl.searchParams.get(key);
      if (v !== null) q.set(key, v);
    }
  if (sheet && req.method === "GET" && req.nextUrl.searchParams.has("includeArchived")) {
    const value = req.nextUrl.searchParams.get("includeArchived");
    if (value !== "true" && value !== "false") return error("Invalid includeArchived value.", 400);
    q.set("includeArchived", value);
  }
  if (req.method === "DELETE" || (image && req.method === "PUT")) {
    const v = req.nextUrl.searchParams.get("version");
    if (v === null || !/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)))
      return error("A valid current version is required.", 400);
    q.set("version", v);
  }
  let body: BodyInit | undefined;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token.replace(/^Bearer\s+/i, "")}`,
    Accept: image && req.method === "GET" ? "image/jpeg,image/png" : "application/json",
  };
  if (image && req.method === "PUT") {
    if (Number(req.headers.get("content-length") || 0) > 6 * 1024 * 1024)
      return error("Photo request too large.", 413);
    try {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024)
        return error("Image file must be at most 5 MiB.", 400);
      const clean = new FormData();
      clean.append("file", file, "photo.jpg");
      body = clean;
    } catch {
      return error("Invalid photo upload.", 400);
    }
  } else if (["POST", "PUT"].includes(req.method)) {
    try {
      const text = await req.text();
      if (text.length > 1024 * 1024) return error("Costing request too large.", 413);
      const input = JSON.parse(text);
      if (!input || typeof input !== "object" || Array.isArray(input))
        return error("JSON object required.", 400);
      body = JSON.stringify(input);
      headers["Content-Type"] = "application/json";
    } catch {
      return error("Invalid JSON.", 400);
    }
  }
  try {
    const base = (
      process.env.REMOTE_API_BASE_URL ||
      process.env.NEXT_PUBLIC_API_BASE_URL ||
      "http://localhost:8080"
    ).replace(/\/+$/, "");
    const url = `${base.endsWith("/api") ? base : `${base}/api`}/factory/costings${path.length ? `/${path.join("/")}` : ""}${q.size ? `?${q}` : ""}`;
    const response = await fetch(url, {
      method: req.method,
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(35000),
    });
    if (response.status === 204)
      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "no-store" },
      });
    if (image && req.method === "GET" && response.ok) {
      const type = response.headers.get("content-type") || "";
      if (!["image/jpeg", "image/png"].includes(type.split(";")[0]))
        return error("Unexpected image response.", 502);
      return new Response(await response.arrayBuffer(), {
        status: 200,
        headers: {
          "Content-Type": type,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const payload = await response.json().catch(() => null);
    return NextResponse.json(
      payload || {
        message: "Unexpected backend response. Reload the server record before retrying.",
      },
      {
        status: response.ok && !payload ? 502 : response.status,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return error(
      "Backend connection failed. A write may already have completed; check server records before retrying.",
      502,
    );
  }
}
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
