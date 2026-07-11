import { MemoryRouter, Route } from "@solidjs/router";
import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockApiClient } from "../api/mock/mockClient";
import { FleetProvider } from "../store/fleet";
import { Launch } from "./Launch";
import { roleForScope, SUGGESTED_REPOS, SUGGESTED_SCOPES } from "./launch-suggestions";

// Launch lets you spawn a session against ANY repo/scope (the backend registry is the source of
// truth, not a hardcoded frontend list) — repo/scope are free-text inputs with datalist hints.

// The launch action hits the real backend control-channel; mock the REST module, not the fleet's
// task-board client.
vi.mock("../api/backend/sessions", () => ({
  launchSession: vi.fn(async () => ({ id: "s-new" })),
  listSessions: vi.fn(async () => []),
  stopSession: vi.fn(async () => ({ ok: true })),
}));

import { launchSession } from "../api/backend/sessions";

function renderLaunch() {
  return render(() => (
    <MemoryRouter
      root={(p) => <FleetProvider client={new MockApiClient()}>{p.children}</FleetProvider>}
    >
      <Route path="/" component={Launch} />
    </MemoryRouter>
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("roleForScope", () => {
  it("maps main→architect and everything else→owner (any value)", () => {
    expect(roleForScope("main")).toBe("architect");
    expect(roleForScope(" main ")).toBe("architect");
    expect(roleForScope("frontend")).toBe("owner");
    expect(roleForScope("weber-anything")).toBe("owner");
  });
});

describe("launch suggestions", () => {
  it("includes the agents the user actually drives (weber, chater)", () => {
    expect(SUGGESTED_REPOS).toContain("omnifield/weber");
    expect(SUGGESTED_REPOS).toContain("omnifield/chater");
  });
});

describe("Launch screen", () => {
  it("renders repo/scope as free-text inputs backed by datalists", () => {
    const { container } = renderLaunch();
    // No hardcoded <select> gating what's manageable.
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector('input[list="launch-repos"]')).not.toBeNull();
    expect(container.querySelector('input[list="launch-scopes"]')).not.toBeNull();
    expect(container.querySelector("#launch-repos option[value='omnifield/weber']")).not.toBeNull();
    expect(container.querySelectorAll("#launch-scopes option").length).toBe(
      SUGGESTED_SCOPES.length,
    );
  });

  it("shows the role badge by main→architect / else→owner for any typed scope", () => {
    const { container, queryByText } = renderLaunch();
    const scope = container.querySelector<HTMLInputElement>('input[list="launch-scopes"]')!;

    fireEvent.input(scope, { target: { value: "frontend" } });
    expect(queryByText("(owner)")).not.toBeNull();

    fireEvent.input(scope, { target: { value: "main" } });
    expect(queryByText("(architect)")).not.toBeNull();
  });

  it("spawns against an arbitrary repo/scope not in the suggestions", async () => {
    const { container } = renderLaunch();

    const repo = container.querySelector<HTMLInputElement>('input[list="launch-repos"]')!;
    const scope = container.querySelector<HTMLInputElement>('input[list="launch-scopes"]')!;
    fireEvent.input(repo, { target: { value: "omnifield/chater" } });
    fireEvent.input(scope, { target: { value: "playwright" } });
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() =>
      expect(launchSession).toHaveBeenCalledWith(
        expect.objectContaining({ repo: "omnifield/chater", scope: "playwright" }),
      ),
    );
  });

  it("blocks submit until repo and scope are non-empty", () => {
    const { container } = renderLaunch();

    const scope = container.querySelector<HTMLInputElement>('input[list="launch-scopes"]')!;
    // repo pre-filled with a suggestion, scope still empty → submit disabled
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit.disabled).toBe(true);

    fireEvent.input(scope, { target: { value: "frontend" } });
    expect(submit.disabled).toBe(false);
    expect(launchSession).not.toHaveBeenCalled();
  });
});
