const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("dp_token");
}

function authHeaders(includeContentType = true): Record<string, string> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (includeContentType) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function handle401() {
  if (typeof window !== "undefined") {
    // Allow higher-level code (e.g. useMapping) to run a best-effort flush
    // and surface a user-visible warning BEFORE the token is cleared and
    // the browser navigates. If no handler is registered, fall back to the
    // original silent-redirect behavior so non-schema-mapper pages are
    // unaffected (mapper_tasks/05_session_timeout_autosave_loss.md).
    onUnauthorized?.();
    localStorage.removeItem("dp_token");
    window.location.href = "/login";
  }
}

// Pluggable 401 callback so feature code (e.g. useMapping) can warn the
// user and attempt a best-effort flush before the token-clear + hard
// navigation happens. Optional; pages that don't register a handler get
// the original silent-redirect behavior unchanged.
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

export const api = {
  base: API_BASE,

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: authHeaders(false),
    });
    if (res.status === 401) { handle401(); throw new ApiError(401, "Unauthorized"); }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body?.detail ?? res.statusText);
    }
    return res.json() as Promise<T>;
  },

  async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(body),
    });
    if (res.status === 401) { handle401(); throw new ApiError(401, "Unauthorized"); }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new ApiError(res.status, errBody?.detail ?? res.statusText);
    }
    return res.json() as Promise<T>;
  },

  async put<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "PUT",
      headers: authHeaders(true),
      body: JSON.stringify(body),
    });
    if (res.status === 401) { handle401(); throw new ApiError(401, "Unauthorized"); }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new ApiError(res.status, errBody?.detail ?? res.statusText);
    }
    return res.json() as Promise<T>;
  },

  async delete(path: string): Promise<void> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "DELETE",
      headers: authHeaders(false),
    });
    if (res.status === 401) { handle401(); throw new ApiError(401, "Unauthorized"); }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body?.detail ?? res.statusText);
    }
  },
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
