import type { HermesActionKind } from "./actions";

// Pure FSM for HermesAction.state. Used by reducer/store to enforce that all
// state changes are explicit and auditable. Production can later promote this
// table verbatim and back it with audit-event emission per transition.

export type ActionState =
  | "proposed"
  | "applying"
  | "auto_applied"
  | "applied"
  | "failed"
  | "rejected"
  | "undone"
  | "expired";

export type ActionEvent =
  | "auto_apply_ok"      // auto-apply policy permitted, reducer succeeded
  | "auto_apply_fail"    // auto-apply policy permitted, reducer rejected
  | "approve_start"      // human approved; about to apply
  | "approve_ok"         // approved + reducer succeeded
  | "approve_fail"       // approved + reducer rejected
  | "reject"             // human rejected
  | "undo"               // human undid within window
  | "retry"              // failed action moved back to proposed
  | "expire";            // window passed

// Allowed transitions. Any state change not in this table is a bug.
const TRANSITIONS: Record<ActionState, Partial<Record<ActionEvent, ActionState>>> = {
  proposed: {
    auto_apply_ok: "auto_applied",
    auto_apply_fail: "failed",
    approve_start: "applying",
    reject: "rejected",
    expire: "expired",
  },
  applying: {
    approve_ok: "applied",
    approve_fail: "failed",
  },
  auto_applied: {
    undo: "undone",
    expire: "auto_applied", // expiry of undo window does not change state
  },
  applied: {
    undo: "undone",
  },
  failed: {
    retry: "proposed",
    reject: "rejected",
  },
  rejected: {},
  undone: {},
  expired: {},
};

export const ACTION_STATES: readonly ActionState[] = [
  "proposed",
  "applying",
  "auto_applied",
  "applied",
  "failed",
  "rejected",
  "undone",
  "expired",
];

export const TERMINAL_STATES: ReadonlySet<ActionState> = new Set([
  "rejected",
  "undone",
  "expired",
]);

export function canTransition(from: ActionState, event: ActionEvent): boolean {
  return TRANSITIONS[from]?.[event] !== undefined;
}

export function transition(from: ActionState, event: ActionEvent): ActionState {
  const next = TRANSITIONS[from]?.[event];
  if (next === undefined) {
    throw new Error(`invalid transition: ${from} -[${event}]-> ?`);
  }
  return next;
}

// Per-state UI hints. Pure data; no React. Production can map these to chips.
export interface StateHint {
  label: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
  needsApproval: boolean;
  isUndoable: boolean;
  isRetryable: boolean;
}

export const STATE_HINTS: Record<ActionState, StateHint> = {
  proposed:     { label: "proposed",     tone: "warning",  needsApproval: true,  isUndoable: false, isRetryable: false },
  applying:     { label: "applying",     tone: "info",     needsApproval: false, isUndoable: false, isRetryable: false },
  auto_applied: { label: "auto applied", tone: "success",  needsApproval: false, isUndoable: true,  isRetryable: false },
  applied:      { label: "applied",      tone: "success",  needsApproval: false, isUndoable: true,  isRetryable: false },
  failed:       { label: "failed",       tone: "danger",   needsApproval: false, isUndoable: false, isRetryable: true  },
  rejected:     { label: "rejected",     tone: "neutral",  needsApproval: false, isUndoable: false, isRetryable: false },
  undone:       { label: "undone",       tone: "neutral",  needsApproval: false, isUndoable: false, isRetryable: false },
  expired:      { label: "expired",      tone: "neutral",  needsApproval: false, isUndoable: false, isRetryable: false },
};

// Utility: which action kinds are destructive vs additive. Used by UI badges and
// production gating.
const DESTRUCTIVE: ReadonlySet<HermesActionKind> = new Set(["remove_widget"]);
const COSTLY: ReadonlySet<HermesActionKind> = new Set(["propose_refresh"]);

export function isDestructive(kind: HermesActionKind): boolean {
  return DESTRUCTIVE.has(kind);
}

export function isCostly(kind: HermesActionKind): boolean {
  return COSTLY.has(kind);
}
