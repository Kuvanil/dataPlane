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
    localStorage.removeItem("dp_token");
    window.location.href = "/login";
  }
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
