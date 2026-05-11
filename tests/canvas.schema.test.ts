import assert from "node:assert/strict";
import test from "node:test";
import { Canvas, CanvasWidget } from "../web/lib/canvas/schema";
import { demoCanvas } from "../web/lib/canvas/fixtures";
import { WIDGET_REGISTRY, ALL_WIDGET_KINDS } from "../web/lib/canvas/registry";

test("demoCanvas validates against Canvas schema", () => {
  const parsed = Canvas.safeParse(demoCanvas());
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.format()));
});

test("every fixture matches its kind's data schema and parses as CanvasWidget", () => {
  for (const kind of ALL_WIDGET_KINDS) {
    const desc = WIDGET_REGISTRY[kind];
    assert.equal(desc.kind, kind);

    const widget = desc.fixture;
    assert.equal(widget.kind, kind, `${kind}: fixture kind mismatch`);

    const dataResult = desc.dataSchema.safeParse(widget.data);
    assert.equal(dataResult.success, true, `${kind} data: ${dataResult.success ? "" : JSON.stringify(dataResult.error.format())}`);

    const widgetResult = CanvasWidget.safeParse(widget);
    assert.equal(widgetResult.success, true, `${kind} widget: ${widgetResult.success ? "" : JSON.stringify(widgetResult.error.format())}`);
  }
});

test("registry coverage: every kind has Tile, Detail, fixture, schema, allowed actions", () => {
  for (const kind of ALL_WIDGET_KINDS) {
    const desc = WIDGET_REGISTRY[kind];
    assert.ok(desc.Tile, `${kind} missing Tile`);
    assert.ok(desc.Detail, `${kind} missing Detail`);
    assert.ok(desc.fixture, `${kind} missing fixture`);
    assert.ok(desc.dataSchema, `${kind} missing dataSchema`);
    assert.ok(Array.isArray(desc.allowedActions) && desc.allowedActions.length > 0, `${kind} has no allowedActions`);
    // autoApplyActions must be a subset of allowedActions
    for (const a of desc.autoApplyActions) {
      assert.ok(desc.allowedActions.includes(a), `${kind}: autoApply ${a} not in allowedActions`);
    }
  }
});

test("invalid widget data is rejected", () => {
  const bad = { ...demoCanvas().widgets[0], data: { label: "" } };
  const r = CanvasWidget.safeParse(bad);
  assert.equal(r.success, false);
});
