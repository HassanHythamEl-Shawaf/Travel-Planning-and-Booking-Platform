import { NextResponse, type NextRequest } from "next/server";

import { apiUrl } from "@/lib/api/config";
import type { CurrentUser, UserRole } from "@/lib/session-types";

interface RefreshedCookie {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
  path: string;
  maxAge?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseUser(value: unknown): CurrentUser | undefined {
  if (!isRecord(value)) return undefined;
  const role = value.role;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.email !== "string" ||
    (role !== "user" && role !== "admin" && role !== "moderator")
  ) {
    return undefined;
  }

  return {
    id: value.id,
    name: value.name,
    email: value.email,
    role,
    status:
      value.status === "suspended" || value.status === "deactivated"
        ? value.status
        : "active",
    phone: typeof value.phone === "string" ? value.phone : undefined,
    preferredCurrency:
      typeof value.preferredCurrency === "string"
        ? value.preferredCurrency
        : undefined,
    mustChangePassword: value.mustChangePassword === true,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : undefined,
  };
}

function parseRefreshedCookies(response: Response): RefreshedCookie[] {
  return response.headers.getSetCookie().flatMap((header) => {
    const [pair, ...attributes] = header.split(";");
    const separator = pair.indexOf("=");
    if (separator < 1) return [];

    const options: RefreshedCookie = {
      name: pair.slice(0, separator).trim(),
      value: pair.slice(separator + 1).trim(),
      httpOnly: attributes.some((attribute) => attribute.trim().toLowerCase() === "httponly"),
      secure: attributes.some((attribute) => attribute.trim().toLowerCase() === "secure"),
      sameSite: "lax",
      path: "/",
    };

    for (const attribute of attributes) {
      const [key, value] = attribute.trim().split("=", 2);
      if (key.toLowerCase() === "path" && value) options.path = value;
      if (key.toLowerCase() === "max-age" && value) {
        const maxAge = Number(value);
        if (Number.isFinite(maxAge)) options.maxAge = maxAge;
      }
      if (key.toLowerCase() === "samesite" && value) {
        const sameSite = value.toLowerCase();
        if (sameSite === "strict" || sameSite === "none") {
          options.sameSite = sameSite;
        }
      }
    }

    return [options];
  });
}

function updateRequestCookies(
  request: NextRequest,
  refreshedCookies: RefreshedCookie[],
): void {
  for (const cookie of refreshedCookies) {
    request.cookies.set(cookie.name, cookie.value);
  }
}

function cookieHeader(request: NextRequest): string {
  return request.cookies
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
}

async function currentUser(
  request: NextRequest,
): Promise<{ user?: CurrentUser; refreshedCookies: RefreshedCookie[] }> {
  const cookie = cookieHeader(request);
  const currentResponse = await fetch(apiUrl("/auth/me"), {
    headers: { cookie },
    cache: "no-store",
  });

  if (currentResponse.ok) {
    const payload: unknown = await currentResponse.json();
    return { user: parseUser(payload), refreshedCookies: [] };
  }

  if (currentResponse.status !== 401 || !request.cookies.has("refresh_token")) {
    return { refreshedCookies: [] };
  }

  const refreshResponse = await fetch(apiUrl("/auth/refresh"), {
    method: "POST",
    headers: { cookie },
    cache: "no-store",
  });
  if (!refreshResponse.ok) return { refreshedCookies: [] };

  const payload: unknown = await refreshResponse.json();
  const refreshedCookies = parseRefreshedCookies(refreshResponse);
  updateRequestCookies(request, refreshedCookies);
  const responseUser = isRecord(payload) ? parseUser(payload.user) : undefined;

  if (responseUser?.mustChangePassword) {
    return { user: responseUser, refreshedCookies };
  }

  const refreshedSessionResponse = await fetch(apiUrl("/auth/me"), {
    headers: { cookie: cookieHeader(request) },
    cache: "no-store",
  });
  if (!refreshedSessionResponse.ok) {
    return { user: responseUser, refreshedCookies };
  }

  const refreshedSessionPayload: unknown = await refreshedSessionResponse.json();
  return {
    user: parseUser(refreshedSessionPayload) ?? responseUser,
    refreshedCookies,
  };
}

function loginRedirect(request: NextRequest, expired = false): NextResponse {
  const login = new URL("/login", request.url);
  login.searchParams.set(
    "returnTo",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  if (expired) login.searchParams.set("reason", "session-expired");
  return NextResponse.redirect(login);
}

function homeForRole(role: UserRole): string {
  if (role === "admin") return "/admin";
  if (role === "moderator") return "/moderator";
  return "/dashboard";
}

function requiredRole(pathname: string): UserRole | undefined {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  if (pathname === "/moderator" || pathname.startsWith("/moderator/")) {
    return "moderator";
  }
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    return "user";
  }
  return undefined;
}

function applyRefreshedCookies(
  response: NextResponse,
  cookies: RefreshedCookie[],
): NextResponse {
  for (const cookie of cookies) {
    response.cookies.set(cookie.name, cookie.value, {
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
      path: cookie.path,
      maxAge: cookie.maxAge,
    });
  }
  return response;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const isLoginPage = pathname === "/login" || pathname === "/register";
  const isChangePasswordPage = pathname === "/account/change-password";
  const isProtectedPage =
    isChangePasswordPage ||
    pathname === "/account" ||
    pathname.startsWith("/account/") ||
    requiredRole(pathname) !== undefined;

  if (!isLoginPage && !isProtectedPage) return NextResponse.next();

  if (!request.cookies.has("access_token") && !request.cookies.has("refresh_token")) {
    return isProtectedPage ? loginRedirect(request) : NextResponse.next();
  }

  const { user, refreshedCookies } = await currentUser(request);
  if (!user) {
    return isProtectedPage
      ? applyRefreshedCookies(loginRedirect(request, true), refreshedCookies)
      : NextResponse.next();
  }

  if (isLoginPage) {
    const destination = user.mustChangePassword
      ? "/account/change-password"
      : homeForRole(user.role);
    return applyRefreshedCookies(
      NextResponse.redirect(new URL(destination, request.url)),
      refreshedCookies,
    );
  }

  if (user.mustChangePassword && !isChangePasswordPage) {
    return applyRefreshedCookies(
      NextResponse.redirect(new URL("/account/change-password", request.url)),
      refreshedCookies,
    );
  }

  const required = requiredRole(pathname);
  if (required && user.role !== required) {
    return applyRefreshedCookies(
      NextResponse.redirect(new URL(homeForRole(user.role), request.url)),
      refreshedCookies,
    );
  }

  if (refreshedCookies.length > 0) {
    return applyRefreshedCookies(
      NextResponse.next({ request }),
      refreshedCookies,
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/login", "/register", "/account/:path*", "/dashboard/:path*", "/admin/:path*", "/moderator/:path*"],
};
