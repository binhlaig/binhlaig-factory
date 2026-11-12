import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { isWithin, safeInternalPath } from "@/lib/business-routing";

const SIGN_IN = "/Sign_in";
const ENTRY = "/entry";
const FACTORY = "/factory";

export async function proxy(request: NextRequest) {
  const { pathname, search, searchParams } = request.nextUrl;
  const isSignIn = pathname === SIGN_IN || pathname === "/sign-in";
  const isFactoryRoute = isWithin(pathname, FACTORY);

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  }).catch(() => null);

  const hasSession =
    !!token &&
    token.error !== "AccessTokenExpired" &&
    (typeof token.exp !== "number" ||
      token.exp > Math.floor(Date.now() / 1000));

  const rawNext = isFactoryRoute
    ? `${pathname}${search}`
    : searchParams.get("next") || searchParams.get("callbackUrl");

  const safeNext = safeInternalPath(rawNext);
  const factoryNext =
    safeNext &&
    isWithin(new URL(safeNext, request.url).pathname, FACTORY)
      ? safeNext
      : null;

  if (!hasSession) {
    if (isSignIn) return NextResponse.next();

    const signInUrl = new URL(SIGN_IN, request.url);
    if (factoryNext) signInUrl.searchParams.set("next", factoryNext);
    return NextResponse.redirect(signInUrl);
  }

  if (pathname === "/" || isSignIn) {
    const entryUrl = new URL(ENTRY, request.url);
    if (factoryNext) entryUrl.searchParams.set("next", factoryNext);
    return NextResponse.redirect(entryUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/Sign_in", "/sign-in", "/entry", "/factory/:path*"],
};