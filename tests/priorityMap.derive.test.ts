import assert from "node:assert/strict";
import test from "node:test";
import { derivePriorityMap } from "../web/lib/canvas/priorityMap/derive";
import { acmeHealthBrief } from "../web/lib/canvas/priorityMap/fixtures";
import { PriorityMap } from "../web/lib/canvas/priorityMap/schema";

test("derivePriorityMap returns shape that validates against PriorityMap schema", () => {
  const map = derivePriorityMap(acmeHealthBrief);
  const result = PriorityMap.safeParse(map);
  assert.equal(
    result.success,
    true,
    result.success ? "" : JSON.stringify(result.error.format()),
  );
});

test("derivation is deterministic for a fixed Brief", () => {
  const a = derivePriorityMap(acmeHealthBrief);
  const b = derivePriorityMap(acmeHealthBrief);
  assert.deepEqual(a, b);
});

test("derives one entry per top_initiative, preserving order", () => {
  const map = derivePriorityMap(acmeHealthBrief);
  assert.equal(map.initiatives.length, acmeHealthBrief.top_initiatives.length);
  acmeHealthBrief.top_initiatives.forEach((init, i) => {
    assert.equal(map.initiatives[i].title, init.title);
    assert.equal(map.initiatives[i].confidence, init.confidence);
  });
});

test("impact and urgency stay clamped to 0..5", () => {
  const map = derivePriorityMap(acmeHealthBrief);
  for (const i of map.initiatives) {
    assert.ok(i.impact >= 0 && i.impact <= 5, `impact out of range: ${i.impact}`);
    assert.ok(i.urgency >= 0 && i.urgency <= 5, `urgency out of range: ${i.urgency}`);
  }
});

test("Janice Park persona is linked to the governance committee initiative", () => {
  const map = derivePriorityMap(acmeHealthBrief);
  const governance = map.initiatives.find((i) =>
    i.title.toLowerCase().includes("governance"),
  );
  assert.ok(governance);
  const personaEdges = governance!.edges.filter((e) => e.kind === "persona");
  assert.ok(
    personaEdges.some((e) => e.label.toLowerCase().includes("janice")),
    `expected Janice Park edge, got: ${JSON.stringify(personaEdges.map((e) => e.label))}`,
  );
});

test("Maria Chen is linked to the ambient documentation initiative", () => {
  const map = derivePriorityMap(acmeHealthBrief);
  const ambient = map.initiatives.find((i) =>
    i.title.toLowerCase().includes("ambient"),
  );
  assert.ok(ambient);
  const personaEdges = ambient!.edges.filter((e) => e.kind === "persona");
  assert.ok(personaEdges.some((e) => e.label.toLowerCase().includes("maria")));
});

test("Snowflake initiative picks up the procurement signal", () => {
  const map = derivePriorityMap(acmeHealthBrief);
  const snowflake = map.initiatives.find((i) =>
    i.title.toLowerCase().includes("snowflake"),
  );
  assert.ok(snowflake);
  const signalEdges = snowflake!.edges.filter((e) => e.kind === "signal");
  assert.ok(
    signalEdges.length > 0,
    `expected at least one signal edge, got 0`,
  );
});

test("at least one risk edge is derived for the program", () => {
  const map = derivePriorityMap(acmeHealthBrief);
  const totalRisks = map.initiatives.reduce(
    (n, i) => n + i.edges.filter((e) => e.kind === "risk").length,
    0,
  );
  assert.ok(totalRisks > 0, "expected at least one initiative→risk edge");
});

test("next_action edges reference the brief's next_action text", () => {
  const map = derivePriorityMap(acmeHealthBrief);
  const totalNextAction = map.initiatives.reduce(
    (n, i) => n + i.edges.filter((e) => e.kind === "next_action").length,
    0,
  );
  assert.ok(
    totalNextAction > 0,
    "expected next_action to link to at least one initiative",
  );
});

test("nodes are deduped by id", () => {
  const map = derivePriorityMap(acmeHealthBrief);
  const ids = map.nodes.map((n) => n.id);
  const uniq = new Set(ids);
  assert.equal(ids.length, uniq.size);
});

test("every edge target_id is present in nodes index", () => {
  const map = derivePriorityMap(acmeHealthBrief);
  const nodeIds = new Set(map.nodes.map((n) => n.id));
  for (const init of map.initiatives) {
    for (const e of init.edges) {
      assert.ok(
        nodeIds.has(e.target_id),
        `edge ${e.kind} target ${e.target_id} missing from nodes index`,
      );
    }
  }
});

test("empty brief produces an empty map without crashing", () => {
  const empty = {
    ...acmeHealthBrief,
    top_initiatives: [],
    personas: [],
    risks: [],
    recent_signals: [],
    next_action: "",
  };
  const map = derivePriorityMap(empty);
  assert.equal(map.initiatives.length, 0);
  assert.equal(map.nodes.length, 0);
  assert.equal(map.diagnostics.edge_count, 0);
});

test("low-confidence orphan initiative still appears, low on both axes", () => {
  const map = derivePriorityMap(acmeHealthBrief);
  const portal = map.initiatives.find((i) =>
    i.title.toLowerCase().includes("portal"),
  );
  assert.ok(portal);
  assert.ok(portal!.impact <= 2, `portal impact too high: ${portal!.impact}`);
});
