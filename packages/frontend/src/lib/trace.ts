// Perf/trace instrumentation (DoD: traces, not "later"). Wraps async work with a
// duration measurement so the ApiClient seam is observable — in dev it logs to
// console; a real backend adapter would forward the same spans to OTEL (the
// substrate ARCHITECTURE.md already describes). Kept tiny and side-effect-light.

const enabled =
  typeof import.meta !== "undefined" &&
  (import.meta.env?.DEV ?? false) &&
  (import.meta.env?.VITE_TRACE ?? "1") !== "0";

export interface TraceSpan {
  name: string;
  durationMs: number;
  ok: boolean;
}

const sinks: Array<(span: TraceSpan) => void> = [];

/** Register an observer of completed spans (used by tests / future OTEL bridge). */
export function onSpan(sink: (span: TraceSpan) => void): () => void {
  sinks.push(sink);
  return () => {
    const i = sinks.indexOf(sink);
    if (i >= 0) sinks.splice(i, 1);
  };
}

function emit(span: TraceSpan): void {
  if (enabled) {
    // Why: one-line span so the request seam is legible in the dev console.
    console.debug(
      `[trace] ${span.name} ${span.durationMs.toFixed(1)}ms ${span.ok ? "ok" : "ERR"}`,
    );
  }
  for (const sink of sinks) sink(span);
}

/** Measure an async operation, emitting a span regardless of outcome. */
export async function traced<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = now();
  try {
    const result = await fn();
    emit({ name, durationMs: now() - start, ok: true });
    return result;
  } catch (err) {
    emit({ name, durationMs: now() - start, ok: false });
    throw err;
  }
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
