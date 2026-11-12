"use client";

const TOKEN_KEYS = [
  "pos_access_token",
  "pos_shop_owner_token",
  "access_token",
  "token",
  "jwt",
] as const;

let redirectingToSignIn = false;

function cleanToken(value: string | null) {
  return (value || "").replace(/^Bearer\s+/i, "").trim();
}

export function getStoredToken() {
  if (typeof window === "undefined") return "";

  for (const key of TOKEN_KEYS) {
    const localToken = cleanToken(window.localStorage.getItem(key));
    if (localToken) return localToken;

    const sessionToken = cleanToken(window.sessionStorage.getItem(key));
    if (sessionToken) return sessionToken;
  }

  return "";
}

export function saveToken(token: string) {
  if (typeof window === "undefined") return;

  const clean = cleanToken(token);
  if (!clean) return;

  for (const key of TOKEN_KEYS) {
    if (key !== "pos_access_token") window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  }
  window.localStorage.setItem("pos_access_token", clean);
  window.dispatchEvent(new Event("pos-auth-change"));
}

export function clearAuthTokens() {
  if (typeof window === "undefined") return;

  for (const key of TOKEN_KEYS) {
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  }
  window.dispatchEvent(new Event("pos-auth-change"));
}

function safeCurrentPath() {
  if (typeof window === "undefined") return "/dashboard";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function redirectToSignIn() {
  if (typeof window === "undefined" || redirectingToSignIn) return;

  const currentPath = safeCurrentPath();
  if (window.location.pathname.toLowerCase() === "/sign_in") return;

  redirectingToSignIn = true;
  const next = currentPath && currentPath !== "/" ? `?next=${encodeURIComponent(currentPath)}` : "";
  window.location.replace(`/Sign_in${next}`);
}

export function resetSignInRedirectStateForTests() {
  redirectingToSignIn = false;
}
