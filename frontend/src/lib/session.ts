import "server-only";

import { redirect } from "next/navigation";

import { serverApiRequest } from "@/lib/api/server";
import { ApiError } from "@/lib/api/errors";
import type { CurrentUser } from "@/lib/session-types";

export type { CurrentUser } from "@/lib/session-types";

export async function getCurrentUser(): Promise<CurrentUser> {
  return serverApiRequest<CurrentUser>("/auth/me");
}

export async function requireCurrentUser(): Promise<CurrentUser> {
  try {
    return await getCurrentUser();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirect("/login?reason=session-expired");
    }
    throw error;
  }
}
