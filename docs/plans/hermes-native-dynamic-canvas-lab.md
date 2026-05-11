# Hermes-Native Dynamic Canvas — Lab Plan

Status: Draft, lab-only (Track 2). Not for production.
Owner: Track 2 / hermes-lab
Target branch in lab repo: `claude/account-research-track-2-eGP2f` (working branch in this sandbox; task originally referenced `hermes-lab/dynamic-canvas`, which does not exist locally — see "Branch note" at the end).
Companion track: Track 1 (production) — audit/event trail, job visibility, health checks, refresh/version UX, safety rails.

---

## 0. Context and goals

Today, `web/components/BriefCanvas.tsx` (~1,660 LOC) renders a mostly static account brief: a fixed sequence of typed sections (summary, signals, initiatives, personas, technical footprint, programs & procurement, etc.) plus a flat list of model/chat "extensions" appended at the bottom. `BriefChat` lets Hermes append extensions through a constrained patch model (`lib/briefPatches.ts`, `lib/briefMerge.ts`), and `DrillModal` shows source-level evidence.

The lab goal is to prototype a **canvas of widgets** instead of a document of sections. Hermes should be able to compose, rearrange, refresh, and annotate widgets — with the human in the loop for anything that mutates shared state or spends money.

Non-goals for the lab:
- Replacing the production brief schema.
- Multi-tenant auth changes.
- Email, public shares, exports beyond a placeholder hook.
- Touching production data, secrets, or jobs.

---

## 1. Product concept

**Hermes-native canvas** = a per-account workspace where:

- The unit of UI is a **widget** (a typed tile), not a section.
- Widgets are first-class data: created, updated, moved, dismissed, refreshed.
- Hermes is an operator with a constrained action vocabulary. It proposes changes; the human approves the risky ones; safe ones auto-apply.
- Every widget carries provenance (`source`, `why_included`, `sources`, `confidence`) so the canvas always answers "why is this here?".

**Feel:** closer to a Notion/Linear board than a Word doc. Cards are scannable, drill-throughs show evidence, and there is a persistent **Action Queue** (proposals from Hermes) the user can accept/reject.

**How it differs from current BriefCanvas:**

| Today | Hermes-native canvas |
|---|---|
| Fixed section order | Free layout (grid + manual ordering) |
| Extensions are leaf-only, append-only | Widgets are typed, updatable, removable |
| Hermes writes via `briefPatches` (append-only) | Hermes proposes typed actions; some auto-apply, some require approval |
| Single confidence per section | Per-widget confidence + per-claim evidence |
| Drill modal shows fixed evidence shapes | Drill renderer is per-widget-kind |
| Provenance lives on a section | Provenance lives on the widget and is visible on the tile |

**Hermes controls (auto-applied if safe):**
- Add a low-risk widget (e.g., `metric`, `open_questions`).
- Update widget body/data when refresh returns new evidence.
- Reorder/group widgets within current layout.
- Add evidence to an existing widget.
- Mark statuses (e.g., "watching", "stale").

**Human controls (always, or required approval):**
- Remove a widget.
- Apply a refresh that costs money or hits external sources.
- Change account-level metadata.
- Promote a lab widget to a "pinned" view.
- Anything that touches share/export.

---

## 2. Canvas model

### CanvasWidget (TypeScript / Zod sketch)

```ts
const Confidence = z.enum(["High", "Medium", "Low", "Not found"]);
const WidgetSource = z.enum(["model", "chat", "user", "system", "refresh"]);

const WidgetLayout = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12), // 12-col grid
  h: z.number().int().min(1).max(24),
  pinned: z.boolean().default(false),
  collapsed: z.boolean().default(false),
});

const WidgetControls = z.object({
  // Capabilities exposed in tile header. Drives both UI and Hermes action gating.
  can_refresh: z.boolean().default(false),
  can_remove: z.boolean().default(true),
  can_edit: z.boolean().default(true),
  can_export: z.boolean().default(false),
  requires_approval: z.array(z.enum([
    "remove", "refresh", "update", "evidence", "status"
  ])).default(["remove", "refresh"]),
});

const CanvasWidget = z.object({
  id: z.string().min(1),                   // ulid
  kind: WidgetKind,                        // see registry below
  title: z.string().min(1),
  description: z.string().default(""),
  source: WidgetSource,                    // who created it
  created_at: z.string(),                  // ISO
  updated_at: z.string(),                  // ISO
  confidence: Confidence,
  why_included: z.string(),                // 1–2 sentences
  sources: z.array(Source),                // reuse existing Source schema
  layout: WidgetLayout,
  controls: WidgetControls,
  data: z.unknown(),                       // narrowed per-kind by registry
  status: z.enum(["fresh", "stale", "watching", "archived"]).default("fresh"),
  evidence: z.array(z.object({
    text: z.string(),
    source: Source,
    added_at: z.string(),
    confidence: Confidence,
  })).default([]),
});

const Canvas = z.object({
  account_id: z.string(),
  version: z.number().int(),
  generated_at: z.string(),
  widgets: z.array(CanvasWidget),
  meta: z.object({
    layout_mode: z.enum(["grid", "freeform"]).default("grid"),
    pinned_order: z.array(z.string()).default([]), // widget ids
  }),
});
```

### Proposed widget kinds

| Kind | Purpose | Data sketch |
|---|---|---|
| `metric` | One KPI / fact (e.g., "ARR ~$1.2B", "Headcount 4,300") | `{ label, value, unit?, as_of, delta? }` |
| `checklist` | Discovery / qualification checklist | `{ items: [{ text, status, owner?, due? }] }` |
| `timeline` | Dated events (news, exec moves, funding) | `{ events: [{ date, title, body, kind }] }` |
| `action_panel` | Recommended next actions for the human | `{ actions: [{ text, why, owner?, severity }] }` |
| `open_questions` | Unresolved questions Hermes still needs answered | `{ questions: [{ text, blocking?, hypothesis? }] }` |
| `account_watchlist` | Triggers/signals to watch + thresholds | `{ items: [{ signal, threshold, last_seen? }] }` |
| `opportunity_board` | Identified opportunities w/ stage | `{ opps: [{ name, stage, value?, why }] }` |
| `stakeholder_map` | Personas as a graph/grid (influence × support) | `{ people: [{ name, title, influence, support, opener? }] }` |
| `evidence_board` | Raw quotes/snippets with citations | `{ snippets: [{ text, source, tag? }] }` |
| `extension_ref` | Backwards-compatible pointer to a `BriefExtension` | `{ extension_id }` |
| `section_ref` | Backwards-compatible pointer to a legacy brief section | `{ section_key }` |

The last two are the bridge to the existing brief: a Hermes-native canvas can be hydrated for an existing account by emitting `section_ref` widgets for the legacy sections, plus `extension_ref` widgets for current extensions. That keeps the demo seeded with real shape without a migration.

---

## 3. Widget registry

A central registry, e.g. `web/lib/canvas/widgetRegistry.ts`, maps each `kind` to a descriptor:

```ts
interface WidgetDescriptor<TData> {
  kind: WidgetKind;
  label: string;                          // human-readable
  schema: ZodSchema<TData>;               // validates `data`
  defaultLayout: Partial<WidgetLayout>;   // default tile size
  Tile: React.FC<{ widget: CanvasWidget<TData> }>;            // compact view
  Detail: React.FC<{ widget: CanvasWidget<TData>; ... }>;     // drill modal body
  Export?: (w: CanvasWidget<TData>) => ExportNode;            // optional
  fixture: CanvasWidget<TData>;                                // demo fixture
  allowedActions: WidgetActionKind[];     // what Hermes can do here
  autoApplyActions: WidgetActionKind[];   // subset that doesn't need approval
}
```

Each widget kind ships:
- a Zod validator for `data`,
- a `Tile` (compact, fits in a grid cell),
- a `Detail` (drill modal),
- an optional `Export` (Markdown/HTML node for the existing exporter — placeholder in lab),
- a fixture for the demo and tests,
- the set of `WidgetActionKind`s it accepts and which auto-apply.

The registry is the single source of truth used by:
- the canvas renderer,
- Hermes action validation,
- the schema doc emitted into the prompt,
- the test fixtures.

---

## 4. Hermes action model

All Hermes-originated changes pass through a typed action protocol, modeled on the existing `briefPatches`. One action = one mutation. Actions are validated against the registry before being applied.

```ts
type WidgetActionKind =
  | "append_widget"
  | "update_widget"
  | "remove_widget"
  | "append_extension"
  | "mark_status"
  | "add_evidence"
  | "propose_refresh"
  | "create_observation"
  | "summarize_delta";

type HermesAction = {
  id: string;                              // ulid
  kind: WidgetActionKind;
  target_widget_id?: string;
  payload: unknown;                        // narrowed per kind
  rationale: string;                       // why Hermes proposes this
  evidence: Source[];                      // citations
  proposed_at: string;
  proposed_by: "hermes" | "user" | "system";
  state: "proposed" | "auto_applied" | "applied" | "rejected" | "expired";
  confidence: Confidence;
};
```

### Auto-apply vs. require confirmation

| Action | Default | Why |
|---|---|---|
| `append_widget` (kinds: `metric`, `open_questions`, `evidence_board`, `extension_ref`, `section_ref`) | auto | Additive, low risk, easy to undo |
| `append_widget` (kinds: `action_panel`, `opportunity_board`, `account_watchlist`, `stakeholder_map`) | confirm | These influence sales motion |
| `update_widget` (non-structural fields: `description`, `data`) | auto if confidence ≥ Medium and evidence present | Cheap to revert |
| `update_widget` (layout, controls) | auto | UI only |
| `remove_widget` | confirm | Destructive |
| `append_extension` | auto | Matches today's `append_extension` patch path |
| `mark_status` (`fresh`/`watching`) | auto | Annotation |
| `mark_status` (`stale`/`archived`) | confirm | Hides info |
| `add_evidence` | auto | Additive |
| `propose_refresh` | confirm always | Costs money, hits external sources |
| `create_observation` | auto | Hermes-side note, no shared mutation |
| `summarize_delta` | auto | Read-only delta over canvas history |

Confidence floor: any auto-applied action requires `confidence ≥ Medium` AND at least one source. Anything below that goes to the Action Queue.

### Audit events

Every action — including auto-applied ones — emits an audit record. Lab spec:

```
{
  action_id, account_id, canvas_version, kind, target_widget_id,
  proposed_at, applied_at?, decided_by, decision: "auto"|"approve"|"reject",
  before_hash, after_hash,             // canvas content hash
  rationale, evidence, cost_estimate?  // hooked for Track 1
}
```

### Integration with Track 1

This action model is designed to be the **producer** for Track 1's audit/event trail:
- Same shape as Track 1's expected audit events (action kind + rationale + evidence + decided_by).
- `propose_refresh` is the natural seam for Track 1's job visibility (it spawns a research job — Track 1 surfaces it).
- Auto-apply policy is data, not code — so Track 1's safety rails can flip thresholds without a redeploy.
- Health checks: canvas exposes `last_action_at`, `proposed_count`, `auto_apply_rate` for Track 1's dashboards.

---

## 5. Initial prototype scope (smallest useful lab)

**Goal:** a single account, single canvas, all client-side persistence, no production data.

**Widgets to build first (5):**
1. `metric` — easiest, validates the registry.
2. `open_questions` — natural fit for Hermes proposals.
3. `action_panel` — exercises the approval flow.
4. `evidence_board` — exercises source/evidence rendering.
5. `section_ref` — lets us seed the canvas from an existing demo brief.

**Interactions to mock:**
- Drag to reorder (grid snap; no freeform yet).
- Tile collapse/expand.
- Drill modal per widget kind.
- Action Queue with accept/reject and "why".
- "Hermes" composer: a textarea + canned prompts that emit fake `HermesAction`s deterministically (no API calls).

**Local-only actions (lab):**
- All actions. The lab does NOT call the real research pipeline, does NOT call Anthropic, does NOT mutate any DB.
- "Propose refresh" produces a fake job record stored in `localStorage` so we can demo the approval UX.

**Demo data loader:**
- A `web/lib/canvas/fixtures/` folder with 2–3 demo canvases (e.g., "Acme Health", "Globex State").
- A `/lab/canvas` route mounts the lab UI and loads from fixtures + `localStorage` overlay.
- A "Reset demo" button.

**Showing Hermes proposals:**
- Right-side **Action Queue** panel, always visible.
- Each proposal shows: kind, target widget (linkified), rationale, evidence chips, confidence pill, [Accept] [Reject] [Why?].
- Auto-applied actions appear in the queue as already-accepted, with an "Undo" affordance for ~30s (client-side only).

---

## 6. UI/UX

**Canvas layout**
- 12-column responsive grid; widgets declare `w/h`.
- Sticky header: account name, version, last updated, pinned-view selector, "Hermes" toggle.
- Right rail (collapsible): Action Queue + History.
- Bottom: a thin "Hermes status bar" showing current proposal count and last action.

**Widget tile behavior**
- Header: kind icon, title, confidence pill, source chip (model/chat/user/refresh), overflow menu (Pin, Collapse, Drill, Remove*).
- Body: kind-specific compact rendering (registry `Tile`).
- Footer: "Updated 2h ago · 3 sources" linkified to drill.
- States: `stale` gets a muted border + "Refresh?" CTA; `watching` gets an eye icon; `archived` is hidden unless toggle is on.

**Drill modal**
- Reuses `DrillModal` shape: title, why_included, full evidence list, per-widget Detail renderer in the body.
- Tabs: Detail · Evidence · History (audit trail) · Hermes activity (proposals targeting this widget).

**Action queue**
- Grouped by widget; collapsible.
- Filters: All · Needs approval · Auto-applied · Rejected.
- Bulk approve/reject within a single widget.
- Keyboard: `j/k` to move, `y/n` to approve/reject.

**Human approval flow**
- Proposal lands in queue → user sees a toast for `requires_approval` actions.
- One-click Accept applies and emits audit event.
- Reject requires a reason (free text, optional preset chips: "wrong account", "low quality", "duplicate").
- Auto-applied actions emit a passive toast with Undo.

**Empty states**
- New canvas: shows a "Seed from brief" CTA (loads `section_ref` widgets) + "Ask Hermes" composer.
- Empty Action Queue: "Hermes is quiet. Try asking it to scan for recent signals."

**Source/evidence display**
- Every widget has a visible source chip (e.g., "model · 3 sources").
- Hover reveals top source titles; click opens drill on Evidence tab.
- Evidence items always show title + URL + accessed date (matches existing `Source` schema).

---

## 7. Production port-back plan

| Concept | Worth porting? | Prod files likely touched | Migration? | Auth/safety | Tests | Risks |
|---|---|---|---|---|---|---|
| `CanvasWidget` schema | Yes | `web/lib/schema.ts`, new `web/lib/canvas/schema.ts` | Yes — additive: `briefs` row gets nullable `canvas_json` | Reuse existing brief auth scoping | Zod round-trip + fixture tests | Schema bloat in prompt; mitigate via per-widget schemas |
| Widget registry | Yes | new `web/lib/canvas/registry.ts`, `web/components/canvas/*` | None | None | Per-widget Tile/Detail snapshot tests | Coupling registry to prompt — keep a thin schema-emitter |
| Hermes action protocol | Yes | new `web/lib/canvas/actions.ts`, extend `lib/briefPatches.ts` | Add `canvas_actions` table | Same auth as `briefs`; CSRF on apply route | Action validator unit tests + integration | Drift between prompt-described actions and applied actions |
| Action Queue + approval UI | Yes | `web/components/canvas/ActionQueue.tsx` | None | Approval routes need auth + per-account scope | Component + e2e tests | Approval fatigue — tune defaults carefully |
| Audit events | Yes (and it's Track 1's territory) | shared audit module | Add `audit_events` table (Track 1 owns) | Append-only; signed-in user only | Unit + DB constraint tests | Coordination cost with Track 1 |
| `propose_refresh` → real job | Yes | `lib/researchWorker.ts`, `app/api/research-jobs/*` | None beyond Track 1's job table | Per-account rate limit; cost cap | Integration tests with mocked Anthropic | Cost runaway — gate behind Track 1 safety rails |
| Drag/reorder + layout persistence | Yes, but later | `web/components/canvas/Grid.tsx` | Layout stored in `canvas_json.meta` | None | Snapshot test for layout JSON | Mobile UX |
| `section_ref` / `extension_ref` bridge | Yes — this is the migration path | `BriefCanvas.tsx` reads either shape | Read-time bridge, no data migration | None | Backcompat tests against current fixtures | Long-lived dual-shape code |
| Local-only fake-Hermes composer | No | — | — | — | — | Lab only |
| `localStorage` overlay | No | — | — | — | — | Lab only |

---

## 8. PR sequence back to production

1. **PR 1 — Canvas widget foundation.**
   - Add `CanvasWidget`/`Canvas` Zod schemas.
   - Add `canvas_json` (nullable) column on briefs; read-time bridge that synthesizes a canvas from existing brief sections + extensions via `section_ref` / `extension_ref`.
   - No new UI yet; just the data model + tests.

2. **PR 2 — Widget pack.**
   - Registry + 5 widget kinds (`metric`, `open_questions`, `action_panel`, `evidence_board`, plus the two `*_ref` bridges).
   - New `CanvasView` component, mounted behind a feature flag (`?canvas=1` or env flag).
   - No mutations yet — read-only canvas over the existing brief.

3. **PR 3 — Action API.**
   - `HermesAction` schema; `POST /api/canvas/actions/propose` and `POST /api/canvas/actions/apply`.
   - Apply path enforces auto-apply policy + auth.
   - Audit event emitter (consumes Track 1's table if landed; otherwise writes shadow events).

4. **PR 4 — Hermes operator panel.**
   - Action Queue UI, approval flow, undo, history tab in drill.
   - Wire `BriefChat` to emit `HermesAction`s (in addition to / instead of `briefPatches`) behind a flag.
   - Migration of the existing `append_extension` flow onto the action protocol.

5. **PR 5 — Automation / monitoring.**
   - `propose_refresh` → real research job with cost cap + per-account rate limit.
   - Dashboards: proposed/auto/approved/rejected per account, cost per canvas.
   - Rollback switch: disable auto-apply globally, force-confirm everything.

Each PR is independently revertible. PRs 1–2 are dark; PR 3 is gated by flag; PR 4 lights up Hermes; PR 5 turns on the expensive paths.

---

## 9. Risks and open questions

- **Schema drift.** The prompt-emitted schema must match the applied-action validator. Mitigation: a single source of truth (the registry) emits both the prompt doc and the validator; CI test asserts round-trip.
- **Prompt/schema size.** Eleven widget kinds × per-kind data schemas could bloat the system prompt. Mitigation: emit only kinds relevant to the current account, or emit a compact summary + on-demand schema lookup tool.
- **Export compatibility.** The existing exporter assumes section-shaped brief. Mitigation: every widget has an optional `Export` node; the exporter walks the canvas and falls back to `section_ref`/`extension_ref` for legacy shapes. Lab leaves this as a placeholder.
- **Public-share compatibility.** Shareable audience cannot include widgets that contain internal-only evidence. Mitigation: a `share_visibility: "internal" | "shareable"` field on each widget, gated at render time; default to `internal` for any Hermes-created widget until approved. Lab does not implement public share.
- **Auditability.** Auto-applied actions must still be auditable and undoable. Mitigation: audit-event-on-auto, client-side undo for 30s, server-side undo for the proposing user within the version.
- **User trust.** If Hermes auto-applies the wrong thing, trust collapses fast. Mitigation: tight allow-list of auto-apply kinds; visible "Hermes did this" tags; one-click revert.
- **Cost controls.** `propose_refresh` is the dangerous one. Mitigation: per-account daily/$ cap; only the human can approve; estimate shown in the queue. Defer to Track 1's safety rails.
- **Rollback / revert.** Per-version snapshots of `canvas_json` (Track 1 versioning already does this for briefs). "Revert to version N" must restore both widgets and pending proposals.
- **Avoiding a permanent fork.** Risk that the lab diverges and never lands. Mitigation: PR 1 ships within ~2 weeks of lab completion; lab keeps the production schema as a real backend via `section_ref`/`extension_ref` so the model and UI are exercised against real shapes from day one. Lab code lives under `web/components/canvas/` and `web/lib/canvas/` — namespaces that match the eventual production locations.

### Open questions

- Should layout be 12-col grid only, or freeform (drag XY)? Lab starts with grid; freeform is a follow-up.
- Where does the audit table live — Track 1's module or a canvas-owned module that Track 1 ingests? Recommend: Track 1 owns, canvas emits.
- Do `action_panel` items become tasks (with owners/due dates)? Out of scope for lab; revisit after PR 4.
- Should `BriefChat` be replaced or wrapped by the operator panel? Recommend wrap initially (Action Queue is a superset of chat), replace later.

---

## Branch note

The task brief asked for branch `hermes-lab/dynamic-canvas`. That branch does not exist locally or on `origin`. The active sandbox branch is `claude/account-research-track-2-eGP2f`, which the harness instructs me to develop on and push to. This plan was written on that branch. If you want me to (a) create `hermes-lab/dynamic-canvas` from here, or (b) keep working on the current branch, say so before the prototype step.
