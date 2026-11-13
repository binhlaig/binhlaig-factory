"use client";

import { LoadingScreen } from "@/components/loading-screen";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  useRouter,
  useSearchParams,
} from "next/navigation";

import {
  signOut,
  useSession,
} from "next-auth/react";

import { clearPosSession } from "@/lib/auth-session";
import { clearAuthTokens } from "@/lib/auth";

import {
  loadBusinessAccess,
  type BusinessAccess,
} from "@/lib/business-access";

import {
  destinationForBusinessType,
  homeForBusinessType,
} from "@/lib/business-routing";

type BusinessAccessGateProps = {
  children?: ReactNode;
  entry?: boolean;
  area?: "factory" | "dashboard";
};

type SessionUser = {
  id?: string | number | null;
  userId?: string | number | null;
  email?: string | null;
  name?: string | null;
  username?: string | null;
  shopId?: string | number | null;
  shopCode?: string | null;
};

export function BusinessAccessGate({
  children,
  entry = false,
  area = "factory",
}: BusinessAccessGateProps) {
  const { status, data: session, update } = useSession();

  const updateSession = useRef(update);
  useEffect(() => {
    updateSession.current = update;
  }, [update]);

  const router = useRouter();
  const params = useSearchParams();

  const callback =
    params.get("next") ||
    params.get("callbackUrl");

  const [attempt, setAttempt] = useState(0);
  const [failureDetail, setFailureDetail] = useState("");

  const [access, setAccess] =
    useState<BusinessAccess | null>(null);

  const [checkedIdentity, setCheckedIdentity] =
    useState("");

  /**
   * Stable account identity.
   *
   * IMPORTANT:
   * Do not include session.accessToken here.
   *
   * Access tokens rotate every 15 minutes.
   * Rotating an access token must not cause
   * the page to remount or lose local state.
   */
  const user = session?.user as SessionUser | undefined;

  const identity = JSON.stringify([
    user?.id ?? user?.userId ?? user?.email ??
      user?.username ?? user?.name ?? null,
    user?.shopId ?? null,
    user?.shopCode ?? null,
  ]);

  /**
   * Check business access only when:
   *
   * - The authenticated identity changes
   * - A new login is established
   * - The user explicitly retries
   *
   * Background access-token rotation should
   * not trigger another check.
   */
  useEffect(() => {
    if (!entry && status === "loading") {
      return;
    }

    let active = true;
    const controller = new AbortController();

    async function check() {
      let responseStatus: number | undefined;
      const result = await loadBusinessAccess(async (input, init) => {
        const response = await fetch(input, init);
        responseStatus = response.status;
        return response;
      }, controller.signal);

      if (!active || controller.signal.aborted) return;

      if (entry && result.kind === "ready") {
        const destination = destinationForBusinessType(result.businessType, callback);
        if (destination) {
          window.location.replace(destination);
          return;
        }
      }

      setFailureDetail(result.kind === "error"
        ? responseStatus === undefined
          ? "Business type API မှ response မရရှိပါ။"
          : `GET /api/auth/business-type · HTTP ${responseStatus}`
        : "");

      if (result.kind === "unauthenticated") {
        clearPosSession();
        clearAuthTokens();

        await signOut({ redirect: false });

        if (active) {
          const destination = entry
            ? callback || "/"
            : window.location.pathname +
              window.location.search;

          router.replace(
            `/Sign_in?next=${encodeURIComponent(destination)}`
          );
        }

        return;
      }

      if (
        status === "unauthenticated" &&
        result.kind === "ready"
      ) {
        const restored = await updateSession.current().catch(() => null);

        if (active) {
          if (restored) return;
          setFailureDetail("Browser session ကို ပြန်လည်ရယူ၍ မရပါ။");
          setAccess({ kind: "error" });
          setCheckedIdentity(identity);
        }

        return;
      }

      setAccess(result);
      setCheckedIdentity(identity);

      if (
        result.kind === "ready" &&
        (
          !entry &&
          area === "dashboard" &&
          result.businessType === "FACTORY"
        )
      ) {
        const destination = destinationForBusinessType(
          result.businessType,
          null
        );

        if (destination) {
          router.replace(destination);
        }
      }
    }

    void check();

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    status,
    identity,
    attempt,
    router,
    entry,
    callback,
    area,
  ]);

  function retry() {
    setFailureDetail("");
    setAccess(null);
    setAttempt((value) => value + 1);
  }

  /**
   * Show loading only when business access
   * is not yet verified for this account.
   *
   * A background token refresh must not
   * replace the existing page with LoadingScreen.
   */
  if (
    checkedIdentity !== identity ||
    !access ||
    (entry && access.kind === "ready")
  ) {
    return (
      <LoadingScreen title="Checking business access…" />
    );
  }

  /**
   * Authorized business.
   *
   * Keep children mounted while the access
   * token rotates in the background.
   */
  if (
    access.kind === "ready" &&
    homeForBusinessType(access.businessType) ===
      `/${area}`
  ) {
    return <>{children}</>;
  }

  /**
   * Prevent Factory accounts from displaying
   * the POS dashboard.
   */
  if (
    access.kind === "ready" &&
    area === "dashboard"
  ) {
    return (
      <LoadingScreen title="Checking business access…" />
    );
  }

  const isError = access.kind === "error";
  const unknown = access.kind === "unknown";

  return (
    <section className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
      <div
        className="w-full max-w-lg rounded-2xl border p-6"
        role="alert"
      >
        <h1 className="text-xl font-semibold">
          {isError
            ? "Access check failed"
            : unknown
              ? "Business Type မသိရှိရသေးပါ"
              : "Access denied"}
        </h1>

        <p className="mt-3 text-sm text-muted-foreground">
          {isError
            ? "ဝင်ရောက်ခွင့် စစ်ဆေးမှု မအောင်မြင်ပါ။ ပြန်လည်ကြိုးစားပါ။"
            : unknown
              ? "Account ၏ Business Type ကို Official / Super Admin ထံ စစ်ဆေးပေးရန် ဆက်သွယ်ပါ။"
              : "Factory account ဖြင့်သာ ဝင်ရောက်နိုင်ပါသည်။"}
        </p>

        {isError && failureDetail && (
          <p className="mt-2 text-sm text-muted-foreground">{failureDetail}</p>
        )}

        {(isError || unknown) && (
          <button
            type="button"
            className="mt-5 rounded-lg border px-4 py-2"
            onClick={retry}
          >
            Retry
          </button>
        )}

        <button
          type="button"
          className="ml-3 mt-5 rounded-lg border px-4 py-2"
          onClick={async () => {
            clearPosSession();
            clearAuthTokens();

            await signOut({
              callbackUrl: "/Sign_in",
            });
          }}
        >
          Sign out
        </button>
      </div>
    </section>
  );
}
