import type { ApiClient } from "./client";
import { MockApiClient } from "./mock/mockClient";

// Adapter selection lives HERE, once — chosen by env, not branched inside
// components (brief §Ключ). Today only the mock exists; when the real REST
// adapter lands it slots in behind the same ApiClient with no UI change:
//
//   const mode = import.meta.env.VITE_API ?? "mock";
//   return mode === "rest" ? new RestApiClient(baseUrl) : new MockApiClient();

let singleton: ApiClient | null = null;

export function createApiClient(): ApiClient {
  const mode = (import.meta.env?.VITE_API as string | undefined) ?? "mock";
  switch (mode) {
    case "mock":
    default:
      return new MockApiClient();
  }
}

/** Process-wide client used by the app shell. */
export function api(): ApiClient {
  if (!singleton) singleton = createApiClient();
  return singleton;
}

export type { ApiClient } from "./client";
export * from "./types";
