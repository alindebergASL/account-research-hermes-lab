# Lab Canvas → Production Promotion Contract

Status: lab-only. Track 2 R&D. **Not** a production deploy plan.
Companion: `docs/plans/hermes-native-dynamic-canvas-lab.md`.

This document defines the **promotion boundary** between the Hermes-native
dynamic canvas lab (this repo) and the production read-only canvas bridge in
`alindebergASL/account-research`.

The single import-line rule for production:

```ts
// Production code SHOULD import schema/types/lifecycle from:
import { ... } from "@/lib/canvas/contract";

// Production code MUST NOT import:
//   @/lib/canvas/store
//   @/lib/canvas/reducer
//   @/lib/canvas/fakeHermes
//   @/lib/canvas/fixtures
//   @/lib/canvas/registry
//   @/components/canvas/ActionQueue
//   @/components/canvas/HermesComposer
//   @/components/canvas/CanvasView
```

The lab-side `web/lib/canvas/contract.ts` enumerates exactly what is in the
promotion surface. If you need a symbol that isn't re-exported there, treat it
as lab-internal and assume it will change without notice.

---

## 1. Promotable today (read-only)

These are pure data shapes with no behavioral assumptions.

| Symbol | Where | Notes |
|---|---|---|
| `Canvas` | `lib/canvas/schema.ts` | Top-level Zod schema, `safeParse` at the bridge edge. |
| `CanvasWidget` (discriminated union) | `lib/canvas/schema.ts` | One arm per widget kind. |
| `WidgetKind` enum | `lib/canvas/schema.ts` | `metric`, `open_questions`, `action_panel`, `evidence_board`, `section_ref`. |
| Per-kind `*Data` schemas | `lib/canvas/schema.ts` | Pure content validators. |
| `WidgetSource`, `WidgetStatus`, `Confidence` enums | `lib/canvas/schema.ts` | Render as chips/badges. |
| `Source`, `Evidence` | `lib/canvas/schema.ts` | Identical to existing brief Source shape; safe to render. |
| `WidgetLayout` (`x`, `y`, `w`, `h`) | `lib/canvas/schema.ts` | Read for grid placement only. See §3 for `pinned`/`collapsed`. |
| `HermesActionKind` enum | `lib/canvas/actions.ts` | If/when production accepts typed proposals from a real model. |
| `HermesAction` schema | `lib/canvas/actions.ts` | The wire shape for proposals. |
| `validateActionPayload` | `lib/canvas/actions.ts` | Per-kind payload validator. Pure. |
| `lifecycle.ts` (FSM) | `lib/canvas/lifecycle.ts` | `ACTION_STATES`, `STATE_HINTS`, `canTransition`, `transition`, `isDestructive`, `isCostly`. Production audit/event work (Track 1) can use the same FSM for shared semantics. |

---

## 2. Lab-only (do NOT promote)

These contain mutation, randomness, persistence, or runtime invariants the
production bridge does not need.

| File | Why lab-only |
|---|---|
| `lib/canvas/store.ts` | localStorage persistence + propose/approve/reject/retry/undo state machine over `PersistedState`. |
| `lib/canvas/reducer.ts` | Pure but tightly coupled to the lab store; production should write its own apply path under its own safety regime. |
| `lib/canvas/fakeHermes.ts` | Deterministic canned proposals for the demo. Production must never see this on a critical path. |
| `lib/canvas/fixtures.ts` | Demo data only. |
| `lib/canvas/registry.tsx` | Couples to React Tile/Detail components; if production wants the registry pattern, copy the *idea*, not the file. |
| `components/canvas/ActionQueue.tsx` | Approve/reject/undo/retry UI. Mutation surface. |
| `components/canvas/HermesComposer.tsx` | Emits proposals. |
| `components/canvas/CanvasView.tsx` | Drives the lab demo end-to-end (loadState → drill modal → toast → undo). |
| `app/lab/canvas/page.tsx` | Lab route. |
| `middleware.ts /lab` change | Lab-only public route. |
| `actions.ts: isAutoApply` | Lab's auto-apply *policy*. Production should write its own. |
| `actions.ts: HermesAction.fixture_only` | Defense-in-depth marker enforced by the lab store. Production should refuse actions missing its own analogous marker. |

---

## 3. Fields that imply future behavior

These are present on the schema (so a future Hermes-write doesn't fail
validation) but **must not** be surfaced as user-facing affordances in the
production read-only bridge.

| Field | Don't surface because… |
|---|---|
| `WidgetControls.can_refresh` | Implies a Refresh button → research job → cost. |
| `WidgetControls.can_remove` | Implies a Remove button → mutation. |
| `WidgetControls.can_edit` | Implies inline edit. |
| `WidgetControls.can_export` | Implies an export entry point. |
| `WidgetLayout.pinned` | Implies "pin/unpin" mutation. |
| `WidgetLayout.collapsed` | Implies state-mutating collapse toggle. |
| `WidgetStatus = "archived"` | Implies "Archive" mutation + "Show archived" toggle. |
| `Canvas.version` | Implies version history UX (Track 1's). |
| `Canvas.meta.pinned_order` | Implies reorder mutation. |
| `HermesAction.state = "applying"` | Implies an in-flight server call. Production reduces propose/approve to its own audit-event flow. |
| `HermesAction.fixture_only` | Lab marker — production should ignore or refuse. |
| `HermesAction.retry_of` | Lab retry chain — production handles retries via its own job system. |

For each: production should `safeParse` the field through (so future writes
work), but render nothing for it.

---

## 4. Mismatches to track against the production read-only bridge

(Production bridge inspected at the contract level only — exact field names
may differ.)

| Concern | Lab | Production read-only bridge |
|---|---|---|
| Confidence enum values | `High` / `Medium` / `Low` / `Not found` | Must match exactly. If production uses lower-case, normalize at the bridge. |
| Source URL | Required string | Production extension `Source` is identical. |
| `Evidence.added_at` | Required ISO string | Production may not have an analogue; consider making lab's `Evidence.added_at` optional before promotion. |
| Extension source enum | Lab: `model | chat | user | system | refresh | hermes` | Production `BriefExtension.source` (post PR #10): `model | chat | research`. **Lab `WidgetSource` should be a strict superset** so production can map directly. (Already true.) |
| Read path | `loadState()` from localStorage | Production reads from DB column on the brief. The lab loadState should not be reused. |
| Write path | `propose/approve/reject/retry/undo` | Production has no write path yet. Do not introduce one without Track 1's safety rails. |

---

## 5. Production-promotion recommendations

Order in which lab work could land in production, each as a small reversible PR.

1. **PR-A (in flight, prod):** read-only canvas bridge with `section_ref` /
   `extension_ref`-style backcompat. Lab provides only the schema shape and
   the lifecycle enum names.
2. **PR-B:** Promote `lib/canvas/contract.ts` re-exports verbatim (schema +
   lifecycle FSM). Production gains shared types + a shared audit-event
   vocabulary, with no new behavior.
3. **PR-C:** Production-side `HermesAction` validator at the request edge of a
   future `/api/canvas/actions/propose` route. Read-only response only, gated
   behind a per-account flag. No `apply` route yet.
4. **PR-D:** Production-side action apply path with its own auto-apply policy
   (do **not** import lab `isAutoApply`). Audit emission piggybacks on
   Track 1.
5. **PR-E:** Production operator panel (rough analogue of the lab's
   ActionQueue) with the human-approval flow.

Each step keeps the production read-only bridge unchanged behaviorally.

---

## 6. Things intentionally not touched in this lab iteration

- Production `web/lib/schema.ts`, `web/lib/briefMerge.ts`, `web/lib/briefPatches.ts`.
- Public share routes / `app/s/[token]/...`.
- Auth, sessions, password storage, change-password flow.
- Email / nodemailer.
- DB / SQLite migrations.
- Anthropic SDK / research worker / cost ledger.
- PM2 / deployment scripts / nginx.
- Production `.env` / secrets.
- Any production repo (`alindebergASL/account-research`) — including no PRs,
  no branch pushes, no MCP writes.

Lab artifacts only:
- `web/lib/canvas/*`
- `web/components/canvas/*`
- `web/app/lab/canvas/*`
- `web/middleware.ts` (single `/lab` public-path entry, lab-only)
- `tests/canvas.*.test.ts`
- `docs/plans/hermes-native-dynamic-canvas-lab.md`
- `docs/contract/lab-canvas-contract.md` (this file)
