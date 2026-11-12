"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSession, SessionProvider, signIn, signOut, useSession } from "next-auth/react";
import { Eye, EyeOff, Moon, Sun } from "lucide-react";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { clearAuthTokens, saveToken } from "@/lib/auth";
import { clearPosSession, savePosSession } from "@/lib/auth-session";
import { businessEntryPath } from "@/lib/business-routing";

function getCurrentDeviceName(): string {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) {
    return "iPad";
  }
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) {
    if (/Redmi/i.test(ua)) return "Redmi Android";
    if (/Xiaomi|Mi Pad/i.test(ua)) return "Xiaomi Android";
    return "Android Device";
  }
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/CrOS/i.test(ua)) return "Chromebook";
  if (/Linux/i.test(ua)) return "Linux PC";
  return "Web Browser";
}
function getLoginDeviceId(): string {
  const key = "pos_device_id";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
    const deviceId = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
    localStorage.setItem(key, deviceId);
    return deviceId;
  } catch {
    throw new Error("Device ID ကို သိမ်းမရပါ။ Browser storage settings ကို စစ်ပါ။");
  }
}

function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [shopCode, setShopCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [msg, setMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [night, setNight] = useState(true);
  const redirectedRef = useRef(false);
  const expiredHandledRef = useRef(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const sessionError = String((session as any)?.error || "");
  const sessionAccessToken = String((session as any)?.accessToken || "");
  const safeNextPath = businessEntryPath(
    searchParams.get("next") || searchParams.get("callbackUrl") || searchParams.get("redirect")
  );
  useEffect(() => {
    try {
      const saved = localStorage.getItem("cutepos-theme");
      if (saved === "day" || saved === "night") setNight(saved === "night");
    } catch {
      // The theme toggle still works when storage is unavailable.
    }
  }, []);

  function toggleTheme() {
    const nextNight = !night;
    setNight(nextNight);
    try {
      localStorage.setItem("cutepos-theme", nextNight ? "night" : "day");
    } catch {
      // The current page can still use the selected theme.
    }
  }
  useEffect(() => {
    try {
      const rm =
        localStorage.getItem("remember_login") ||
        sessionStorage.getItem("remember_login");
      setRemember(rm !== "0");
      const sc =
        localStorage.getItem("shop_code") ||
        sessionStorage.getItem("shop_code") ||
        "";
      const un =
        localStorage.getItem("last_username") ||
        sessionStorage.getItem("last_username") ||
        "";
      if (sc) setShopCode(sc);
      if (un) setUsername(un);
    } catch {
      // ignore storage error
    }
  }, []);
  useEffect(() => {
    if (sessionError !== "AccessTokenExpired") return;
    if (expiredHandledRef.current) return;
    expiredHandledRef.current = true;
    const clearExpired = async () => {
      clearPosSession();
      clearAuthTokens();
      try {
        sessionStorage.removeItem("pos_access_token");
        sessionStorage.removeItem("pos_user");
      } catch {
        // ignore
      }
      await signOut({
        redirect: false,
      });
    };
    clearExpired();
  }, [sessionError]);
  useEffect(() => {
    if (redirectedRef.current) return;
    if (status === "loading") return;
    if (
      status === "authenticated" &&
      sessionError !== "AccessTokenExpired" &&
      sessionAccessToken
    ) {
      redirectedRef.current = true;
      const target = safeNextPath;
      router.replace(target);
    }
  }, [router, safeNextPath, sessionAccessToken, sessionError, status]);
  const canSubmit =
    username.trim().length > 0 &&
    password.length > 0 &&
    shopCode.trim().length > 0 &&
    !submitting;

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    const trimUser = username.trim();
    const trimShop = shopCode.trim().toUpperCase();
    setMsg("");
    if (!trimUser) {
      const t = "Username is required";
      setMsg(t);
      return;
    }
    if (!password) {
      const t = "Password is required";
      setMsg(t);
      return;
    }
    if (!trimShop) {
      const t = "Shop code is required";
      setMsg(t);
      return;
    }
    setSubmitting(true);
    try {
      const callbackUrl = safeNextPath;
      const deviceId = getLoginDeviceId();
      const deviceName = getCurrentDeviceName();
      const res = await signIn("credentials", {
        redirect: false,
        username: trimUser,
        password,
        shopCode: trimShop,
        deviceId,
        deviceName,
        callbackUrl,
      });
      if (!res) {
        throw new Error("No response from auth server.");
      }
      if (res.error) {
        const t =
          res.error === "CredentialsSignin"
            ? "Invalid username, password, or shop code"
            : res.error;
        setMsg(t);
        return;
      }
      try {
        const nextSession = await getSession();
        const accessToken = String((nextSession as any)?.accessToken || "");
        if (accessToken) {
          saveToken(accessToken);
        }
        const sessionUser = (nextSession?.user || {}) as any;
        savePosSession({
          accessToken,
          user: {
            id: sessionUser.id,
            name: sessionUser.name,
            username: sessionUser.username || sessionUser.name || trimUser,
            role: sessionUser.role,
            shopId: sessionUser.shopId,
            shopCode: sessionUser.shopCode || trimShop,
            shopStatus:
              (nextSession as any)?.shopStatus || sessionUser.shopStatus,
            subscriptionPlan:
              (nextSession as any)?.subscriptionPlan ||
              sessionUser.subscriptionPlan,
            subscriptionEndDate:
              (nextSession as any)?.subscriptionEndDate ||
              sessionUser.subscriptionEndDate,
            image: sessionUser.image,
            imageUrl: sessionUser.imageUrl,
          },
          shopId: sessionUser.shopId,
          shopCode: sessionUser.shopCode || trimShop,
          shopStatus: (nextSession as any)?.shopStatus,
          subscriptionPlan: (nextSession as any)?.subscriptionPlan,
          subscriptionEndDate: (nextSession as any)?.subscriptionEndDate,
          features: (nextSession as any)?.features,
          limits: (nextSession as any)?.limits,
        });
        const store = remember ? localStorage : sessionStorage;
        const other = remember ? sessionStorage : localStorage;
        ["remember_login", "shop_code", "last_username"].forEach((k) =>
          other.removeItem(k)
        );
        store.setItem("remember_login", remember ? "1" : "0");
        store.setItem("shop_code", trimShop);
        store.setItem("last_username", trimUser);
      } catch {
        // session sync error should not block login redirect
      }
      redirectedRef.current = true;
      router.replace(callbackUrl);
    } catch (err: any) {
      const t = err?.message || "Login failed";
      setMsg(t);
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = [
    "h-12 w-full rounded-xl border bg-transparent px-4 text-base outline-none",
    "focus-visible:ring-2 focus-visible:ring-blue-500",
    night
      ? "border-blue-300/50 placeholder:text-slate-400"
      : "border-slate-300 placeholder:text-slate-500",
  ].join(" ");

  return (
    <div
      data-binhlaig-sign-in={night ? "dark" : "light"}
      style={{ colorScheme: night ? "dark" : "light" }}
      className={`relative grid min-h-dvh lg:grid-cols-[55%_45%] ${
        night ? "bg-[#061733] text-white" : "bg-white text-slate-950"
      }`}
    >
      <style>{`
        [data-binhlaig-sign-in="dark"] {
          --signin-autofill-bg: #102442;
          --signin-autofill-text: #fff;
        }
        [data-binhlaig-sign-in="light"] {
          --signin-autofill-bg: #fff;
          --signin-autofill-text: #020617;
        }
        [data-binhlaig-sign-in] input:-webkit-autofill {
          -webkit-box-shadow: 0 0 0 1000px var(--signin-autofill-bg) inset;
          -webkit-text-fill-color: var(--signin-autofill-text);
          caret-color: var(--signin-autofill-text);
        }
        [data-binhlaig-sign-in] .binhlaig-sign-in-scene {
          width: min(100%, 80dvh);
          aspect-ratio: 1122 / 1402;
          mask-image:
            linear-gradient(to right, transparent, black 12%, black 87%, transparent),
            linear-gradient(to bottom, transparent, black 17%, black 78%, transparent 99%);
          mask-composite: intersect;
        }
        [data-binhlaig-sign-in] .binhlaig-sign-in-glow {
          background: radial-gradient(ellipse at 31% 37%,
            rgb(255 168 70 / 0.15), transparent 48%);
          mix-blend-mode: screen;
        }
        @media (prefers-reduced-motion: no-preference) {
          [data-binhlaig-sign-in] .binhlaig-sign-in-glow {
            animation: binhlaig-sign-in-glow 5s ease-in-out infinite alternate;
          }
        }
        @keyframes binhlaig-sign-in-glow {
          from { opacity: 0.45; }
          to { opacity: 0.9; }
        }
        @media (min-width: 1024px) and (max-height: 800px) {
          [data-binhlaig-sign-in] .binhlaig-sign-in-form-panel {
            padding-block: 32px;
          }
        }
      `}</style>
      <div aria-hidden="true" className="relative hidden overflow-hidden lg:block">
        <div className="binhlaig-sign-in-scene pointer-events-none absolute bottom-0 left-1/2 isolate -translate-x-1/2">
          <Image
            src={night ? "/sign-in-dark.webp" : "/sign-in-light.webp"}
            alt=""
            fill
            sizes="(min-width: 1024px) min(55vw, 80vh), 1px"
            className="object-contain"
          />
          {night && <div className="binhlaig-sign-in-glow absolute inset-0" />}
        </div>
      </div>

      <button
        type="button"
        onClick={toggleTheme}
        aria-label={night ? "Switch to light mode" : "Switch to dark mode"}
        className={`absolute top-5 right-5 z-10 grid size-11 place-items-center rounded-xl border focus-visible:outline-2 focus-visible:outline-blue-500 ${
          night ? "border-blue-300/50 hover:bg-white/10" : "border-slate-300 hover:bg-slate-100"
        }`}
      >
        {night ? <Moon size={20} aria-hidden="true" /> : <Sun size={20} aria-hidden="true" />}
      </button>

      <section aria-labelledby="sign-in-heading" className="binhlaig-sign-in-form-panel grid min-w-0 place-items-center px-6 py-20 sm:px-10">
        <div className="w-full max-w-[420px]">
          <div className="mb-5 grid size-14 place-items-center rounded-xl bg-white ring-1 ring-slate-200">
            <Image src="/binhlaig-logo.png" width={48} height={48} alt="Binhlaig" />
          </div>
          <h1 id="sign-in-heading" className="mb-8 text-4xl font-bold tracking-tight">Sign in</h1>

          <form onSubmit={onSubmit} noValidate className="grid gap-5" aria-busy={submitting}>
            <div className="grid gap-2">
              <label htmlFor="shopCode" className="text-sm font-semibold">Shop code</label>
              <input
                id="shopCode"
                name="shopCode"
                value={shopCode}
                onChange={(event) => setShopCode(event.target.value.toUpperCase())}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="Enter shop code"
                className={inputClass}
                required
              />
            </div>
            <div className="grid gap-2">
              <label htmlFor="username" className="text-sm font-semibold">Username</label>
              <input
                id="username"
                name="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="Enter username"
                className={inputClass}
                required
              />
            </div>
            <div className="grid gap-2">
              <label htmlFor="password" className="text-sm font-semibold">Password</label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="Enter password"
                  className={`${inputClass} pr-14`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((current) => !current)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-xl focus-visible:outline-2 focus-visible:outline-blue-500"
                >
                  {showPw ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
                </button>
              </div>
            </div>

            <label className="flex w-fit items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="size-4 accent-blue-600"
              />
              Remember me
            </label>

            {msg && (
              <p role="alert" className={`text-sm ${night ? "text-rose-300" : "text-rose-700"}`}>
                {msg}
              </p>
            )}
            <button
              type="submit"
              disabled={!canSubmit}
              className="h-12 rounded-xl bg-blue-700 px-4 font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>

          {/* <p className={`mt-5 text-sm ${night ? "text-slate-300" : "text-slate-600"}`}>
            New to Binhlaig?{" "}
            <Link className={`font-semibold underline underline-offset-4 ${night ? "text-blue-300" : "text-blue-700"}`} href="/register">
              Create an account
            </Link>
          </p> */}
        </div>
      </section>
    </div>
  );
}

export default function SignInPage() {
  return (
    <SessionProvider>
      <Suspense fallback={<div role="status">Loading…</div>}>
        <LoginPage />
      </Suspense>
    </SessionProvider>
  );
}
