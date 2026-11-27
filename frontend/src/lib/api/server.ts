import "server-only";

import { cookies, headers as requestHeaders } from "next/headers";
import { notFound, redirect } from "next/navigation";

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
    const error = apiErrorFromResponse(response.status, payload, path);
    if (error.status === 401) {
      const currentHeaders = await requestHeaders();
      const returnTo = currentHeaders.get("x-wayfarer-path") ?? "/";
      const query = new URLSearchParams({
        reason: "session-expired",
        returnTo,
      });
      redirect(`/login?${query.toString()}`);
    }
    if (error.status === 403) redirect("/forbidden");
    if (error.status === 404) notFound();
    throw error;
  }

  return payload as T;
}
