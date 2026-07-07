import { describe, expect, it } from "vitest";
import {
  formatRelative,
  formatUptime,
  isTerminal,
  STATUS_LABEL,
  TASK_STATUS_LABEL,
} from "./format";

const iso = (msAgo: number, now: number) => new Date(now - msAgo).toISOString();

describe("formatUptime", () => {
  const now = Date.UTC(2026, 6, 7, 12, 0, 0);
  it("renders seconds under a minute", () => {
    expect(formatUptime(iso(42_000, now), now)).toBe("42s");
  });
  it("renders minutes under an hour", () => {
    expect(formatUptime(iso(5 * 60_000, now), now)).toBe("5m");
  });
  it("renders hours + minutes under a day", () => {
    expect(formatUptime(iso((2 * 60 + 15) * 60_000, now), now)).toBe("2h 15m");
  });
  it("renders days + hours beyond a day", () => {
    expect(formatUptime(iso((26 * 60) * 60_000, now), now)).toBe("1d 2h");
  });
  it("clamps future timestamps to 0s, never negative", () => {
    expect(formatUptime(iso(-5000, now), now)).toBe("0s");
  });
  it("returns em-dash for garbage input", () => {
    expect(formatUptime("not-a-date", now)).toBe("—");
  });
});

describe("formatRelative", () => {
  const now = Date.UTC(2026, 6, 7, 12, 0, 0);
  it("says just now under 10s", () => {
    expect(formatRelative(iso(3000, now), now)).toBe("just now");
  });
  it("renders seconds, minutes, hours, days", () => {
    expect(formatRelative(iso(30_000, now), now)).toBe("30s ago");
    expect(formatRelative(iso(3 * 60_000, now), now)).toBe("3m ago");
    expect(formatRelative(iso(4 * 3_600_000, now), now)).toBe("4h ago");
    expect(formatRelative(iso(3 * 86_400_000, now), now)).toBe("3d ago");
  });
});

describe("status helpers", () => {
  it("isTerminal is true only for done/error", () => {
    expect(isTerminal("done")).toBe(true);
    expect(isTerminal("error")).toBe(true);
    expect(isTerminal("working")).toBe(false);
    expect(isTerminal("idle")).toBe(false);
    expect(isTerminal("blocked")).toBe(false);
  });
  it("labels cover every status", () => {
    expect(STATUS_LABEL.working).toBe("Working");
    expect(TASK_STATUS_LABEL["in-progress"]).toBe("In progress");
  });
});
