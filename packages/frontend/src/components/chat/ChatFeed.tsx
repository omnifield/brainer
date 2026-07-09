import { For, type JSX, Show } from "solid-js";
import type { FeedItem } from "../../store/chat/reducer";
import { DoneLine } from "./DoneLine";
import { ErrorNotice } from "./ErrorNotice";
import { LimitNotice } from "./LimitNotice";
import { MessageBubble } from "./MessageBubble";
import { PermissionPlaceholder } from "./PermissionPlaceholder";
import { StatusLine } from "./StatusLine";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolPair } from "./ToolPair";
import { WorkingIndicator } from "./WorkingIndicator";

// Composer (future HCA Widget): iterates the feed and dispatches each item to its per-type
// component by `kind`. Zero entity markup here and zero in the screen — the screen only mounts this.
export function ChatFeed(props: { items: FeedItem[]; working: boolean }): JSX.Element {
  return (
    <div class="chat-feed">
      <Show when={props.items.length > 0} fallback={<div class="chat-empty">No events yet.</div>}>
        <For each={props.items}>{(item) => <FeedRow item={item} />}</For>
      </Show>
      <WorkingIndicator working={props.working} />
    </div>
  );
}

function FeedRow(props: { item: FeedItem }): JSX.Element {
  const item = props.item;
  switch (item.kind) {
    case "message":
      return <MessageBubble event={item.event} />;
    case "thinking":
      return <ThinkingBlock event={item.event} />;
    case "tool":
      return <ToolPair call={item.call} result={item.result} />;
    case "status":
      return <StatusLine event={item.event} />;
    case "done":
      return <DoneLine event={item.event} />;
    case "error":
      return <ErrorNotice event={item.event} />;
    case "limit":
      return <LimitNotice event={item.event} />;
    case "permission":
      return <PermissionPlaceholder event={item.event} />;
  }
}
