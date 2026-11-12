import { requireMatchingIdentity, sessionIdentity, SessionIdentityError } from "@/lib/session-identity";

import {

  refreshSpringSession,

  refreshCookieFromResponse,

  SessionRefreshError,

} from "@/lib/spring-session-refresh";



import type { NextAuthOptions } from "next-auth";

import Credentials from "next-auth/providers/credentials";

type SpringLoginResponse = {

  token: string;

  tokenType?: string;

  // backend user info

  id?: number | string | null;

  userId?: number | string | null;

  username?: string;

  role?: string;

  shopId?: number | string | null;

  shopCode?: string | null;

  // ✅ Business Type

  businessType?: string | null;

  business_type?: string | null;

  shopBusinessType?: string | null;

  shop_business_type?: string | null;

  imageUrl?: string | null;

  shopStatus?: string | null;

  subscriptionPlan?: string | null;

  subscriptionEndDate?: string | null;

  features?:

  | {

    allowRestaurant?: boolean;

    allowFashion?: boolean;

    allowAnalytics?: boolean;

    allowKitchen?: boolean;

    allowTableOrder?: boolean;

  }

  | string

  | null;

  limits?:

  | {

    maxStaff?: number | null;

    maxProducts?: number | null;

    maxReceiptsPerMonth?: number | null;

    maxStorageMb?: number | null;

    maxDevices?: number | null;

    maxBranches?: number | null;

  }

  | string

  | null;

};

function safeJsonParse<T>(value: unknown, fallback: T): T {

  if (value == null) return fallback;

  if (typeof value === "object") {

    return value as T;

  }

  if (typeof value !== "string") {

    return fallback;

  }

  const text = value.trim();

  if (!text) {

    return fallback;

  }

  try {

    return JSON.parse(text) as T;

  } catch {

    return fallback;

  }

}

function safeObject(value: unknown) {

  const parsed = safeJsonParse<unknown>(value, null);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {

    return null;

  }

  return parsed as Record<string, unknown>;

}

function decodeJwtPayload(token: string): any | null {

  try {

    const parts = token.split(".");

    if (parts.length < 2) {

      return null;

    }

    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");

    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");

    const json = Buffer.from(padded, "base64").toString("utf8");

    return safeJsonParse(json, null);

  } catch {

    return null;

  }

}

function getTokenExpiry(token: string): number | null {

  try {

    const payload = decodeJwtPayload(token);

    if (!payload?.exp) {

      return null;

    }

    return Number(payload.exp);

  } catch {

    return null;

  }

}

function isTokenExpired(exp?: number | null): boolean {

  if (!exp) {

    return false;

  }

  const nowInSeconds = Math.floor(Date.now() / 1000);

  return nowInSeconds >= exp;

}

function firstValue(...values: unknown[]) {

  for (const value of values) {

    if (value == null) continue;

    const text = String(value).trim();

    if (text) {

      return text;

    }

  }

  return "";

}

function toNullableNumber(value: unknown): number | null {

  if (value == null) {

    return null;

  }

  const text = String(value).trim();

  if (!text) {

    return null;

  }

  const n = Number(text);

  return Number.isFinite(n) ? n : null;

}

/**

 * Normalize Business Type

 *

 * Supported:

 * SUPERMARKET

 * RESTAURANT

 * FASHION

 */

function normalizeBusinessType(value: unknown): string | null {

  if (value == null) {

    return null;

  }

  const raw = String(value).trim().toUpperCase();

  if (!raw) {

    return null;

  }

  if (raw === "SUPERMARKET" || raw === "RESTAURANT" || raw === "FASHION") {

    return raw;

  }

  return raw;

}

import {

  captureRefreshCookie,

  browserMetadataHeaders,

  isSessionRefreshRequested,

} from "@/lib/session-cookie-bridge";

export const authOptions: NextAuthOptions = {

  debug: false,

  secret: process.env.NEXTAUTH_SECRET,

  session: {

    strategy: "jwt",

    maxAge: 18 * 60 * 60,

  },

  providers: [

    Credentials({

      name: "Credentials",

      credentials: {

        latitude: { label: "Latitude", type: "text" },

        longitude: { label: "Longitude", type: "text" },

        locationAccuracy: { label: "Accuracy", type: "text" },

        country: { label: "Country", type: "text" },

        region: { label: "Region", type: "text" },

        city: { label: "City", type: "text" },

        district: { label: "District", type: "text" },

        deviceName: { label: "Device name", type: "text" },

        username: {

          label: "Username",

          type: "text",

        },

        password: {

          label: "Password",

          type: "password",

        },

        shopCode: {

          label: "Shop Code",

          type: "text",

        },

        deviceId: {

          label: "Device ID",

          type: "text",

        },

      },

      async authorize(credentials) {

        const optionalNumber = (value: unknown): number | null => {

          if (value == null || String(value).trim() === "") {

            return null;

          }

          const parsed = Number(value);

          return Number.isFinite(parsed) ? parsed : null;

        };

        const optionalText = (value: unknown): string | null => {

          if (value == null) {

            return null;

          }

          const text = String(value).trim();

          return text ? text.slice(0, 120) : null;

        };

        const latitude = optionalNumber(credentials?.latitude);

        const longitude = optionalNumber(credentials?.longitude);

        const locationAccuracy = optionalNumber(credentials?.locationAccuracy);

        const location = {

          latitude:

            latitude != null && latitude >= -90 && latitude <= 90 ? latitude : null,

          longitude:

            longitude != null && longitude >= -180 && longitude <= 180 ? longitude : null,

          locationAccuracy:

            locationAccuracy != null && locationAccuracy >= 0 ? locationAccuracy : null,

          country: optionalText(credentials?.country),

          region: optionalText(credentials?.region),

          city: optionalText(credentials?.city),

          district: optionalText(credentials?.district),

        };

        // Location is display/audit metadata only. Never use it for authorization.

        const username = String(credentials?.username || "").trim();

        const password = String(credentials?.password || "");

        const shopCode = String(credentials?.shopCode || "")

          .trim()

          .toUpperCase();

        if (!username || !password || !shopCode) {

          return null;

        }

        const deviceId = String(credentials?.deviceId ?? "").trim();

        if (!deviceId || deviceId.length > 200) {

          throw new Error("INVALID_DEVICE_ID");

        }

        const configuredOrigin = process.env.APP_FRONTEND_ORIGIN?.trim();

        if (!configuredOrigin) {

          console.error("[NextAuth] APP_FRONTEND_ORIGIN is missing");

          throw new Error("LOGIN_CONFIGURATION_ERROR");

        }

        let frontendOrigin: string;

        try {

          const url = new URL(configuredOrigin);

          if (url.protocol !== "http:" && url.protocol !== "https:") {

            throw new Error("Unsupported protocol");

          }

          frontendOrigin = url.origin;

        } catch {

          console.error("[NextAuth] APP_FRONTEND_ORIGIN is invalid");

          throw new Error("LOGIN_CONFIGURATION_ERROR");

        }

        const BACKEND_BASE = (

          process.env.REMOTE_API_BASE_URL ||

          process.env.NEXT_PUBLIC_API_BASE_URL ||

          "http://localhost:8080"

        ).replace(/\/+$/, "");

        try {

          const res = await fetch(`${BACKEND_BASE}/api/auth/login`, {

            method: "POST",

            headers: {

              ...browserMetadataHeaders(),

              "Content-Type": "application/json",

              "X-Device-ID": deviceId,

              "X-Device-Name": String(credentials?.deviceName || "POS Web Browser")

                .replace(/[\r\n]/g, "")

                .slice(0, 200),

              Origin: frontendOrigin,

            },

            credentials: "include",

            body: JSON.stringify({

              ...location,

              username,

              password,

              shopCode,

            }),

            cache: "no-store",

          });

          if (!res.ok) {

            console.error("[NextAuth] Login failed:", res.status);

            return null;

          }

          captureRefreshCookie(res);

          const refreshCredential = refreshCookieFromResponse(res);

          if (!refreshCredential) throw new Error("REFRESH_COOKIE_MISSING");

          const data: SpringLoginResponse | null = await res.json().catch(() => null);

          if (!data?.token) {

            console.error("[NextAuth] Backend token missing");

            return null;

          }

          /**

           * Decode Spring JWT

           */

          const payload = decodeJwtPayload(data.token);

          const exp = getTokenExpiry(data.token);

          sessionIdentity(data.token);

          /**

           * Username

           */

          const parsedUsername = firstValue(

            data.username,

            payload?.username,

            payload?.sub,

            username,

          );

          /**

           * User ID

           */

          const parsedUserId = firstValue(

            data.id,

            data.userId,

            payload?.id,

            payload?.userId,

            payload?.user_id,

            payload?.uid,

          );

          /**

           * Role

           */

          const role = firstValue(data.role, payload?.role, payload?.roles, "CASHIER");

          /**

           * Shop ID

           */

          const parsedShopId = toNullableNumber(

            firstValue(data.shopId, payload?.shopId, payload?.shop_id),

          );

          /**

           * Shop Code

           */

          const parsedShopCode = firstValue(

            data.shopCode,

            payload?.shopCode,

            payload?.shop_code,

            shopCode,

          );

          /**

           * ✅ BUSINESS TYPE

           *

           * Backend response ကို priority ပေးတယ်။

           * မရှိရင် JWT payload ကနေယူတယ်။

           */

          const parsedBusinessType = normalizeBusinessType(

            firstValue(

              data.businessType,

              data.business_type,

              data.shopBusinessType,

              data.shop_business_type,

              payload?.businessType,

              payload?.business_type,

              payload?.shopBusinessType,

              payload?.shop_business_type,

              payload?.business,

              payload?.shop?.businessType,

              payload?.shop?.business_type,

            ),

          );

          /**

           * Image

           */

          const parsedImageUrl = firstValue(

            data.imageUrl,

            payload?.imageUrl,

            payload?.image_url,

            "",

          );

          /**

           * Debug

           *

           * Production မှာ remove လုပ်နိုင်ပါတယ်။

           */

          console.log("[NextAuth] login business type:", parsedBusinessType);

          console.log(

            "[NextAuth] JWT payload business type:",

            payload?.businessType ??

            payload?.business_type ??

            payload?.shopBusinessType ??

            payload?.shop_business_type ??

            null,

          );

          /**

           * User object

           *

           * ဒီ object က jwt callback ကိုသွားမယ်

           */

          const resultUser = {

            id: parsedUserId,

            name: parsedUsername,

            username: parsedUsername,

            role,

            shopId: parsedShopId,

            shopCode: parsedShopCode,

            /**

             * ✅ Keep both naming styles

             */

            businessType: parsedBusinessType,

            business_type: parsedBusinessType,

            image: parsedImageUrl || null,

            imageUrl: parsedImageUrl || null,

            accessToken: data.token,

            tokenType: data.tokenType || "Bearer",

            refreshCredential,

            accessTokenExpires: exp,

            shopStatus:

              data.shopStatus ?? payload?.shopStatus ?? payload?.shop_status ?? null,

            subscriptionPlan:

              data.subscriptionPlan ??

              payload?.subscriptionPlan ??

              payload?.subscription_plan ??

              null,

            subscriptionEndDate:

              data.subscriptionEndDate ??

              payload?.subscriptionEndDate ??

              payload?.subscription_end_date ??

              null,

            features: safeObject(data.features ?? payload?.features),

            limits: safeObject(data.limits ?? payload?.limits),

          } as any;

          console.log("[NextAuth] result user:", {

            username: resultUser.username,

            shopCode: resultUser.shopCode,

            business_type: resultUser.business_type,

          });

          return resultUser;

        } catch (error) {

          console.error("[NextAuth] authorize failed", {

            reason: error instanceof SessionIdentityError ? error.reason : "LOGIN_FAILED",

          });

          return null;

        }

      },

    }),

  ],

  callbacks: {

    /**

     * ==================================================

     * JWT CALLBACK

     * ==================================================

     */

    async jwt({ token, user }) {

      /**

       * Login အသစ်ဝင်တဲ့အချိန် user ရှိမယ်

       */

      if (user) {

        const u = user as any;

token.id = String(u.id || u.userId || "");

token.userId = String(u.userId || u.id || "");

token.username = String(u.username || u.name || "");

token.role = String(u.role || "");

token.shopId = u.shopId ?? null;

token.shopCode = u.shopCode ?? null;

        /**

         * ✅ BUSINESS TYPE

         */

        const businessType = normalizeBusinessType(

          firstValue(

            u.business_type,

            u.businessType,

            u.shop_business_type,

            u.shopBusinessType,

          ),

        );

token.business_type = businessType;

token.businessType = businessType;

token.image = u.image || u.imageUrl || null;

token.refreshCredential = u.refreshCredential;

token.accessToken = u.accessToken;

token.tokenType = u.tokenType || "Bearer";

token.accessTokenExpires = u.accessTokenExpires ?? null;

token.shopStatus = u.shopStatus ?? null;

token.subscriptionPlan = u.subscriptionPlan ?? null;

token.subscriptionEndDate = u.subscriptionEndDate ?? null;

token.features = safeObject(u.features);

token.limits = safeObject(u.limits);

        console.log("[NextAuth JWT] business_type:", token.business_type);

      }

      const expires = Number(token.accessTokenExpires || 0);
      const refreshDue = expires > 0 && Date.now() / 1000 >= expires - 60;
      const forcedRefresh = !user && isSessionRefreshRequested();

      if (!user && expires && (refreshDue || forcedRefresh)) {

        if (token.error === "AccessTokenExpired") return token;

        // Back off on temporary failures; never turn a 503 into a logout.

        if (Number(token.refreshRetryAfter || 0) > Date.now()) return token;

        try {

          // Validate the login contract before consuming a single-use credential.

          sessionIdentity(String(token.accessToken || ""));

          const refreshed = await refreshSpringSession(

String(token.refreshCredential || ""),

          );



          // Validate the refreshed token's identity against the original token.





          requireMatchingIdentity(String(token.accessToken || ""), refreshed.data.token);







token.accessToken = refreshed.data.token;

token.accessTokenExpires = getTokenExpiry(refreshed.data.token);

token.refreshCredential = refreshed.refreshToken;

token.refreshRetryAfter = 0;

          // The route bridge forwards rotation cookies to the browser. Credentials

          // remain in the encrypted HttpOnly NextAuth JWT and are NEVER in session().







          for (const cookie of refreshed.cookies)

            captureRefreshCookie(

new Response(null, { headers: { "Set-Cookie": cookie } }),

            );

          delete token.error;

          delete token.refreshReason;

          delete token.refreshUpstreamStatus;

          delete token.refreshOriginalReason;

        } catch (error) {

token.refreshReason = error instanceof SessionIdentityError ? error.reason

            : error instanceof SessionRefreshError ? error.reason : "TEMPORARY_REFRESH_FAILURE";

token.refreshUpstreamStatus = error instanceof SessionRefreshError ? error.upstreamStatus

            : error instanceof SessionIdentityError && error.reason === "IDENTITY_MISMATCH" ? 200 : null;

token.refreshOriginalReason = error instanceof SessionRefreshError ? error.originalReason ?? null : null;

          console.error("[Session refresh]", {

            stage: "jwt", reason: token.refreshReason, originalReason: token.refreshOriginalReason,

            upstreamStatus: token.refreshUpstreamStatus,

            redisStatus: error instanceof SessionRefreshError ? error.redisStatus ?? null : null,

            cached: error instanceof SessionRefreshError ? error.cached ?? false : false,

            configuration: error instanceof SessionRefreshError ? error.configuration ?? null : null,

          });

          if ((error instanceof SessionRefreshError && error.status === 401) ||

            (error instanceof SessionIdentityError && error.reason === "IDENTITY_MISMATCH")) {

token.error = "AccessTokenExpired";

token.accessToken = null;

token.refreshCredential = null;

          } else {

token.error = "RefreshTemporarilyUnavailable";

token.refreshRetryAfter = Date.now() + 15000;

          }

        }

      } else if (token.error !== "AccessTokenExpired") {

        delete token.error;

      }

      return token;

    },

    /**

     * ==================================================

     * SESSION CALLBACK

     * ==================================================

     */

    async session({ session, token }) {

      try {

        const expired = isTokenExpired(

token.accessTokenExpires as number | null | undefined,

        );

        const safeUserId = firstValue(token.id, token.userId);

        const features = expired ? null : safeObject(token.features);

        const limits = expired ? null : safeObject(token.limits);

        /**

         * ✅ Resolve business type from JWT

         */

        const businessType = normalizeBusinessType(

          firstValue(token.business_type, token.businessType),

        );

        /**

         * session.user

         */

session.user = {

          ...(session.user || {}),

          id: safeUserId,

          name: String(token.username || ""),

          username: String(token.username || ""),

          role: String(token.role || ""),

          shopId: token.shopId as number | null,

          shopCode: token.shopCode as string | null,

          /**

           * ✅ BUSINESS TYPE

           *

           * Product Edit Page မှာ:

           *

           * session.user.business_type

           *

           * နဲ့ယူနိုင်ပါတယ်။

           */

          business_type: businessType,

          businessType: businessType,

          image: (token.image as string | null) ?? null,

          avatarUrl: (token.image as string | null) ?? null,

          imageUrl: (token.image as string | null) ?? null,

          shopStatus: expired ? null : ((token.shopStatus as string | null) ?? null),

          subscriptionPlan: expired

            ? null

            : ((token.subscriptionPlan as string | null) ?? null),

          subscriptionEndDate: expired

            ? null

            : ((token.subscriptionEndDate as string | null) ?? null),

        } as any;

        /**

         * Root session values

         */

        (session as any).accessToken = expired ? null : (token.accessToken ?? null);

        (session as any).tokenType = token.tokenType || "Bearer";

        /**

         * ✅ Also expose root-level

         *

         * session.business_type

         */

        (session as any).business_type = businessType;

        (session as any).businessType = businessType;

        (session as any).error = expired

          ? (token.error ?? "RefreshTemporarilyUnavailable")

          : (token.error ?? null);

        (session as any).refreshReason = token.refreshReason ?? null;

        (session as any).refreshUpstreamStatus = token.refreshUpstreamStatus ?? null;

        (session as any).refreshOriginalReason = token.refreshOriginalReason ?? null;

        (session as any).accessTokenExpires =

          (token.accessTokenExpires as number | null) ?? null;

        (session as any).shopStatus = expired ? null : (token.shopStatus ?? null);

        (session as any).subscriptionPlan = expired

          ? null

          : (token.subscriptionPlan ?? null);

        (session as any).subscriptionEndDate = expired

          ? null

          : (token.subscriptionEndDate ?? null);

        (session as any).features = features;

        (session as any).limits = limits;

        console.log(

          "[NextAuth SESSION] business_type:",

          (session.user as any)?.business_type,

        );

        return session;

      } catch (error) {

        console.error("[NextAuth] session mapping error:", error);

        return {

          ...session,

          user: session.user || {},

          accessToken: null,

          error: "SessionMappingError",

          business_type: null,

          businessType: null,

          features: null,

          limits: null,

        } as any;

      }

    },

  },

  pages: {

    signIn: "/Sign_in",

  },

};
