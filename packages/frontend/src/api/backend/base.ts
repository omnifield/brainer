// Base URL + JSON fetch helper for the backend BFF. All network side-effects live under api/
// (brief §5). In dev the base is "" and Vite proxies /sessions + /api to :8000; set VITE_API_BASE
// to point straight at a deployed backend.

const BASE: string = (import.meta.env?.VITE_API_BASE as string | undefined) ?? "";

export function backendUrl(path: string): string {
  return `${BASE}${path}`;
}

/** POST JSON and parse the JSON reply; throws with the backend's error detail on non-2xx. */
export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(backendUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return handle<T>(res);
}

/** GET JSON and parse the JSON reply; throws with the backend's error detail on non-2xx. */
export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(backendUrl(path));
  return handle<T>(res);
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(await errorDetail(res));
  }
  return (await res.json()) as T;
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string };
    if (body?.detail) return `${res.status}: ${body.detail}`;
  } catch {
    /* non-JSON body */
  }
  return `${res.status} ${res.statusText}`;
}
