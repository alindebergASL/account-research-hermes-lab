import assert from "node:assert/strict";
import test from "node:test";
import { demoCanvas } from "../web/lib/canvas/fixtures";
import { applyAction } from "../web/lib/canvas/reducer";
import { HermesAction, isAutoApply, validateActionPayload } from "../web/lib/canvas/actions";

const stockSource = {
  title: "Test source",
  url: "https://example.com/test",
  accessed: "2026-05-09",
};

function makeAction(partial: Partial<HermesAction>): HermesAction {
  return {
    id: "a1",
    kind: "append_widget",
    payload: {},
    rationale: "test",
    evidence: [],
    proposed_at: "2026-05-01T00:00:00Z",
    proposed_by: "hermes",
    state: "proposed",
    confidence: "High",
    fixture_only: true,
    ...partial,
  };
}

test("validateActionPayload rejects bad payloads", () => {
  assert.throws(() => validateActionPayload("remove_widget", {}));
  assert.throws(() => validateActionPayload("mark_status", { widget_id: "", status: "fresh" }));
});

test("isAutoApply: safe additive append_widget with evidence auto-applies", () => {
  const canvas = demoCanvas();
  const widget = { ...canvas.widgets[0], id: "w_new_metric" };
  const a = makeAction({
    kind: "append_widget",
    payload: { widget },
    evidence: [stockSource],
    confidence: "High",
  });
  assert.equal(isAutoApply(a), true);
});

test("isAutoApply: low confidence never auto-applies", () => {
  const canvas = demoCanvas();
  const widget = { ...canvas.widgets[0], id: "w_low" };
  const a = makeAction({
    kind: "append_widget",
    payload: { widget },
    evidence: [stockSource],
    confidence: "Low",
  });
  assert.equal(isAutoApply(a), false);
});

test("isAutoApply: no evidence never auto-applies", () => {
  const canvas = demoCanvas();
  const widget = { ...canvas.widgets[0], id: "w_noev" };
  const a = makeAction({
    kind: "append_widget",
    payload: { widget },
    evidence: [],
    confidence: "High",
  });
  assert.equal(isAutoApply(a), false);
});

test("isAutoApply: remove_widget and propose_refresh never auto-apply", () => {
  const removeAction = makeAction({
    kind: "remove_widget",
    payload: { widget_id: "w_metric_1" },
    evidence: [stockSource],
    confidence: "High",
  });
  assert.equal(isAutoApply(removeAction), false);

  const refreshAction = makeAction({
    kind: "propose_refresh",
    payload: { widget_id: "w_metric_1", scope: "widget", reason: "stale" },
    evidence: [stockSource],
    confidence: "High",
  });
  assert.equal(isAutoApply(refreshAction), false);
});

test("isAutoApply: action_panel append requires confirmation", () => {
  const canvas = demoCanvas();
  const actionPanel = canvas.widgets.find((w) => w.kind === "action_panel")!;
  const a = makeAction({
    kind: "append_widget",
    payload: { widget: { ...actionPanel, id: "w_ap_new" } },
    evidence: [stockSource],
    confidence: "High",
  });
  assert.equal(isAutoApply(a), false, "action_panel append should require confirmation");
});

test("isAutoApply: mark_status archived requires confirmation, fresh auto-applies", () => {
  const fresh = makeAction({
    kind: "mark_status",
    payload: { widget_id: "w_metric_1", status: "fresh" },
    evidence: [stockSource],
    confidence: "High",
  });
  const archived = makeAction({
    kind: "mark_status",
    payload: { widget_id: "w_metric_1", status: "archived" },
    evidence: [stockSource],
    confidence: "High",
  });
  assert.equal(isAutoApply(fresh), true);
  assert.equal(isAutoApply(archived), false);
});

test("applyAction append_widget bumps version and appends", () => {
  const canvas = demoCanvas();
  const widget = { ...canvas.widgets[0], id: "w_brand_new" };
  const a = makeAction({ kind: "append_widget", payload: { widget } });
  const r = applyAction(canvas, a);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.canvas.version, canvas.version + 1);
  assert.equal(r.canvas.widgets.length, canvas.widgets.length + 1);
  assert.equal(r.previous.version, canvas.version);
});

test("applyAction append_widget rejects duplicate id", () => {
  const canvas = demoCanvas();
  const a = makeAction({ kind: "append_widget", payload: { widget: canvas.widgets[0] } });
  const r = applyAction(canvas, a);
  assert.equal(r.ok, false);
});

test("applyAction remove_widget removes widget", () => {
  const canvas = demoCanvas();
  const a = makeAction({ kind: "remove_widget", payload: { widget_id: canvas.widgets[0].id } });
  const r = applyAction(canvas, a);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.canvas.widgets.length, canvas.widgets.length - 1);
});

test("applyAction add_evidence appends evidence and dedupes sources", () => {
  const canvas = demoCanvas();
  const target = canvas.widgets[0];
  const a = makeAction({
    kind: "add_evidence",
    payload: { widget_id: target.id, text: "new ev", source: stockSource, confidence: "High" },
  });
  const r = applyAction(canvas, a);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const updated = r.canvas.widgets.find((w) => w.id === target.id)!;
  assert.equal(updated.evidence.length, target.evidence.length + 1);
  assert.ok(updated.sources.some((s) => s.url === stockSource.url));

  // Re-apply same evidence — sources should not duplicate.
  const r2 = applyAction(r.canvas, a);
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  const reUpdated = r2.canvas.widgets.find((w) => w.id === target.id)!;
  const sourceMatches = reUpdated.sources.filter((s) => s.url === stockSource.url);
  assert.equal(sourceMatches.length, 1, "source should not duplicate");
});

test("applyAction mark_status updates status only", () => {
  const canvas = demoCanvas();
  const target = canvas.widgets[0];
  const a = makeAction({
    kind: "mark_status",
    payload: { widget_id: target.id, status: "watching" },
  });
  const r = applyAction(canvas, a);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.canvas.widgets[0].status, "watching");
});
