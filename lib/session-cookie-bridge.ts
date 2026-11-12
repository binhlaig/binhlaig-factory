
import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { NextRequest } from "next/server";

type CookieScope = AsyncLocalStorage<{ cookies: string[]; headers: Headers; forceRefresh?: boolean }>;
const processState = globalThis as typeof globalThis & { __posCookieScope?: CookieScope };
const scope: CookieScope = processState.__posCookieScope ??= new AsyncLocalStorage<{ cookies: string[]; headers: Headers; forceRefresh?: boolean }>();
export function isSessionRefreshRequested() { return scope.getStore()?.forceRefresh === true; }
export function captureRefreshCookie(response: Response) {
  const store = scope.getStore();
  if (!store) return;
  for (const cookie of response.headers.getSetCookie()) {
    if (cookie.startsWith("pos_refresh=") && /;\s*HttpOnly(?:;|$)/i.test(cookie))
      store.cookies.push(cookie);
  }
}
export function browserMetadataHeaders(): Record<string, string> {
  const headers = scope.getStore()?.headers;
  if (!headers) return {};
  const result: Record<string, string> = {};
  // Deployment proxy must strip/overwrite forwarding/geo headers before they reach Next.js.
  for (const name of [
    "user-agent",
    "cf-connecting-ip",
    "x-forwarded-for",
    "x-real-ip",
    "cf-ipcountry",
    "x-geo-region",
    "x-geo-city",
  ]) {
    const value = headers.get(name);
    if (value) result[name] = value.slice(0, 1024);
  }
  return result;
}
export function withRefreshCookieBridge(
  handler: (request: NextRequest, context: unknown) => Promise<Response>,
  forceRefresh = false,
) {
  return async (request: NextRequest, context: unknown) => {
    const state = { cookies: [] as string[], headers: request.headers, forceRefresh };
    return scope.run(state, async () => {
      const response = await handler(request, context);
      for (const cookie of state.cookies) response.headers.append("Set-Cookie", cookie);
      if (state.cookies.length) response.headers.set("Cache-Control", "no-store");
      return response;
    });
  };
}

