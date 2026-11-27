"use client";

import { apiErrorFromResponse, parseApiPayload } from "@/lib/api/errors";
import type { ApiError } from "@/lib/api/errors";
import { apiUrl } from "@/lib/api/config";

let refreshRequest: Promise<boolean> | undefined;

function isAuthenticationEndpoint(path: string): boolean {
  return /^\/?auth\/(login|register|refresh|me|logout|change-password)(?:\?|$)/.test(
    path,
  );
}

async function refreshSession(): Promise<boolean> {
  if (!refreshRequest) {
    refreshRequest = fetch(apiUrl("/auth/refresh"), {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    })
      .then((response) => response.ok)
      .finally(() => {
        refreshRequest = undefined;
      });
  }

  return refreshRequest;
}

function signalSessionExpired(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("session-expired"));
}

async function readResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = parseApiPayload(text, response.status);

  if (!response.ok) {
    const error = apiErrorFromResponse(response.status, payload);
    throw error;
  }

  return payload as T;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const request = () =>
    fetch(apiUrl(path), {
      ...init,
      headers,
      credentials: "include",
      cache: "no-store",
    });

  let response = await request();
  if (response.status === 401 && !isAuthenticationEndpoint(path)) {
    if (await refreshSession()) response = await request();
    if (response.status === 401) signalSessionExpired();
  }
  if (response.status === 403 && !isAuthenticationEndpoint(path)) {
    window.dispatchEvent(new Event("session-forbidden"));
  }

  return readResponse<T>(response);
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof Error && error.name === "ApiError";
}
