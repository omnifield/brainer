import { A, useLocation } from "@solidjs/router";
import { For, type JSX, onCleanup, onMount, Show } from "solid-js";
import { api } from "./api";
import { toastMessage } from "./lib/toast";
import { FleetProvider, useFleet } from "./store/fleet";

// App shell: provides the fleet store, boots data + live streams once, and frames
// every route with the sidebar. Route screens render into {props.children}.

const NAV = [
  { href: "/", label: "Fleet", end: true },
  { href: "/board", label: "Tasks", end: false },
  { href: "/launch", label: "Launch", end: false },
];

export function AppLayout(props: { children?: JSX.Element }): JSX.Element {
  return (
    <FleetProvider client={api()}>
      <Shell>{props.children}</Shell>
    </FleetProvider>
  );
}

function Shell(props: { children?: JSX.Element }): JSX.Element {
  const { state, actions } = useFleet();
  const location = useLocation();

  onMount(async () => {
    await actions.load();
    actions.startPolling();
  });
  onCleanup(() => actions.stopPolling());

  const isActive = (href: string, end: boolean) =>
    end ? location.pathname === href : location.pathname.startsWith(href);

  const workingCount = () => state.sessions.filter((s) => s.status === "running").length;
  const openTasks = () => state.tasks.filter((t) => t.status !== "done").length;

  return (
    <div class="shell">
      <nav class="sidebar">
        <div class="brand">
          Brainer <small>control panel</small>
        </div>
        <For each={NAV}>
          {(item) => (
            <A
              href={item.href}
              class="nav-link"
              classList={{ active: isActive(item.href, item.end) }}
            >
              {item.label}
              <Show when={item.href === "/"}>
                <span class="nav-count">{workingCount()}</span>
              </Show>
              <Show when={item.href === "/board"}>
                <span class="nav-count">{openTasks()}</span>
              </Show>
            </A>
          )}
        </For>
        <div class="spacer" />
        <div class="faint" style={{ padding: "10px", "font-size": "11px" }}>
          live control-channel · contract-first
        </div>
      </nav>
      <main class="main">{props.children}</main>
      <Show when={toastMessage()}>
        <div class="toast">{toastMessage()}</div>
      </Show>
    </div>
  );
}
