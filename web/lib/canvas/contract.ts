// Promotion boundary for the Hermes-native dynamic canvas lab.
//
// Anything re-exported from this module is intended to be safe to copy into
// production *as a type/shape*, with the lab's mutation/runtime pieces
// (store, reducer, fakeHermes, ActionQueue, HermesComposer) explicitly EXCLUDED.
//
// Production code that wants to "speak the lab schema" should import from
// `@/lib/canvas/contract` only. If a symbol is not re-exported here, treat it
// as lab-internal and assume it WILL change without notice.
//
// The corresponding human-readable note lives at:
//   docs/contract/lab-canvas-contract.md

// --- Schema (descriptive types — always safe to read) -----------------------
export {
  Confidence,
  Source,
  WidgetKind,
  WidgetSource,
  WidgetStatus,
  WidgetLayout,
  WidgetControls,
  Evidence,
  MetricData,
  OpenQuestionsData,
  ActionPanelData,
  EvidenceBoardData,
  SectionRefData,
  CanvasWidget,
  Canvas,
} from "./schema";

export type {
  Confidence as ConfidenceT,
  Source as SourceT,
  WidgetKind as WidgetKindT,
  WidgetSource as WidgetSourceT,
  WidgetStatus as WidgetStatusT,
  WidgetLayout as WidgetLayoutT,
  WidgetControls as WidgetControlsT,
  Evidence as EvidenceT,
  CanvasWidget as CanvasWidgetT,
  Canvas as CanvasT,
} from "./schema";

// --- Action protocol (typed contract for proposals) -------------------------
// Production may consume the kind enum + the validation helpers. It must NOT
// import the policy (`isAutoApply`) or any store/reducer; those decisions are
// production's to make under its own safety regime.
export {
  HermesActionKind,
  HermesAction,
  AppendWidgetPayload,
  UpdateWidgetPayload,
  RemoveWidgetPayload,
  MarkStatusPayload,
  AddEvidencePayload,
  ProposeRefreshPayload,
  validateActionPayload,
} from "./actions";

export type {
  HermesActionKind as HermesActionKindT,
  HermesAction as HermesActionT,
} from "./actions";

// --- Lifecycle FSM (pure, side-effect free) ---------------------------------
export {
  ACTION_STATES,
  TERMINAL_STATES,
  STATE_HINTS,
  canTransition,
  transition,
  isDestructive,
  isCostly,
} from "./lifecycle";

export type {
  ActionState,
  ActionEvent,
  StateHint,
} from "./lifecycle";

// --- Promotion guarantee ---------------------------------------------------
//
// PROMOTABLE today (read-side):
//   - All schema types and Zod validators above
//   - WidgetKind enum (production may render any subset)
//   - Confidence + WidgetSource + WidgetStatus enums
//   - Source / Evidence / per-kind data shapes
//   - HermesActionKind enum (for typed proposals coming from a real model)
//   - Lifecycle FSM (`canTransition`, `transition`, `STATE_HINTS`) for shared
//     audit-event semantics with Track 1
//
// LAB-ONLY (do NOT import in production):
//   - lib/canvas/store.ts
//   - lib/canvas/reducer.ts
//   - lib/canvas/fakeHermes.ts
//   - lib/canvas/fixtures.ts
//   - lib/canvas/registry.tsx (couples to React components)
//   - components/canvas/ActionQueue.tsx
//   - components/canvas/HermesComposer.tsx
//   - components/canvas/CanvasView.tsx (drives the lab demo)
//
// FIELDS THAT IMPLY FUTURE BEHAVIOR:
//   See docs/contract/lab-canvas-contract.md. Production read-only renderers
//   should treat `controls.*`, `layout.pinned`, `layout.collapsed`,
//   `status === "archived"`, and `Canvas.version` as descriptive only — do not
//   surface them as user-facing affordances yet.
