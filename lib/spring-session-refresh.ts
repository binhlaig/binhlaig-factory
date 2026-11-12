import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { sessionIdentity, SessionIdentityError } from "@/lib/session-identity";



type FailureDetails = {

  upstreamStatus?: number | null;

  redisStatus?: number | null;

  safeToRetry?: boolean;

  cached?: boolean;

  originalReason?: string;

  configuration?: "APP_FRONTEND_ORIGIN" | "REMOTE_API_BASE_URL" | "SESSION_REDIS_REST_URL_OR_TOKEN" | "SESSION_REDIS_REST_URL" | "NEXTAUTH_SECRET";

};

export class SessionRefreshError extends Error {

  readonly name = "SessionRefreshError";

  readonly upstreamStatus: number | null;

  readonly redisStatus: number | null;

  readonly safeToRetry: boolean;

  readonly cached: boolean;

  readonly originalReason?: string;

  readonly configuration?: FailureDetails["configuration"];

  constructor(

    public readonly status: number,

message: string,

    public readonly reason: string = status === 401 ? "BACKEND_REFRESH_REJECTED" : "TEMPORARY_REFRESH_FAILURE",

details: FailureDetails = {},

  ) {

super(message);

this.upstreamStatus = details.upstreamStatus ?? null;

this.redisStatus = details.redisStatus ?? null;

this.safeToRetry = details.safeToRetry ?? false;

this.cached = details.cached ?? false;

this.originalReason = details.originalReason;

this.configuration = details.configuration;

  }

}

// Structural branding also recognizes errors retained across development reloads.

function isRefreshError(error: unknown): error is SessionRefreshError {

  return error instanceof SessionRefreshError || Boolean(error && typeof error === "object" &&

    (error as SessionRefreshError).name === "SessionRefreshError" &&

    typeof (error as SessionRefreshError).status === "number");

}

function failure(error: unknown): SessionRefreshError {

  return isRefreshError(error) ? error : new SessionRefreshError(503, "Session service unavailable.", "TEMPORARY_REFRESH_FAILURE");

}

function cachedFailure(error: unknown): SessionRefreshError {

  const original = failure(error);

  return new SessionRefreshError(original.status, original.message, "CACHED_REFRESH_FAILURE", {

    ...original, cached: true, originalReason: original.originalReason || original.reason,

  });

}

export function logRefreshFailure(error: unknown, stage: string) {

  const info = failure(error);

  // Deliberately exclude error.message, stack, URLs, response bodies and cache keys.

  console.error("[Session refresh]", {

    reason: info.reason, originalReason: info.originalReason ?? null, stage,

    upstreamStatus: info.upstreamStatus, redisStatus: info.redisStatus,

    cached: info.cached, safeToRetry: info.safeToRetry,

    configuration: info.configuration ?? null,

  });

}

export type RefreshedSession = {

  data: Record<string, unknown> & { token: string };

  refreshToken: string;

  cookies: string[];

};

export function refreshCookieFromResponse(response: Response): string | null {

  for (const cookie of response.headers.getSetCookie()) {

    const match = /^pos_refresh=([^;]+);/i.exec(cookie);

    if (match && /;\s*HttpOnly(?:;|$)/i.test(cookie)) {

      try { return decodeURIComponent(match[1]); } catch { return null; }

    }

  }

  return null;

}



type CacheEntry = { until: number; promise: Promise<RefreshedSession> };

type Release = { key: string; claim: string };

const processState = globalThis as typeof globalThis & {

  __posRefreshCache?: Map<string, CacheEntry>;

  __posRefreshReleases?: Map<string, Release>;

};

// Development reloads retain both aliases and cleanup for attempts known not consumed.

const cache = processState.__posRefreshCache ??= new Map<string, CacheEntry>();

const releases = processState.__posRefreshReleases ??= new Map<string, Release>();

const MAX_ENTRIES = 20000;

const LIFETIME = 64800;

function tokenExpiration(raw: string): number {

  try { return Number(JSON.parse(Buffer.from(raw.split(".")[1], "base64url").toString()).exp) * 1000; }

  catch { return 0; }

}

const RELEASE_CLAIM = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

async function releaseUnusedClaim(hash: string) {

  const release = releases.get(hash);

  if (!release) return;

  await redis(["EVAL", RELEASE_CLAIM, 1, release.key, release.claim]);

  if (releases.get(hash) === release) releases.delete(hash);

}

export async function refreshSpringSession(raw: string): Promise<RefreshedSession> {

  if (!raw) {

    const error = new SessionRefreshError(401, "Please sign in again.", "MISSING_REFRESH_CREDENTIAL");

    logRefreshFailure(error, "credential");

    throw error;

  }

  const key = createHash("sha256").update(raw).digest("hex");

  try {

    // A failed Redis cleanup must not strand a credential known not to have been

    // consumed. Retry the owned, atomic cleanup, never an uncertain upstream POST.

    await releaseUnusedClaim(key);

    const now = Date.now();

    for (const [hash, entry] of cache) if (entry.until <= now) cache.delete(hash);

    const existing = cache.get(key);

    if (existing) {

      let result: RefreshedSession;

      try { result = await existing.promise; } catch (error) { throw cachedFailure(error); }

      if (tokenExpiration(result.data.token) <= Date.now() + 30000)

        return await refreshSpringSession(result.refreshToken);

      return result;

    }

    if (cache.size >= MAX_ENTRIES)

      throw new SessionRefreshError(503, "Session service is busy. Try again shortly.", "REFRESH_CAPACITY");

    const promise = coordinatedRefresh(raw, key);

    const entry = { until: now + LIFETIME * 1000, promise };

    cache.set(key, entry);

    try {

      const result = await promise;

      const maxAge = /;\s*Max-Age=(\d+)/i.exec(result.cookies[0] || "");

      if (maxAge) entry.until = Math.min(entry.until, Date.now() + Number(maxAge[1]) * 1000);

      return result;

    } catch (error) {

      if (failure(error).safeToRetry && cache.get(key) === entry) cache.delete(key);

      // Timeout, HTTP 5xx and invalid success bodies may follow rotation. Retain

      // those failed promises instead of risking refresh-replay revocation.

      throw error;

    }

  } catch (error) {

    logRefreshFailure(error, "refresh");

    throw error;

  }

}



type RefreshConfig = { origin: string; endpoint: string; shared: boolean };

// Resolve complete pairs only: never send a token to another database's URL.
function redisConfig(): { endpoint: string; secret: string } | null {
  for (const [url, token] of [
    [process.env.SESSION_REDIS_REST_URL, process.env.SESSION_REDIS_REST_TOKEN],
    [process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN],
  ]) {
    const endpoint = url?.trim();
    const secret = token?.trim();
    if (endpoint && secret) return { endpoint, secret };
  }
  return null;
}

function refreshConfig(): RefreshConfig {

  let origin: string;

  let endpoint: string;

  try {

    const url = new URL(process.env.APP_FRONTEND_ORIGIN?.trim() || "");

    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();

    origin = url.origin;

  } catch {

    throw new SessionRefreshError(503, "Auth origin is missing or invalid.", "MISSING_CONFIGURATION", { safeToRetry: true, configuration: "APP_FRONTEND_ORIGIN" });

  }

  const configuredBase = process.env.REMOTE_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL;

  try {

    // A localhost default is only useful during local development.

    if (!configuredBase && (process.env.VERCEL || process.env.NODE_ENV === "production")) throw new Error();

    const base = new URL((configuredBase || "http://localhost:8080").replace(/\/+$/, "") + "/api/auth/refresh");

    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error();

    endpoint = base.href;

  } catch {

    throw new SessionRefreshError(503, "Auth backend URL is missing or invalid.", "MISSING_CONFIGURATION", { safeToRetry: true, configuration: "REMOTE_API_BASE_URL" });

  }

  const resolvedRedis = redisConfig();
  const shared = Boolean(resolvedRedis);

  if (!shared && (process.env.VERCEL || process.env.NODE_ENV === "production" || process.env.SESSION_REQUIRE_SHARED_STORE === "true"))

    throw new SessionRefreshError(503, "Configure shared session storage before using this deployment.", "MISSING_CONFIGURATION", { safeToRetry: true, configuration: "SESSION_REDIS_REST_URL_OR_TOKEN" });

  if (shared) {

    try {

      const url = new URL(resolvedRedis!.endpoint);

      if (url.protocol !== "https:" || url.username || url.password) throw new Error();

    } catch {

      throw new SessionRefreshError(503, "Shared session store requires a valid HTTPS URL.", "MISSING_CONFIGURATION", { safeToRetry: true, configuration: "SESSION_REDIS_REST_URL" });

    }

  }

  return { origin, endpoint, shared };

}

function connectionNotEstablished(error: unknown): boolean {

  // Only connection establishment errors prove that a POST was never sent.

  // ECONNRESET, socket/read/overall timeouts and generic fetch errors do not.

  const safe = ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"];

  const candidate = error as { code?: string; cause?: unknown; errors?: unknown[] } | null;

  if (!candidate || typeof candidate !== "object") return false;

  if (candidate.errors?.length) return candidate.errors.every(connectionNotEstablished);

  if (candidate.code && safe.includes(candidate.code)) return true;

  return candidate.cause ? connectionNotEstablished(candidate.cause) : false;

}

async function performRefresh(raw: string, config: RefreshConfig): Promise<RefreshedSession> {

  let response: Response;

  try {

    response = await fetch(config.endpoint, {

      method: "POST", headers: { Origin: config.origin, Cookie: `pos_refresh=${encodeURIComponent(raw)}`, Accept: "application/json" },

      cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(8000),

    });

  } catch (error) {

    const name = (error as { name?: string })?.name;

    const timeout = name === "TimeoutError" || name === "AbortError" ||

      (error as { cause?: { code?: string } })?.cause?.code === "UND_ERR_CONNECT_TIMEOUT";

    throw new SessionRefreshError(503, "Auth service unavailable. Try again shortly.", timeout ? "NETWORK_TIMEOUT" : "NETWORK_FAILURE", {

      safeToRetry: connectionNotEstablished(error),

    });

  }

  if (!response.ok) {

    // This exact response is emitted by SessionCookies.requireOrigin BEFORE

    // AuthService.refresh is called. An arbitrary 403 is NOT proof of non-consumption.

    let originRejected = false;

    if (response.status === 403 && !response.headers.getSetCookie().length) {

      const text = await response.text().catch(() => "");

      let body: { error?: string; message?: string; path?: string } | null = null;

      try { body = JSON.parse(text); } catch { /* Spring's CORS rejection is plain text. */ }

      // Spring's CORS filter also rejects before entering any controller. This

      // exact shape was verified against the local backend, without credentials.

      originRejected = text === "Invalid CORS request" || (body?.error === "FORBIDDEN" &&

        body?.message === "An allowed Origin is required" && body?.path === "/api/auth/refresh");

    }

    throw new SessionRefreshError(response.status === 401 ? 401 : 503,

      response.status === 401 ? "Session expired or revoked. Please sign in again." : "Unable to refresh session. Try again shortly.",

      response.status === 401 || response.status === 403 ? "BACKEND_REFRESH_REJECTED" : "BACKEND_REFRESH_FAILURE",

      { upstreamStatus: response.status, safeToRetry: originRejected });

  }

  const data: unknown = await response.json().catch(() => null);

  const token = data && typeof data === "object" && "token" in data &&
    typeof data.token === "string" ? data.token : null;
  const cookies = response.headers.getSetCookie();
  const next = refreshCookieFromResponse(response);
  const expiresAt = token ? tokenExpiration(token) : 0;
  const validExpiry = Number.isFinite(expiresAt) && expiresAt > Date.now();

  if (!token || !next || !validExpiry) {
    // Log presence/validity only. Never log credential, cookie, JWT or response contents.
    console.error("[Session refresh validation]", {
      status: response.status,
      hasToken: Boolean(token),
      hasRefreshCookie: cookies.some(cookie => /^pos_refresh=/i.test(cookie)),
      hasHttpOnlyCookie: cookies.some(cookie =>
        /^pos_refresh=/i.test(cookie) && /;\s*HttpOnly(?:;|$)/i.test(cookie)),
      cookieParsed: Boolean(next),
      validExpiry,
    });
    // An HTTP 200 can follow token rotation. Never replay an uncertain refresh.
    throw new SessionRefreshError(502, "Invalid authentication response.", "INVALID_REFRESH_RESPONSE", {
      upstreamStatus: response.status,
      safeToRetry: false,
    });
  }

  try { sessionIdentity(token); } catch (error) {

    throw new SessionRefreshError(502, "Invalid authentication identity.",

      error instanceof SessionIdentityError ? error.reason : "MISSING_IDENTITY_CLAIM", { upstreamStatus: response.status });

  }

  return { data: data as RefreshedSession["data"], refreshToken: next,
    cookies: cookies.filter(cookie => cookie.startsWith("pos_refresh=") && /;\s*HttpOnly(?:;|$)/i.test(cookie)) };

}



type SharedRecord =

  | { state: "pending"; owner?: string }

  | { state: "done"; result: RefreshedSession }

  | { state: "failed"; status: number; message?: string; reason?: string; upstreamStatus?: number | null; redisStatus?: number | null };

async function redis(command: (string | number)[]): Promise<unknown> {

  const config = redisConfig();
  if (!config)
    throw new SessionRefreshError(503, "Shared session store is not configured.", "MISSING_CONFIGURATION",
      { safeToRetry: true, configuration: "SESSION_REDIS_REST_URL_OR_TOKEN" });
  const { endpoint, secret } = config;

  // Cleanup can run before refreshConfig. Validate here too, before sending the

  // Redis Authorization header, even if configuration changed between attempts.

  try {

    const url = new URL(endpoint);

    if (url.protocol !== "https:" || url.username || url.password) throw new Error();

  } catch {

    throw new SessionRefreshError(503, "Shared session store requires a valid HTTPS URL.", "MISSING_CONFIGURATION",

      { safeToRetry: true, configuration: "SESSION_REDIS_REST_URL" });

  }

  try {

    const response = await fetch(endpoint, {

      method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },

      body: JSON.stringify(command), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),

    });

    if (!response.ok)

      throw new SessionRefreshError(503, "Shared session store unavailable.", "REDIS_FAILURE", { redisStatus: response.status, safeToRetry: true });

    const data = await response.json();

    if (data.error || !("result" in data)) throw new Error();

    return data.result;

  } catch (error) {

    if (isRefreshError(error)) throw error;

    throw new SessionRefreshError(503, "Shared session store unavailable.", "REDIS_FAILURE", { safeToRetry: true });

  }

}

async function coordinatedRefresh(raw: string, hash: string): Promise<RefreshedSession> {

  // Complete configuration validation BEFORE writing a pending Redis record.

  const config = refreshConfig();

  if (!config.shared) return performRefresh(raw, config);

  const key = `pos:refresh:v1:${hash}`;

  const claim = JSON.stringify({ state: "pending", owner: randomUUID() });

  // Retain cleanup before claiming: a lost SET acknowledgement cannot strand a

  // known unused claim in this worker. Cleanup compares the full owned record.

  releases.set(hash, { key, claim });

  const claimed = await redis(["SET", key, claim, "NX", "EX", LIFETIME]);

  if (claimed === "OK") {

    // From here on a cleanup is permitted only after proven non-consumption.

    releases.delete(hash);

    try {

      const result = await performRefresh(raw, config);

      const age = /;\s*Max-Age=(\d+)/i.exec(result.cookies[0] || "");

      const ttl = Math.max(1, Math.min(LIFETIME, Number(age?.[1] || LIFETIME)));

      await redis(["SET", key, JSON.stringify({ state: "done", result }), "EX", ttl]).catch(error => logRefreshFailure(error, "publish"));

      return result;

    } catch (error) {

      const info = failure(error);

      if (info.safeToRetry) {

        releases.set(hash, { key, claim });

        await releaseUnusedClaim(hash).catch(cleanupError => logRefreshFailure(cleanupError, "release-unused-claim"));

      } else {

        // Preserve the original failure for other workers; no failed POST is replayed.

        await redis(["SET", key, JSON.stringify({ state: "failed", status: info.status, reason: info.reason,

          upstreamStatus: info.upstreamStatus, redisStatus: info.redisStatus }), "EX", LIFETIME])

          .catch(publishError => logRefreshFailure(publishError, "publish-failure"));

      }

      throw error;

    }

  }

  releases.delete(hash);

  const deadline = Date.now() + 10000;

  while (Date.now() < deadline) {

    const value = await redis(["GET", key]);

    if (typeof value !== "string")

      throw new SessionRefreshError(503, "Session state is unavailable.", "REDIS_FAILURE", { safeToRetry: true });

    let entry: SharedRecord;

    try { entry = JSON.parse(value); } catch {

      throw new SessionRefreshError(503, "Session state is unavailable.", "REDIS_FAILURE", { safeToRetry: true });

    }

    if (!entry || typeof entry !== "object" || !["pending", "done", "failed"].includes(entry.state))

      throw new SessionRefreshError(503, "Session state is unavailable.", "REDIS_FAILURE", { safeToRetry: true });

    if (entry.state === "done") {

      const result = entry.result;

      if (!result || typeof result.data?.token !== "string" || typeof result.refreshToken !== "string" ||

          !result.refreshToken || !Array.isArray(result.cookies) || !result.cookies.every(cookie => typeof cookie === "string") ||

          !Number.isFinite(tokenExpiration(result.data.token)))

        throw new SessionRefreshError(503, "Session state is unavailable.", "REDIS_FAILURE", { safeToRetry: true });

      if (tokenExpiration(entry.result.data.token) <= Date.now() + 30000) return refreshSpringSession(entry.result.refreshToken);

      return entry.result;

    }

    if (entry.state === "failed")

      throw cachedFailure(new SessionRefreshError(entry.status === 401 ? 401 : 503, "Previous refresh attempt failed.",

        entry.reason || "TEMPORARY_REFRESH_FAILURE", { upstreamStatus: entry.upstreamStatus, redisStatus: entry.redisStatus }));

    await new Promise(resolve => setTimeout(resolve, 150));

  }

  // The follower may re-read Redis, but it must never steal this pending claim.

  throw new SessionRefreshError(503, "Refresh is pending or its outcome is uncertain. Try again; sign in again if it persists.",

    "CACHED_REFRESH_FAILURE", { cached: true, originalReason: "REFRESH_OUTCOME_UNKNOWN", safeToRetry: true });

}
