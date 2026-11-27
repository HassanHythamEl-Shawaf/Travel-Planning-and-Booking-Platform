import "server-only";

import { serverApiRequest } from "@/lib/api/server";
import type { CurrentUser } from "@/lib/session-types";

export type { CurrentUser } from "@/lib/session-types";

export async function getCurrentUser(): Promise<CurrentUser> {
  return serverApiRequest<CurrentUser>("/auth/me");
}

export async function requireCurrentUser(): Promise<CurrentUser> {
  return getCurrentUser();
}
