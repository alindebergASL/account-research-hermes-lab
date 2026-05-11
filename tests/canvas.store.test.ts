import assert from "node:assert/strict";
import test from "node:test";
import { demoCanvas } from "../web/lib/canvas/fixtures";
import { approve, propose, reject, undo, PersistedState } from "../web/lib/canvas/store";
import type { HermesAction } from "../web/lib/canvas/actions";

const stockSource = {
  title: "Test source",
  url: "https://example.com/test",
  accessed: "2026-05-09",
};

function freshState(): PersistedState {
  return { canvas: demoCanvas(), actions: [], audit: [] };
}

function draft(over: Partial<Omit<HermesAction, "id" | "state" | "proposed_at">> = {}) {
  return {
    kind: "append_widget" as const,
    payload: { widget: { ...demoCanvas().widgets[0], id: "w_x" } },
    rationale: "test",
    evidence: [stockSource],
    proposed_by: "hermes" as const,
    confidence: "High" as const,
    ...over,
  };
}

test("propose auto-applies safe additive action and emits audit event", () => {
  const state = freshState();
  const result = propose(state, draft());
  assert.equal(result.decision, "auto_applied");
  assert.equal(result.state.canvas.widgets.length, state.canvas.widgets.length + 1);
  assert.equal(result.state.audit.length, 1);
  assert.equal(result.state.audit[0].decision, "auto");
  assert.ok(result.previousCanvas, "should return previousCanvas for undo");
});

test("propose queues risky destructive action without applying", () => {
  const state = freshState();
  const result = propose(state, draft({ kind: "remove_widget", payload: { widget_id: state.canvas.widgets[0].id } }));
  assert.equal(result.decision, "queued");
  assert.equal(result.state.canvas.widgets.length, state.canvas.widgets.length);
  assert.equal(result.state.actions.length, 1);
  assert.equal(result.state.actions[0].state, "proposed");
});

test("approve applies queued action and emits audit", () => {
  let state = freshState();
  const proposed = propose(state, draft({ kind: "remove_widget", payload: { widget_id: state.canvas.widgets[0].id } }));
  state = proposed.state;

  const r = approve(state, proposed.action.id);
  assert.equal(r.ok, true);
  assert.equal(r.state.canvas.widgets.length, freshState().canvas.widgets.length - 1);
  assert.equal(r.state.audit.at(-1)?.decision, "approve");
});

test("reject marks action rejected and does not mutate canvas", () => {
  let state = freshState();
  const proposed = propose(state, draft({ kind: "remove_widget", payload: { widget_id: state.canvas.widgets[0].id } }));
  state = proposed.state;

  const r = reject(state, proposed.action.id, "wrong widget");
  assert.equal(r.ok, true);
  assert.equal(r.state.canvas.widgets.length, freshState().canvas.widgets.length);
  const rejected = r.state.actions.find((a) => a.id === proposed.action.id)!;
  assert.equal(rejected.state, "rejected");
  assert.equal(rejected.reject_reason, "wrong widget");
});

test("undo reverts to previous canvas and marks action undone", () => {
  const state = freshState();
  const result = propose(state, draft());
  assert.equal(result.decision, "auto_applied");
  assert.ok(result.previousCanvas);
  const r = undo(result.state, result.action.id, result.previousCanvas!);
  assert.equal(r.ok, true);
  assert.equal(r.state.canvas.widgets.length, state.canvas.widgets.length);
  const undone = r.state.actions.find((a) => a.id === result.action.id)!;
  assert.equal(undone.state, "undone");
});

test("approve twice fails on second call", () => {
  let state = freshState();
  const proposed = propose(state, draft({ kind: "remove_widget", payload: { widget_id: state.canvas.widgets[0].id } }));
  state = proposed.state;
  const r1 = approve(state, proposed.action.id);
  assert.equal(r1.ok, true);
  const r2 = approve(r1.state, proposed.action.id);
  assert.equal(r2.ok, false);
});
