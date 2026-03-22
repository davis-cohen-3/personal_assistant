let csrfToken: string | null = null;

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const method = (init?.method ?? "GET").toUpperCase();

  if (csrfToken && method !== "GET") {
    headers.set("X-CSRF-Token", csrfToken);
  }

  const res = await fetch(path, { ...init, headers, credentials: "same-origin" });

  return res;
}
