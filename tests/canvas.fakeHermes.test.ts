import assert from "node:assert/strict";
import test from "node:test";
import { demoCanvas } from "../web/lib/canvas/fixtures";
import {
  FAKE_HERMES_PROMPTS,
  buildProposal,
  isBuildProposalError,
  HERMES_LAB_FIXTURE_ONLY,
} from "../web/lib/canvas/fakeHermes";

test("HERMES_LAB_FIXTURE_ONLY is the literal true marker", () => {
  assert.equal(HERMES_LAB_FIXTURE_ONLY, true);
});

test("every prompt produces a draft (or a typed error) for the demo canvas", () => {
  const canvas = demoCanvas();
  for (const p of FAKE_HERMES_PROMPTS) {
    const d = buildProposal(p.id, canvas);
    if (isBuildProposalError(d)) {
      assert.fail(`prompt ${p.id} errored against demo canvas: ${d.__error}`);
    }
    assert.equal(d.fixture_only, true, `prompt ${p.id} not stamped fixture_only`);
    assert.ok(d.kind && d.rationale, `prompt ${p.id} missing core fields`);
    assert.equal(d.proposed_by, "hermes");
  }
});

test("fakeHermes is deterministic per (promptId, canvas.version) modulo timestamps", () => {
  const canvas = demoCanvas();
  function strip(d: unknown): unknown {
    return JSON.parse(
      JSON.stringify(d, (k, v) => {
        if (k === "created_at" || k === "updated_at" || k === "added_at") return "<ts>";
        return v;
      }),
    );
  }
  for (const p of FAKE_HERMES_PROMPTS) {
    const a = buildProposal(p.id, canvas);
    const b = buildProposal(p.id, canvas);
    if (isBuildProposalError(a) || isBuildProposalError(b)) continue;
    assert.deepEqual(strip(a), strip(b), `prompt ${p.id} not deterministic`);
  }
});

test("append_widget proposals carry idem_key and stable widget id per canvas version", () => {
  const canvas = demoCanvas();
  for (const p of FAKE_HERMES_PROMPTS) {
    const d = buildProposal(p.id, canvas);
    if (isBuildProposalError(d)) continue;
    if (d.kind !== "append_widget") continue;
    const widget = (d.payload as { widget: { id: string; idem_key?: string } }).widget;
    assert.ok(widget.idem_key, `prompt ${p.id} append_widget missing idem_key`);
    assert.match(widget.id, /_v\d+$/, `prompt ${p.id} widget id missing version suffix`);
  }
});

test("evidence sources point at example.com (no live URLs leak through fixtures)", () => {
  const canvas = demoCanvas();
  for (const p of FAKE_HERMES_PROMPTS) {
    const d = buildProposal(p.id, canvas);
    if (isBuildProposalError(d)) continue;
    for (const ev of d.evidence) {
      assert.match(ev.url, /^https:\/\/example\.com\//, `prompt ${p.id} leaked non-fixture URL: ${ev.url}`);
    }
  }
});
