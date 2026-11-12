"use client";

export type ShopStatus = "ACTIVE" | "SUSPENDED" | "EXPIRED" | string;

export type PlanFeatures = {
  allowRestaurant: boolean;
  allowFashion: boolean;
  allowAnalytics: boolean;
  allowKitchen: boolean;
  allowTableOrder: boolean;
};

export type PlanLimits = {
  maxStaff: number | null;
  maxProducts: number | null;
  maxReceiptsPerMonth: number | null;
  maxStorageMb: number | null;
  maxDevices: number | null;
  maxBranches: number | null;
};

export type PosSessionUser = {
  id?: string | number | null;
  name?: string | null;
  username?: string | null;
  role?: string | null;
  shopId?: string | number | null;
  shopCode?: string | null;
  shopStatus?: ShopStatus | null;
  subscriptionPlan?: string | null;
  subscriptionEndDate?: string | null;
  businessType?: string | null;
  business_type?: string | null;
  shopBusinessType?: string | null;
  shop_business_type?: string | null;
  image?: string | null;
  imageUrl?: string | null;
};

export type SavePosSessionData = {
  accessToken?: string | null;
  token?: string | null;
  user?: PosSessionUser | null;
  shopId?: string | number | null;
  shopCode?: string | null;
  shopStatus?: ShopStatus | null;
  subscriptionPlan?: string | null;
  subscriptionEndDate?: string | null;
  features?: Partial<PlanFeatures> | null;
  limits?: Partial<PlanLimits> | null;
};

const DEFAULT_FEATURES: PlanFeatures = {
  allowRestaurant: true,
  allowFashion: true,
  allowAnalytics: true,
  allowKitchen: true,
  allowTableOrder: true,
};

const DEFAULT_LIMITS: PlanLimits = {
  maxStaff: null,
  maxProducts: null,
  maxReceiptsPerMonth: null,
  maxStorageMb: null,
  maxDevices: null,
  maxBranches: null,
};

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function normalizeFeatures(features?: Partial<PlanFeatures> | null): PlanFeatures {
  return { ...DEFAULT_FEATURES, ...(features || {}) };
}

function normalizeLimits(limits?: Partial<PlanLimits> | null): PlanLimits {
  return { ...DEFAULT_LIMITS, ...(limits || {}) };
}

export function savePosSession(data: SavePosSessionData) {
  if (typeof window === "undefined") return;

  const accessToken = data.accessToken || data.token || "";
  const user = {
    ...(data.user || {}),
    shopId: data.shopId ?? data.user?.shopId ?? null,
    shopCode: data.shopCode ?? data.user?.shopCode ?? null,
    shopStatus: data.shopStatus ?? data.user?.shopStatus ?? null,
    subscriptionPlan: data.subscriptionPlan ?? data.user?.subscriptionPlan ?? null,
    subscriptionEndDate:
      data.subscriptionEndDate ?? data.user?.subscriptionEndDate ?? null,
    businessType:
      data.user?.businessType ??
      data.user?.business_type ??
      data.user?.shopBusinessType ??
      data.user?.shop_business_type ??
      null,
  };
  const features = normalizeFeatures(data.features);
  const limits = normalizeLimits(data.limits);

  if (accessToken) window.localStorage.setItem("pos_access_token", accessToken);
  writeJson("pos_user", user);
  if (user.shopId != null) window.localStorage.setItem("pos_shop_id", String(user.shopId));
  if (user.shopCode) window.localStorage.setItem("pos_shop_code", String(user.shopCode));
  window.localStorage.setItem("pos_plan", String(user.subscriptionPlan || ""));
  writeJson("pos_features", features);
  writeJson("pos_limits", limits);
  window.dispatchEvent(new Event("pos-auth-change"));
}

export function getPosUser(): PosSessionUser | null {
  return readJson<PosSessionUser>("pos_user");
}

export function getPlanFeatures(): PlanFeatures {
  return normalizeFeatures(readJson<Partial<PlanFeatures>>("pos_features"));
}

export function getPlanLimits(): PlanLimits {
  return normalizeLimits(readJson<Partial<PlanLimits>>("pos_limits"));
}

export function clearPosSession() {
  if (typeof window === "undefined") return;
  [
    "pos_access_token",
    "pos_shop_owner_token",
    "access_token",
    "token",
    "jwt",
    "pos_user",
    "pos_shop_id",
    "pos_shop_code",
    "pos_plan",
    "pos_features",
    "pos_limits",
  ].forEach((key) => window.localStorage.removeItem(key));
  window.dispatchEvent(new Event("pos-auth-change"));
}
