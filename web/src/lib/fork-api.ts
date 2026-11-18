import { getRequestToken } from "@/connect";

/** A refused call to a fork endpoint, with the status and the JSON body the server sent. */
export class ForkApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ForkApiError";
  }
}

/** Calls one of the fork's own endpoints (`/api/x/...`) as the signed-in user. */
export async function forkFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await getRequestToken();
  const response = await fetch(path, {
    method: init.method ?? "GET",
    credentials: "include",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    const body = await response
      .json()
      .then((value: unknown) => (value && typeof value === "object" ? (value as Record<string, unknown>) : {}))
      .catch(() => ({}) as Record<string, unknown>);
    throw new ForkApiError(typeof body.message === "string" ? body.message : `HTTP ${response.status}`, response.status, body);
  }
  return (await response.json()) as T;
}
