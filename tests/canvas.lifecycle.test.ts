import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_STATES,
  TERMINAL_STATES,
  STATE_HINTS,
  canTransition,
  transition,
  isCostly,
  isDestructive,
} from "../web/lib/canvas/lifecycle";

test("STATE_HINTS covers every action state", () => {
  for (const s of ACTION_STATES) {
    assert.ok(STATE_HINTS[s], `missing hint for ${s}`);
  }
});

test("transition matches happy paths", () => {
  assert.equal(transition("proposed", "auto_apply_ok"), "auto_applied");
  assert.equal(transition("proposed", "approve_start"), "applying");
  assert.equal(transition("applying", "approve_ok"), "applied");
  assert.equal(transition("applying", "approve_fail"), "failed");
  assert.equal(transition("failed", "retry"), "proposed");
  assert.equal(transition("auto_applied", "undo"), "undone");
  assert.equal(transition("applied", "undo"), "undone");
  assert.equal(transition("proposed", "reject"), "rejected");
});

test("invalid transitions throw", () => {
  assert.throws(() => transition("rejected", "approve_ok"));
  assert.throws(() => transition("undone", "undo"));
  assert.throws(() => transition("applied", "approve_ok"));
  assert.throws(() => transition("proposed", "approve_ok"));
});

test("canTransition mirrors transition without throwing", () => {
  assert.equal(canTransition("proposed", "auto_apply_ok"), true);
  assert.equal(canTransition("rejected", "approve_ok"), false);
  assert.equal(canTransition("applied", "undo"), true);
  assert.equal(canTransition("undone", "undo"), false);
});

test("terminal states have no outgoing transitions except identity", () => {
  for (const s of TERMINAL_STATES) {
    // A terminal state should never advance via any of the standard events.
    for (const ev of ["auto_apply_ok", "approve_ok", "undo", "retry"] as const) {
      assert.equal(canTransition(s, ev), false, `terminal ${s} should not accept ${ev}`);
    }
  }
});

test("destructive/costly classifiers mark the right kinds", () => {
  assert.equal(isDestructive("remove_widget"), true);
  assert.equal(isDestructive("append_widget"), false);
  assert.equal(isCostly("propose_refresh"), true);
  assert.equal(isCostly("append_widget"), false);
});
