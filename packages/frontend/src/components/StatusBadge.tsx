import type { JSX } from "solid-js";
import type { SessionStatus, TaskStatus } from "../api/types";
import { STATUS_LABEL, TASK_STATUS_LABEL } from "../lib/format";

// Dumb presentational badge — maps a status to a labelled, colour-coded chip.
// Colours are driven by data attributes so all theming lives in CSS.

export function StatusBadge(props: { status: SessionStatus }): JSX.Element {
  return (
    <span class="badge" data-status={props.status}>
      <span class="badge-dot" />
      {STATUS_LABEL[props.status]}
    </span>
  );
}

export function TaskBadge(props: { status: TaskStatus }): JSX.Element {
  return (
    <span class="badge" data-task={props.status}>
      {TASK_STATUS_LABEL[props.status]}
    </span>
  );
}
