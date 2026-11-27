import "server-only";

import { cookies } from "next/headers";

import { apiErrorFromResponse, parseApiPayload } from "@/lib/api/errors";
import { apiUrl } from "@/lib/api/config";

export async function serverApiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const cookieHeader = (await cookies())
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  const headers = new Headers(init.headers);
  if (cookieHeader) headers.set("cookie", cookieHeader);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(apiUrl(path), {
    ...init,
    headers,
    cache: "no-store",
  });
  const text = await response.text();
  const payload = parseApiPayload(text, response.status);

  if (!response.ok) {
    throw apiErrorFromResponse(response.status, payload);
  }

  return payload as T;
}
