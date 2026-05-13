import assert from "node:assert/strict";
import test from "node:test";
import { demoCanvas } from "../web/lib/canvas/fixtures";
import { applyAction } from "../web/lib/canvas/reducer";
import {
  approve,
  propose,
  reject,
  retry,
  undo,
  PersistedState,
} from "../web/lib/canvas/store";
import type { HermesAction } from "../web/lib/canvas/actions";

const stockSource = {
  title: "Test source",
  url: "https://example.com/test",
  accessed: "2026-05-09",
};

function freshState(): PersistedState {
  return { canvas: demoCanvas(), actions: [], audit: [] };
}

function safeAppendDraft(over: Partial<Omit<HermesAction, "id" | "state" | "proposed_at">> = {}) {
  return {
    kind: "append_widget" as const,
    payload: { widget: { ...demoCanvas().widgets[0], id: "w_safe", idem_key: "test:safe" } },
    rationale: "test",
    evidence: [stockSource],
    proposed_by: "hermes" as const,
    confidence: "High" as const,
    fixture_only: true,
    ...over,
  };
}

test("idem_key dedupes a duplicate append_widget", () => {
  const canvas = demoCanvas();
  const widget = { ...canvas.widgets[0], id: "w_new", idem_key: "shared-key" };
  const action: HermesAction = {
    id: "a1",
    kind: "append_widget",
    payload: { widget },
    rationale: "first",
    evidence: [stockSource],
    proposed_at: "2026-05-01T00:00:00Z",
    proposed_by: "hermes",
    state: "proposed",
    confidence: "High",
    fixture_only: true,
  };
  const r1 = applyAction(canvas, action);
  assert.equal(r1.ok, true);
  if (!r1.ok) return;

  const dup: HermesAction = {
    ...action,
    id: "a2",
    payload: { widget: { ...widget, id: "w_new_2" } },
  };
  const r2 = applyAction(r1.canvas, dup);
  assert.equal(r2.ok, false, "second action with same idem_key should be rejected");
});

test("propose refuses actions missing fixture_only marker", () => {
  const state = freshState();
  const draft = safeAppendDraft();
  delete (draft as Partial<typeof draft>).fixture_only;
  const r = propose(state, draft as Parameters<typeof propose>[1]);
  assert.equal(r.decision, "failed");
  assert.equal(r.action.state, "failed");
  assert.match(r.action.error ?? "", /fixture_only/);
  assert.equal(r.state.canvas.widgets.length, state.canvas.widgets.length);
});

test("approve transitions: proposed -> applying -> applied", () => {
  let state = freshState();
  const proposed = propose(state, safeAppendDraft({
    kind: "remove_widget",
    payload: { widget_id: state.canvas.widgets[0].id },
  }));
  state = proposed.state;
  assert.equal(proposed.action.state, "proposed");

  const r = approve(state, proposed.action.id);
  assert.equal(r.ok, true);
  assert.equal(r.action?.state, "applied");
  assert.equal(r.state.canvas.widgets.length, freshState().canvas.widgets.length - 1);
});

test("approve of a remove targeting a missing widget yields failed (not crash)", () => {
  let state = freshState();
  const proposed = propose(state, safeAppendDraft({
    kind: "remove_widget",
    payload: { widget_id: "no_such_widget" },
  }));
  state = proposed.state;

  const r = approve(state, proposed.action.id);
  assert.equal(r.ok, false);
  assert.equal(r.action?.state, "failed");
  assert.match(r.action?.error ?? "", /not found/);
});

test("retry of a failed action creates a new proposed action with retry_of set", () => {
  let state = freshState();
  const proposed = propose(state, safeAppendDraft({
    kind: "remove_widget",
    payload: { widget_id: "no_such_widget" },
  }));
  state = proposed.state;
  const failed = approve(state, proposed.action.id);
  assert.equal(failed.action?.state, "failed");
  state = failed.state;

  const r = retry(state, failed.action!.id);
  assert.equal(r.ok, true);
  assert.equal(r.action?.state, "proposed");
  assert.equal(r.action?.retry_of, failed.action!.id);
  // Original failed action remains in history.
  assert.ok(r.state.actions.find((a) => a.id === failed.action!.id && a.state === "failed"));
});

test("auto-apply failure surfaces as failed action with audit fail event", () => {
  // Force a duplicate-id append: first auto-applies, second auto-applies path
  // hits the reducer's duplicate check.
  let state = freshState();
  const r1 = propose(state, safeAppendDraft());
  assert.equal(r1.decision, "auto_applied");
  state = r1.state;

  const r2 = propose(state, safeAppendDraft());
  assert.equal(r2.decision, "failed");
  assert.equal(r2.action.state, "failed");
  assert.ok(r2.state.audit.some((ev) => ev.decision === "fail"));
});

test("reject works on both proposed and failed states", () => {
  let state = freshState();
  const proposed = propose(state, safeAppendDraft({
    kind: "remove_widget",
    payload: { widget_id: state.canvas.widgets[0].id },
  }));
  state = proposed.state;

  const r = reject(state, proposed.action.id, "wrong widget");
  assert.equal(r.ok, true);
  assert.equal(r.action?.state, "rejected");
  state = r.state;

  // A second reject should fail.
  const r2 = reject(state, proposed.action.id, "again");
  assert.equal(r2.ok, false);
});

test("undo round-trips the canvas to its previous version", () => {
  const state = freshState();
  const r = propose(state, safeAppendDraft());
  assert.equal(r.decision, "auto_applied");
  assert.ok(r.previousCanvas);
  const u = undo(r.state, r.action.id, r.previousCanvas!);
  assert.equal(u.ok, true);
  assert.equal(u.action?.state, "undone");
  assert.equal(u.state.canvas.widgets.length, state.canvas.widgets.length);
});
