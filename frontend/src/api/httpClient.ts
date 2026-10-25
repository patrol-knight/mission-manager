import { API_BASE_URL } from "./config";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    throw new ApiError(res.status, body, errorMessage(body, res.statusText || `HTTP ${res.status}`));
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const http = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  put: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, {
      method: "PUT",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string): Promise<T> => request<T>(path, { method: "DELETE" }),
};
