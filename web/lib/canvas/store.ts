"use client";

import { Canvas } from "./schema";
import { HermesAction } from "./actions";
import { applyAction } from "./reducer";
import { isAutoApply } from "./actions";
import { demoCanvas } from "./fixtures";

const STORAGE_KEY = "hermes_lab_canvas_v1";
const ACTIONS_KEY = "hermes_lab_actions_v1";
const AUDIT_KEY = "hermes_lab_audit_v1";

export interface AuditEvent {
  id: string;
  action_id: string;
  action_kind: HermesAction["kind"];
  decided_by: string;
  decision: "auto" | "approve" | "reject" | "undo";
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
    // Best-effort validate; if invalid, reset to demo.
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
  decision: "auto_applied" | "queued";
  previousCanvas?: Canvas;
  action: HermesAction;
}

function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

// Propose an action. If auto-apply policy permits, apply immediately and record
// audit; otherwise queue it for human approval.
export function propose(state: PersistedState, draft: Omit<HermesAction, "id" | "state" | "proposed_at">): ProposeResult {
  const action: HermesAction = {
    ...draft,
    id: newId("act"),
    state: "proposed",
    proposed_at: new Date().toISOString(),
  };

  if (isAutoApply(action)) {
    const result = applyAction(state.canvas, action);
    if (!result.ok) {
      const failed: HermesAction = { ...action, state: "rejected", decided_at: new Date().toISOString(), decided_by: "system", reject_reason: result.error };
      const nextState = {
        ...state,
        actions: [...state.actions, failed],
      };
      return { state: nextState, decision: "queued", action: failed };
    }
    const applied: HermesAction = { ...action, state: "auto_applied", decided_at: new Date().toISOString(), decided_by: "system" };
    const audit: AuditEvent = {
      id: newId("aud"),
      action_id: applied.id,
      action_kind: applied.kind,
      decided_by: "system",
      decision: "auto",
      at: applied.decided_at!,
      canvas_version_before: result.previous.version,
      canvas_version_after: result.canvas.version,
      rationale: applied.rationale,
    };
    return {
      state: {
        canvas: result.canvas,
        actions: [...state.actions, applied],
        audit: [...state.audit, audit],
      },
      decision: "auto_applied",
      previousCanvas: result.previous,
      action: applied,
    };
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
}

export function approve(state: PersistedState, actionId: string, decidedBy = "user"): DecideResult {
  const idx = state.actions.findIndex((a) => a.id === actionId);
  if (idx < 0) return { state, ok: false, error: "action not found" };
  const action = state.actions[idx];
  if (action.state !== "proposed") return { state, ok: false, error: `action is ${action.state}` };

  const result = applyAction(state.canvas, action);
  if (!result.ok) return { state, ok: false, error: result.error };

  const decided_at = new Date().toISOString();
  const applied: HermesAction = { ...action, state: "applied", decided_at, decided_by: decidedBy };
  const actions = state.actions.slice();
  actions[idx] = applied;
  const audit: AuditEvent = {
    id: newId("aud"),
    action_id: applied.id,
    action_kind: applied.kind,
    decided_by: decidedBy,
    decision: "approve",
    at: decided_at,
    canvas_version_before: result.previous.version,
    canvas_version_after: result.canvas.version,
    rationale: applied.rationale,
  };
  return {
    state: { canvas: result.canvas, actions, audit: [...state.audit, audit] },
    ok: true,
    previousCanvas: result.previous,
  };
}

export function reject(state: PersistedState, actionId: string, reason: string, decidedBy = "user"): DecideResult {
  const idx = state.actions.findIndex((a) => a.id === actionId);
  if (idx < 0) return { state, ok: false, error: "action not found" };
  const action = state.actions[idx];
  if (action.state !== "proposed") return { state, ok: false, error: `action is ${action.state}` };

  const decided_at = new Date().toISOString();
  const rejected: HermesAction = { ...action, state: "rejected", decided_at, decided_by: decidedBy, reject_reason: reason };
  const actions = state.actions.slice();
  actions[idx] = rejected;
  const audit: AuditEvent = {
    id: newId("aud"),
    action_id: rejected.id,
    action_kind: rejected.kind,
    decided_by: decidedBy,
    decision: "reject",
    at: decided_at,
    canvas_version_before: state.canvas.version,
    canvas_version_after: state.canvas.version,
    rationale: reason,
  };
  return { state: { ...state, actions, audit: [...state.audit, audit] }, ok: true };
}

// Undo: revert the canvas to a previous snapshot and mark the action as undone.
// Used for the 30s undo on auto-applied actions.
export function undo(state: PersistedState, actionId: string, previousCanvas: Canvas, decidedBy = "user"): DecideResult {
  const idx = state.actions.findIndex((a) => a.id === actionId);
  if (idx < 0) return { state, ok: false, error: "action not found" };
  const action = state.actions[idx];
  if (action.state !== "auto_applied" && action.state !== "applied") {
    return { state, ok: false, error: `cannot undo ${action.state}` };
  }
  const decided_at = new Date().toISOString();
  const undone: HermesAction = { ...action, state: "undone", decided_at, decided_by: decidedBy };
  const actions = state.actions.slice();
  actions[idx] = undone;
  const audit: AuditEvent = {
    id: newId("aud"),
    action_id: undone.id,
    action_kind: undone.kind,
    decided_by: decidedBy,
    decision: "undo",
    at: decided_at,
    canvas_version_before: state.canvas.version,
    canvas_version_after: previousCanvas.version,
    rationale: "undo within window",
  };
  return { state: { canvas: previousCanvas, actions, audit: [...state.audit, audit] }, ok: true };
}
