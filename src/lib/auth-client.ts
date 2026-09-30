export type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
let refreshPromise: Promise<void> | null = null;
export async function refresh() {
  if (!refreshPromise)
    refreshPromise = fetch("/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then(async (r) => {
        if (!r.ok) throw new ApiError(r.status, "Please log in again.");
      })
      .finally(() => {
        refreshPromise = null;
      });
  return refreshPromise;
}
export async function authRequest<T>(
  path: string,
  body?: unknown,
  retry = true,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/auth${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(
      503,
      "The application server is unavailable. Please try again shortly.",
    );
  }
  if (response.status === 401 && path === "/me" && retry) {
    await refresh();
    return authRequest<T>(path, body, false);
  }
  let value;
  try {
    value = await response.json();
  } catch {
    throw new ApiError(
      503,
      "The application server is unavailable. Please try again shortly.",
    );
  }
  if (!response.ok)
    throw new ApiError(
      response.status,
      value.message || "The request could not be completed.",
    );
  return value.data;
}
