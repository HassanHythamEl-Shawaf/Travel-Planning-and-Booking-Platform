const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

export const API_BASE_URL = (
  configuredApiUrl || "http://localhost:3000/api"
).replace(/\/+$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE_URL}/${path.replace(/^\/+/, "")}`;
}
