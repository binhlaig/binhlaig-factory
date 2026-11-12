"use client";

import {
  useEffect,
  useState,
} from "react";
import Link from "next/link";
import {
  signOut,
  useSession,
} from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Settings,
  User2,
} from "lucide-react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type StoredUser = {
  id?: string | number;
  employeeId?: string | number;
  name?: string;
  username?: string;
  email?: string;
  role?: string;
  shopCode?: string;
  image?: string;
  imageUrl?: string;
  avatarUrl?: string;
};

const FILE_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL;

function initialsFrom(
  name?: string | null,
) {
  if (!name) return "U";

  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "U";

  if (parts.length === 1) {
    return (
      (parts[0]?.[0] ?? "U") +
      (parts[0]?.[1] ?? "")
    ).toUpperCase();
  }

  return (
    (parts[0]?.[0] ?? "U") +
    (parts[parts.length - 1]?.[0] ?? "")
  ).toUpperCase();
}

function resolveAvatarUrl(
  avatarUrl?: string | null,
) {
  if (!avatarUrl) return undefined;

  const clean = avatarUrl.trim();

  if (!clean) return undefined;

  if (/^https?:\/\//i.test(clean)) {
    return clean;
  }

  if (clean.startsWith("/uploads/")) {
    if (FILE_BASE) {
      try {
        return new URL(
          clean,
          FILE_BASE,
        ).href;
      } catch {
        return clean;
      }
    }

    return clean;
  }

  if (clean.startsWith("/")) {
    return clean;
  }

  const relativePath =
    `/uploads/avatars/${clean}`;

  if (FILE_BASE) {
    try {
      return new URL(
        relativePath,
        FILE_BASE,
      ).href;
    } catch {
      return relativePath;
    }
  }

  return relativePath;
}

function clearClientAuthData() {
  try {
    const keys = [
      "remember_login",
      "shop_code",
      "last_username",
      "sync-user",
      "user",
      "auth-user",
    ];

    keys.forEach((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
  } catch {
    // Browser storage မရနိုင်လျှင် ဆက်လုပ်မည်
  }
}

export function NavbarUserProfile() {
  const {
    data: session,
    status,
  } = useSession();

  const router = useRouter();

  const [mounted, setMounted] =
    useState(false);

  const [storedUser, setStoredUser] =
    useState<StoredUser | null>(null);

  const [loggingOut, setLoggingOut] =
    useState(false);

  const sessionUser =
    session?.user as StoredUser | undefined;

  const sessionError = (
    session as
      | { error?: string }
      | null
      | undefined
  )?.error;

  useEffect(() => {
    setMounted(true);

    try {
      const raw =
        localStorage.getItem("sync-user") ||
        localStorage.getItem("user") ||
        localStorage.getItem("auth-user");

      if (raw) {
        setStoredUser(
          JSON.parse(raw) as StoredUser,
        );
      }
    } catch {
      setStoredUser(null);
    }
  }, []);

  const mergedUser: StoredUser = {
    ...storedUser,
    ...sessionUser,

    name:
      sessionUser?.name ??
      sessionUser?.username ??
      storedUser?.name ??
      storedUser?.username ??
      "Unknown User",

    username:
      sessionUser?.username ??
      sessionUser?.name ??
      storedUser?.username ??
      storedUser?.name ??
      "Unknown User",

    image:
      sessionUser?.imageUrl ??
      sessionUser?.avatarUrl ??
      sessionUser?.image ??
      storedUser?.imageUrl ??
      storedUser?.avatarUrl ??
      storedUser?.image,

    shopCode:
      sessionUser?.shopCode ??
      storedUser?.shopCode,
  };

  const hasUser = Boolean(
    sessionUser || storedUser,
  );

  const name =
    mergedUser.name ??
    mergedUser.username ??
    "Unknown User";

  const email =
    mergedUser.email ?? "";

  const role =
    mergedUser.role ?? "Staff";

  const shopCode =
    mergedUser.shopCode;

  const userImage =
    resolveAvatarUrl(mergedUser.image);

  const handleLogout = async () => {
    if (loggingOut) return;

    setLoggingOut(true);

    clearClientAuthData();

    await signOut({
      redirect: false,
    });

    router.replace("/Sign_in");
    router.refresh();
  };

  useEffect(() => {
    if (!mounted) return;
    if (status === "loading") return;

    if (
      sessionError ===
      "AccessTokenExpired"
    ) {
      void handleLogout();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mounted,
    status,
    sessionError,
  ]);

  if (!mounted || status === "loading") {
    return (
      <div
        aria-hidden
        className="h-10 w-10 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800 md:w-[160px] md:rounded-xl"
      />
    );
  }

  if (loggingOut) {
    return (
      <div className="flex h-10 items-center gap-2 rounded-xl px-2 text-xs text-slate-500 dark:text-slate-400">
        <LoaderCircle
          size={17}
          className="animate-spin text-blue-600"
        />

        <span className="hidden xl:block">
          Signing out...
        </span>
      </div>
    );
  }

  if (!hasUser) {
    return (
      <Link
        href="/Sign_in"
        className="inline-flex h-9 items-center justify-center rounded-xl bg-blue-600 px-3 text-sm font-medium text-white transition-colors hover:bg-blue-700"
      >
        Sign in
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="
            h-10 rounded-xl px-1.5
            hover:bg-slate-100
            dark:hover:bg-white/10
            sm:px-2
          "
        >
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8 overflow-hidden ring-2 ring-blue-100 dark:ring-blue-500/30 sm:h-9 sm:w-9">
              {userImage ? (
                <AvatarImage
                  src={userImage}
                  alt={`${name} avatar`}
                />
              ) : null}

              <AvatarFallback className="bg-blue-600 text-xs font-semibold text-white">
                {initialsFrom(name)}
              </AvatarFallback>
            </Avatar>

            <div className="hidden max-w-[150px] flex-col text-left leading-tight xl:flex">
              <span className="truncate text-xs font-semibold text-slate-900 dark:text-white">
                {name}
              </span>

              <span className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                {role}
                {shopCode
                  ? ` • ${shopCode}`
                  : ""}
              </span>
            </div>
          </div>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={10}
        className="
          z-[100] w-64 rounded-2xl
          border-slate-200 p-2
          shadow-xl
          dark:border-white/10
          dark:bg-slate-950
        "
      >
        <DropdownMenuLabel className="px-2 py-2">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
            Signed in as
          </p>

          <p className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-white">
            {name}
          </p>

          {email ? (
            <p className="mt-0.5 truncate text-xs font-normal text-slate-500 dark:text-slate-400">
              {email}
            </p>
          ) : null}

          <p className="mt-1 truncate text-xs font-normal text-slate-500 dark:text-slate-400">
            {role}
            {shopCode
              ? ` • ${shopCode}`
              : ""}
          </p>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          asChild
          className="cursor-pointer rounded-xl"
        >
          <Link href="/dashboard">
            <LayoutDashboard className="mr-2 h-4 w-4" />
            Dashboard
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem
          asChild
          className="cursor-pointer rounded-xl"
        >
          <Link href="/settings/profile">
            <User2 className="mr-2 h-4 w-4" />
            Profile
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem
          asChild
          className="cursor-pointer rounded-xl"
        >
          <Link href="/dashboard/settings">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() =>
            void handleLogout()
          }
          className="
            cursor-pointer rounded-xl
            text-red-600
            focus:bg-red-50
            focus:text-red-600
            dark:focus:bg-red-500/10
          "
        >
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}