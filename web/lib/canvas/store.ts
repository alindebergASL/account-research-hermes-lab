"use client";

import { Canvas } from "./schema";
import { HermesAction } from "./actions";
import { applyAction } from "./reducer";
import { isAutoApply } from "./actions";
import { demoCanvas } from "./fixtures";
import { transition, ActionState } from "./lifecycle";

const STORAGE_KEY = "hermes_lab_canvas_v1";
const ACTIONS_KEY = "hermes_lab_actions_v2";
const AUDIT_KEY = "hermes_lab_audit_v1";

export interface AuditEvent {
  id: string;
  action_id: string;
  action_kind: HermesAction["kind"];
  decided_by: string;
  decision: "auto" | "approve" | "reject" | "undo" | "fail" | "retry";
  at: string;
  canvas_version_before: number;
  canvas_version_after: number;
  rationale: string;
}

export interface PersistedState {
  canvas: Canvas;
  actions: HermesAction[];
  audit: AuditEvent[];
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadState(): PersistedState {
  if (typeof window === "undefined") {
    return { canvas: demoCanvas(), actions: [], audit: [] };
  }
  const canvasRaw = window.localStorage.getItem(STORAGE_KEY);
  const actionsRaw = window.localStorage.getItem(ACTIONS_KEY);
  const auditRaw = window.localStorage.getItem(AUDIT_KEY);

  let canvas: Canvas;
  const parsed = safeParse<Canvas | null>(canvasRaw, null);
  if (parsed) {
    const result = Canvas.safeParse(parsed);
    canvas = result.success ? result.data : demoCanvas();
  } else {
    canvas = demoCanvas();
  }

  return {
    canvas,
    actions: safeParse<HermesAction[]>(actionsRaw, []),
    audit: safeParse<AuditEvent[]>(auditRaw, []),
  };
}

export function saveState(state: PersistedState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.canvas));
  window.localStorage.setItem(ACTIONS_KEY, JSON.stringify(state.actions));
  window.localStorage.setItem(AUDIT_KEY, JSON.stringify(state.audit));
}

export function resetDemo(): PersistedState {
  const state = { canvas: demoCanvas(), actions: [], audit: [] };
  saveState(state);
  return state;
}

export interface ProposeResult {
  state: PersistedState;
  decision: "auto_applied" | "queued" | "failed";
  previousCanvas?: Canvas;
  action: HermesAction;
}

function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function moveTo(state: PersistedState, idx: number, next: HermesAction): PersistedState {
  const actions = state.actions.slice();
  actions[idx] = next;
  return { ...state, actions };
}

function transitionAction(action: HermesAction, event: Parameters<typeof transition>[1], extra: Partial<HermesAction> = {}): HermesAction {
  const next: ActionState = transition(action.state, event);
  return { ...action, state: next, ...extra };
}

function audit(state: PersistedState, ev: Omit<AuditEvent, "id">): PersistedState {
  return { ...state, audit: [...state.audit, { id: newId("aud"), ...ev }] };
}

// Propose an action. Refuses anything not stamped fixture_only (defense in
// depth: lab store must only ever apply lab-originated actions).
export function propose(state: PersistedState, draft: Omit<HermesAction, "id" | "state" | "proposed_at">): ProposeResult {
  if (draft.fixture_only !== true) {
    const failed: HermesAction = {
      ...draft,
      id: newId("act"),
      proposed_at: new Date().toISOString(),
      state: "failed",
      decided_at: new Date().toISOString(),
      decided_by: "system",
      error: "lab store rejects actions without fixture_only=true",
    };
    return { state: { ...state, actions: [...state.actions, failed] }, decision: "failed", action: failed };
  }

  const action: HermesAction = {
    ...draft,
    id: newId("act"),
    state: "proposed",
    proposed_at: new Date().toISOString(),
  };

  if (isAutoApply(action)) {
    const result = applyAction(state.canvas, action);
    if (!result.ok) {
      const failed = transitionAction(action, "auto_apply_fail", {
        decided_at: new Date().toISOString(),
        decided_by: "system",
        error: result.error,
      });
      const next = audit(
        { ...state, actions: [...state.actions, failed] },
        {
          action_id: failed.id,
          action_kind: failed.kind,
          decided_by: "system",
          decision: "fail",
          at: failed.decided_at!,
          canvas_version_before: state.canvas.version,
          canvas_version_after: state.canvas.version,
          rationale: result.error,
        },
      );
      return { state: next, decision: "failed", action: failed };
    }
    const applied = transitionAction(action, "auto_apply_ok", {
      decided_at: new Date().toISOString(),
      decided_by: "system",
    });
    const next = audit(
      {
        ...state,
        canvas: result.canvas,
        actions: [...state.actions, applied],
      },
      {
        action_id: applied.id,
        action_kind: applied.kind,
        decided_by: "system",
        decision: "auto",
        at: applied.decided_at!,
        canvas_version_before: result.previous.version,
        canvas_version_after: result.canvas.version,
        rationale: applied.rationale,
      },
    );
    return { state: next, decision: "auto_applied", previousCanvas: result.previous, action: applied };
  }

  return {
    state: { ...state, actions: [...state.actions, action] },
    decision: "queued",
    action,
  };
}

export interface DecideResult {
  state: PersistedState;
  ok: boolean;
  error?: string;
  previousCanvas?: Canvas;
  action?: HermesAction;
}

// Approve a queued action. Models a tiny optimistic apply: the action briefly
// passes through `applying` before resolving to `applied` or `failed`. Callers
// in the lab call this synchronously; production can wrap with a real async
// boundary by splitting into `beginApprove` + `completeApprove`.
export function approve(state: PersistedState, actionId: string, decidedBy = "user"): DecideResult {
  const idx = state.actions.findIndex((a) => a.id === actionId);
  if (idx < 0) return { state, ok: false, error: "action not found" };
  const action = state.actions[idx];
  if (action.state !== "proposed") return { state, ok: false, error: `action is ${action.state}` };

  const applying = transitionAction(action, "approve_start");
  let working = moveTo(state, idx, applying);

  const result = applyAction(state.canvas, action);
  const decided_at = new Date().toISOString();

  if (!result.ok) {
    const failed = transitionAction(applying, "approve_fail", {
      decided_at,
      decided_by: decidedBy,
      error: result.error,
    });
    working = moveTo(working, idx, failed);
    working = audit(working, {
      action_id: failed.id,
      action_kind: failed.kind,
      decided_by: decidedBy,
      decision: "fail",
      at: decided_at,
      canvas_version_before: state.canvas.version,
      canvas_version_after: state.canvas.version,
      rationale: result.error,
    });
    return { state: working, ok: false, error: result.error, action: failed };
  }

  const applied = transitionAction(applying, "approve_ok", { decided_at, decided_by: decidedBy });
  working = moveTo(working, idx, applied);
  working = { ...working, canvas: result.canvas };
  working = audit(working, {
    action_id: applied.id,
    action_kind: applied.kind,
    decided_by: decidedBy,
    decision: "approve",
    at: decided_at,
    canvas_version_before: result.previous.version,
    canvas_version_after: result.canvas.version,
    rationale: applied.rationale,
  });
  return { state: working, ok: true, previousCanvas: result.previous, action: applied };
}

export function reject(state: PersistedState, actionId: string, reason: string, decidedBy = "user"): DecideResult {
  const idx = state.actions.findIndex((a) => a.id === actionId);
  if (idx < 0) return { state, ok: false, error: "action not found" };
  const action = state.actions[idx];
  if (action.state !== "proposed" && action.state !== "failed") {
    return { state, ok: false, error: `action is ${action.state}` };
  }

  const decided_at = new Date().toISOString();
  const rejected = transitionAction(action, "reject", { decided_at, decided_by: decidedBy, reject_reason: reason });
  let working = moveTo(state, idx, rejected);
  working = audit(working, {
    action_id: rejected.id,
    action_kind: rejected.kind,
    decided_by: decidedBy,
    decision: "reject",
    at: decided_at,
    canvas_version_before: state.canvas.version,
    canvas_version_after: state.canvas.version,
    rationale: reason,
  });
  return { state: working, ok: true, action: rejected };
}

// Move a `failed` action back to `proposed`. The original failed record stays
// in history; we append a fresh `proposed` action that references it via
// `retry_of` (so the audit trail remains intact).
export function retry(state: PersistedState, actionId: string, decidedBy = "user"): DecideResult {
  const idx = state.actions.findIndex((a) => a.id === actionId);
  if (idx < 0) return { state, ok: false, error: "action not found" };
  const original = state.actions[idx];
  if (original.state !== "failed") return { state, ok: false, error: `cannot retry ${original.state}` };

  const reproposed: HermesAction = {
    ...original,
    id: newId("act"),
    state: "proposed",
    proposed_at: new Date().toISOString(),
    decided_at: undefined,
    decided_by: undefined,
    error: undefined,
    retry_of: original.id,
  };
  let working = { ...state, actions: [...state.actions, reproposed] };
  working = audit(working, {
    action_id: reproposed.id,
    action_kind: reproposed.kind,
    decided_by: decidedBy,
    decision: "retry",
    at: reproposed.proposed_at,
    canvas_version_before: state.canvas.version,
    canvas_version_after: state.canvas.version,
    rationale: `retry of ${original.id}`,
  });
  return { state: working, ok: true, action: reproposed };
}

// Undo: revert canvas to a previous snapshot and mark action undone.
export function undo(state: PersistedState, actionId: string, previousCanvas: Canvas, decidedBy = "user"): DecideResult {
  const idx = state.actions.findIndex((a) => a.id === actionId);
  if (idx < 0) return { state, ok: false, error: "action not found" };
  const action = state.actions[idx];
  if (action.state !== "auto_applied" && action.state !== "applied") {
    return { state, ok: false, error: `cannot undo ${action.state}` };
  }
  const decided_at = new Date().toISOString();
  const undone = transitionAction(action, "undo", { decided_at, decided_by: decidedBy });
  let working = moveTo(state, idx, undone);
  working = { ...working, canvas: previousCanvas };
  working = audit(working, {
    action_id: undone.id,
    action_kind: undone.kind,
    decided_by: decidedBy,
    decision: "undo",
    at: decided_at,
    canvas_version_before: state.canvas.version,
    canvas_version_after: previousCanvas.version,
    rationale: "undo within window",
  });
  return { state: working, ok: true, action: undone };
}
