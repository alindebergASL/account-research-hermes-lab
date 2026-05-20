# Generative Canvas Runtime + Audit Rails — Lab Implementation Plan (PR32-aligned)

Status: **PLAN ONLY**. Lab-only. Do not deploy. Do not modify production code as part of executing this plan.
Date: 2026-05-19
Author: Track 2 lab agent
Plan branch: `lab/canvas-runtime-contract-plan`
Supersedes:
- `docs/plans/2026-05-15-canvas-runtime-contract-audit-rails.md`
- `docs/plans/2026-05-19-canvas-runtime-contract-audit-rails-pr32-aligned.md`

Production target: `alindebergASL/account-research` `main` (head includes `2afadeb feat: add lab Hermes runtime service (#32)`)

---

## 0. Reframe (read first)

The two prior plans treated Canvas as a fixed report renderer with a small set of widget kinds and an even smaller set of mutation kinds (`append_widget`, `update_widget`, `remove_widget`, `mark_status`, `add_evidence`, `propose_refresh`). That framing is retired.

The target Canvas is a **generative workspace**:

- Hermes decides what belongs on the Canvas.
- Hermes arranges it — sections, groups, relationships, flows, focus paths, visual hierarchy, layouts.
- Hermes uses built-in widgets where they fit, composes new surfaces from safe primitives where they don't, and — at the far end — proposes genuinely new widget capabilities (with source code) that go through human review before they ever exist in production.
- **Production never executes Hermes-generated code.** The app remains the authority for auth, persistence, audit, approval, and rendering safety.

The PR32 substrate (`HERMES_RUNTIME_*` flags, sidecar transport, `hermes_jobs` / `hermes_job_events` / `brief_events` / `canvas_states` tables, sidecar↔app `HERMES_SERVICE_TOKEN`) is the *foundation* of this work and is not duplicated.

What changes from the prior plan:
- The data model widens from a flat widget list to a `CanvasDocument` (nodes + edges + sections + layout + view modes).
- The action set widens to action *families* across four layers (built-in, layout, primitive-composition, capability-proposal).
- A safety boundary is added between Hermes-generative content/layout (allowed at runtime) and Hermes-generative code (lab-sandboxed, never executed at runtime, promoted only by source-controlled code review).

Everything in this plan is still **plan only**. No code, no migrations, no schema changes.

---

## 0.1 Implementation prerequisites (must be satisfied before §6/§7 code lands)

This plan describes work that depends on the PR32 substrate landed on production main (`alindebergASL/account-research`). Codex CLI flagged that **the current lab repo `alindebergasl/account-research-hermes-lab` does not contain PR32 substrate** on any visible branch — there is no `web/lib/hermes/*`, no `web/scripts/hermes-runtime-service.ts`, no migration `012_brief_events` or `013_hermes_runtime_events_and_canvas_state`, and no `canvas_states` table. Attempting to implement migration `014` against this lab repo as-is would fail because the prerequisite migrations do not exist here.

Before writing code, one of the following must be true:

1. **Preferred:** the implementation branch is cut from `alindebergASL/account-research` `main` (production) which already contains PR32. The Track 2 work lands as a lab feature in that repo's `web/`, gated by `HERMES_CANVAS_PROPOSALS_ENABLED=0` in production envs. This is the only path that lets migration `014` reference `hermes_jobs`/`hermes_job_events`/`brief_events`/`canvas_states` as already-existing tables.
2. **Alternative:** the PR32 substrate is first replicated into the lab repo by porting `web/lib/hermes/*`, `web/scripts/hermes-runtime-service.ts`, `ecosystem.hermes-lab.config.js`, `web/app/api/briefs/[id]/{canvas-state,hermes-events,hermes-events/stream}/route.ts`, and migrations `012`+`013` to a base branch in this lab repo (`hermes-lab/pr32-substrate` or similar). Migration `014` then lands on top of that. This path doubles the maintenance surface and is recommended only if there is an explicit reason not to do the work in production-main.

**Migration `014` must not be implemented against a branch that lacks `canvas_states`, `hermes_jobs`, `hermes_job_events`, and `brief_events`.** The migration body references those tables for FK relationships, event dispatch, and `saveCanvasState()` calls; without them it cannot compile, and even if it could, it would create orphaned `canvas_proposals` rows.

The plan author and reviewer should agree on path (1) vs (2) explicitly before §6/§7 work begins. Until then, this document remains plan-only.

---

## 1. PR32 inventory (inherited from the prior plan)

The PR32 facts established by Hermes review on the prior plan are unchanged and are inherited here. Summary (see the superseded plan for the full table):

- Production main includes `2afadeb feat: add lab Hermes runtime service (#32)`.
- Files: `web/lib/hermes/{types,client,config,events,chatAdapter,researchAdapter}.ts`, `web/scripts/hermes-runtime-service.ts`, `ecosystem.hermes-lab.config.js`, `web/app/api/briefs/[id]/{canvas-state,hermes-events,hermes-events/stream}/route.ts`.
- Migrations end at `013_hermes_runtime_events_and_canvas_state`. Next free id: `014_…`.
- `canvas_states` is keyed by `brief_id` and has `(brief_id PK, canvas_json, source, version, updated_at, updated_by_job_id)`.
- `canvas_states.source ∈ { "deterministic", "hermes", "fake" }`.
- `hermes_job_events.event_type` is free TEXT; the typed `HermesEventKind` union is the constraint. The append helper writes to column `payload_json` via a `payload` parameter (not "metadata").
- Env flags: `HERMES_RUNTIME_ENABLED`, `HERMES_RUNTIME_FAKE`, `HERMES_RUNTIME_URL`, `HERMES_RUNTIME_PORT`, `HERMES_RUNTIME_BIND_HOST`, `HERMES_SERVICE_TOKEN`.
- Existing `/canvas-state` route is **GET-only**. State writes go through `saveCanvasState()` (server-side helper, accepts `jobId?: string | null`).
- User roles: `admin`/`member`/`viewer`. Share roles: `reader`/`editor`. Auth helpers: `requireUser`, `canReadBrief`, `canWriteBrief`.

A single new lab-only env flag is introduced (§4.6 carried forward): `HERMES_CANVAS_PROPOSALS_ENABLED` (default `0`). Production deploys leave it unset.

This plan does not invent any `CANVAS_RUNTIME_*` namespace.

---

## 2. Data model: `CanvasDocument`

The flat widget list is replaced (at the contract level) with a richer document. The lab-side `Canvas` schema on `hermes-lab/dynamic-canvas` is one input to this design; production's existing `canvas_states.canvas_json` shape is the other input, and `CanvasDocument` is its forward-compatible superset.

### 2.1 Top-level shape

```ts
CanvasDocument = {
  schema_version: 1;                 // bump on any breaking shape change
  document_id: string;               // ulid; primary key inside canvas_json
  brief_id: string;                  // matches canvas_states.brief_id
  version: number;                   // mirrors canvas_states.version
  generated_at: string;              // ISO
  generated_by: NodeProvenance;      // who/what produced this document

  nodes: CanvasNode[];               // widgets + primitives (Layer A + C)
  edges: CanvasEdge[];               // typed relationships between nodes
  sections: CanvasSection[];         // groupings with display affordances
  layout: CanvasLayout;              // placements + view modes
  views: CanvasView[];               // named views (focus path, executive, operator, ...)
  rationale: CanvasRationale[];      // why Hermes made these choices (audit text)

  meta: { display_units?: string; locale?: string; … };
};
```

`document_id` lets undo restore an earlier document by id; `version` is the optimistic-concurrency token shared with `canvas_states.version`.

### 2.2 Node — built-in widget OR safe primitive composition

```ts
CanvasNode =
  | { kind: "widget"; widget_kind: WidgetKind; widget_data: WidgetData; ...common }
  | { kind: "primitive_surface"; surface_spec: PrimitiveSurfaceSpec; ...common }
  | { kind: "capability_placeholder"; capability_proposal_id: string; ...common };

// Common fields on every node
type NodeCommon = {
  id: string;                        // ulid, unique within document
  title: string;
  description?: string;
  confidence?: Confidence;
  source?: WidgetSource;
  why_included?: string;
  sources: Source[];
  evidence: Evidence[];
  status: WidgetStatus;
  controls: WidgetControls;          // descriptive only; renderer ignores in read-only mode
  created_at: string;
  updated_at: string;
  provenance: NodeProvenance;        // "hermes" | "user" | "system" + job_id
  layer: "A" | "B" | "C" | "D";      // see §3
};
```

- `kind: "widget"` is a Layer-A built-in widget (existing five lab widget kinds plus future production-registered kinds). The renderer routes through the existing registry.
- `kind: "primitive_surface"` is a Layer-C safe-primitive composition. `surface_spec` is a declarative JSON DAG of primitives (§3.3). No code, no template interpolation to DOM.
- `kind: "capability_placeholder"` is the on-canvas marker for a Layer-D proposal in flight. It renders as a labeled card showing "New widget proposed — see capability proposal queue". It is **not** executable; clicking it opens a capability-proposal viewer.

### 2.3 Edge — typed relationship

```ts
CanvasEdge = {
  id: string;                        // ulid
  from: NodeRef;                     // node id (with optional handle id)
  to: NodeRef;
  kind: EdgeKind;                    // "supports" | "blocks" | "depends_on" | "evidences" |
                                     // "follows" | "elaborates" | "contrasts" | "groups"
  label?: string;
  rationale?: string;                // Hermes' explanation; surfaced in audit, not always rendered
  weight?: number;                   // 0..1 for visual emphasis
  provenance: NodeProvenance;
};
```

### 2.4 Section — grouping + display affordance

```ts
CanvasSection = {
  id: string;
  title: string;
  intent: SectionIntent;             // "summary" | "evidence" | "decisions" | "risks" |
                                     // "next_actions" | "people" | "questions" | "freeform"
  node_ids: string[];                // member nodes, in display order
  collapse_default: boolean;
  provenance: NodeProvenance;
};
```

Sections are not visual containers in the strict sense; they are a logical grouping the layout can choose to honor (e.g. render section borders, collapse-all on entry to a view). Hermes is encouraged to create sections that match the *intent* enum; the renderer can style by intent if it wants to.

### 2.5 Layout — placements + view modes

```ts
CanvasLayout = {
  mode: "grid" | "freeform" | "hierarchical";
  grid?: { cols: 12; cells: GridCell[] };    // when mode=grid
  freeform?: { positions: { node_id, x, y, w, h }[] };  // when mode=freeform
  hierarchical?: { roots: string[]; spacing?: number };  // when mode=hierarchical
  // The default mode in lab is "grid". Freeform/hierarchical are gated by an extra lab flag
  // (HERMES_CANVAS_LAYOUT_FREEFORM=1) so that the visual prototype stays narrow.
};
```

The renderer **only** consumes whatever the active mode declares. Stale fields from a prior mode are ignored. The reducer enforces "one active mode at a time."

### 2.6 Views — named visual focus paths

```ts
CanvasView = {
  id: string;
  name: string;                      // "Executive overview", "Operator detail", "Risk focus", ...
  visible_node_ids: string[];        // subset of nodes shown in this view
  visible_section_ids: string[];     // subset of sections
  visible_edge_kinds?: EdgeKind[];   // edge-kind filter when this view is active
  emphasis?: { node_id: string; weight: number }[];
  order?: string[];                  // explicit display order; overrides section order
  rationale?: string;                // why this view exists
  provenance: NodeProvenance;
};
```

A view is a saved lens, not a separate document. Switching views is a UI operation; it does not mutate the document.

### 2.7 Rationale — first-class audit text

```ts
CanvasRationale = {
  id: string;
  target: { kind: "document" | "node" | "edge" | "section" | "view" | "layout"; target_id?: string };
  text: string;
  by: NodeProvenance;
  at: string;
};
```

Rationale lines are stored with the document so users can ask "why is this here?" without reading audit events. They are also indexed into `hermes_job_events.payload` for the time-series audit.

### 2.8 Versioning

`CanvasDocument.version` mirrors `canvas_states.version`. A `propose_refresh`-style full-document regeneration creates a new document with `version+1` and **a snapshot is recorded inside the corresponding `canvas_proposals` row** (per-proposal `canvas_before_json` / `canvas_after_json`) so undo is local to the proposal lifecycle. PR32's `canvas_states` is the canonical "current" pointer; history is reconstructable from proposals.

### 2.9 Legacy `Canvas` compatibility (required)

Production `canvas_states.canvas_json` today holds a **flat `Canvas` schema** (the PR32-era shape: account fields, widgets[], optional meta). The new `CanvasDocument` is a forward-compatible superset, but the gateway and renderer must keep dormant production behavior bit-for-bit unchanged while still letting the lab demo see real briefs as `CanvasDocument`. The plan therefore introduces three pure helpers:

```ts
// web/lib/canvas/legacy.ts (new)
export function isCanvasDocument(raw: unknown): raw is CanvasDocument;
export function isLegacyCanvas(raw: unknown): raw is LegacyCanvas;
export function legacyCanvasToDocument(c: LegacyCanvas, briefId: string): CanvasDocument;
```

Rules:

- **Read path** (load `canvas_states.canvas_json` for display):
  1. `isCanvasDocument(raw)` → use as-is.
  2. Else `isLegacyCanvas(raw)` → call `legacyCanvasToDocument(raw, briefId)` and use the result **in memory only**. Do not write the converted document back to `canvas_states`.
  3. Else → render an empty placeholder and emit `hermes_job_events.canvas_proposal.rejected` with `payload.error_code = "unrecognized_canvas_state"`. No throw.
- **Write path** (`saveCanvasState` from the gateway):
  - If `HERMES_RUNTIME_ENABLED=1` AND `HERMES_CANVAS_PROPOSALS_ENABLED=1` AND the applied action produced a `CanvasDocument` → write a `CanvasDocument`.
  - Otherwise → preserve PR32's existing behavior: write a flat `Canvas` (never a `CanvasDocument`). This guarantees that with the new flag off, production's `canvas_states.canvas_json` shape never changes.
- **Conversion semantics (`legacyCanvasToDocument`):**
  - One section is created per "intent" inferred from widget kind (e.g. `evidence_board` → `intent: "evidence"`). Sections that cannot be inferred fall back to `intent: "freeform"`.
  - Each existing widget becomes a `kind: "widget"` `CanvasNode` with the same `id`, `widget_kind`, and data.
  - No edges and no views are synthesized (we do not invent relationships that the legacy shape did not record).
  - Provenance: `generated_by: { kind: "legacy_conversion", at: now() }`. Audited via a single `canvas_proposal.rejected`-class event? No — conversion is a read-time, no-op operation and emits **zero** events.
  - The conversion is pure and deterministic; same input → byte-identical output.
- **Sentinel:** the `CanvasDocument` schema includes `schema_version: 1`. A legacy `Canvas` lacks this field. `isCanvasDocument` checks `schema_version === 1`; `isLegacyCanvas` checks for the legacy-shape presence of `widgets: CanvasWidget[]` and the absence of `schema_version`. Anything else is unrecognized.
- **Dormancy guarantee:** with the new flag(s) off, production code paths never reach `legacyCanvasToDocument` (because the new `/lab/canvas/runtime` UI is the only consumer of the conversion). PR32's existing `/canvas-state` route continues to return the legacy `Canvas` blob unchanged.

---

## 3. Four layers of node/action capability

Every Hermes action falls into exactly one of these four layers. The renderer, reducer, and policy are layer-aware.

### Layer A — built-in registered widgets (existing today)

- Members: the existing widget kinds (`metric`, `open_questions`, `action_panel`, `evidence_board`, `section_ref`, plus future production-registered kinds).
- Renderer: existing per-kind `Tile` / `Detail` components.
- Safety: highest — these are reviewed code paths.
- Hermes verbs: `widget.create`, `widget.update`, `widget.remove`, `widget.add_evidence`, `widget.mark_status`.
- Auto-apply: same policy as the prior plan's `isAutoApply` (additive + confidence ≥ Medium + evidence present). `propose_refresh` is never auto-apply.

### Layer B — layout / design actions

- Members: layout placements, sections, groups, edges, views, layouts.
- No new code surface — the renderer already consumes layout/sections/views.
- Safety: high — these are pure data; the renderer is constrained.
- Hermes verbs: `layout.propose`, `layout.apply`, `section.create`, `section.reorder`, `section.remove`, `node.move`, `node.resize`, `node.group`, `edge.create`, `edge.remove`, `view.create`, `view.update`, `view.delete`, `rationale.add`.
- Auto-apply: layout/section/edge changes auto-apply when confidence ≥ Medium and at least one rationale entry is attached; `node.remove` and `view.delete` always require approval.

### Layer C — safe primitive-composition widgets

Hermes can compose a new widget surface from a small, allowlisted set of declarative primitives. The renderer validates the spec against a Zod schema and refuses anything outside it. No code is involved.

#### 3.3.1 Primitives (initial set)

```ts
PrimitiveSurfaceSpec = {
  // Top-level layout primitive
  root: PrimitiveNode;
};

PrimitiveNode =
  | { p: "stack";    direction: "row" | "col"; gap?: number; children: PrimitiveNode[] }
  | { p: "heading";  level: 1 | 2 | 3 | 4; text: string }
  | { p: "text";     text: string; emphasis?: "normal" | "muted" | "bold" }
  | { p: "kv";       items: { key: string; value: string; confidence?: Confidence }[] }
  | { p: "list";     items: string[]; ordered?: boolean }
  | { p: "table";    columns: string[]; rows: string[][] }
  | { p: "badge";    text: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }
  | { p: "link";     href: string; text: string; rel?: "evidence" | "external" }
  | { p: "evidence_ref"; source_idx: number }   // index into NodeCommon.sources
  | { p: "metric";   label: string; value: string; delta?: string }
  | { p: "spacer";   size?: "sm" | "md" | "lg" }
  | { p: "divider" };
```

#### 3.3.2 Renderer safety rules (non-negotiable)

This is a **safe React primitive renderer**, **not an iframe sandbox**. The plan does not implement an `iframe sandbox` or rely on browser sandbox attributes. The safety guarantee is structural: the renderer dispatches on a closed enum, accepts only declarative JSON, and never opens an escape hatch to the DOM.

1. The primitive renderer is a fixed, source-controlled `switch` over the `p` discriminator. Any unknown `p` value → render nothing (and emit `canvas_proposal.rejected` audit with `payload.error_code = "unknown_primitive"`).
2. All strings render via React `{text}` (`textContent` semantics), never as HTML. `dangerouslySetInnerHTML` is banned throughout `web/components/canvas/**` (enforced by CI lint).
3. `link.href` is validated by an allowlist function that accepts only `https://` URLs (or same-origin `/…` paths). Anything else renders as plain text.
4. No primitive accepts a function reference or a callback. `onClick`, `onError`, etc. are not in the schema.
5. No primitive can include code: `script`, `style`, `iframe`, `object`, `embed`, `link[rel=stylesheet]`, and similar are unrepresentable in the schema.
6. Primitive specs MUST round-trip through `safeParse` at three boundaries: gateway intake, before render, and before write. A failure at any boundary surfaces as a `canvas_proposal.rejected` event with `payload.error_code = "primitive_schema_invalid"`.
7. The renderer never imports modules dynamically. There is no `import(expr)`, no `new Function`, no `eval`. CI lint enforces this (§5).
8. **Capability proposal viewer response hardening.** When a Layer-D capability proposal is fetched for display:
   - The viewer endpoint returns `application/json` only — never `text/html`. Source text is delivered as a JSON string field, not embedded into an HTML page.
   - Response headers include `X-Content-Type-Options: nosniff`. (`Content-Security-Policy` is a deployment-level concern; this plan does not assume a specific CSP, and the safety guarantee does not rely on one.)
   - The viewer must require authentication (§7.2): `requireUser` + `canReadBrief(briefId)`.
   - The browser viewer renders `ts_renderer_source` as `textContent` inside a `<pre>` element. Never via `dangerouslySetInnerHTML`. Never via a syntax-highlighter that constructs HTML; if highlighting is added later, it must produce nested `<span>` elements with hard-coded class names and `textContent`-only children.

#### 3.3.3 Hermes verbs (Layer C)

- `primitive_surface.create` — proposes a new `kind: "primitive_surface"` node with a validated spec.
- `primitive_surface.update` — replaces the spec for an existing primitive_surface node (immutable id; mutable spec; both versions are snapshotted in the proposal).
- `primitive_surface.remove` — same auto/approval rules as `widget.remove`.

Auto-apply: primitive surface create/update auto-applies when (a) the spec validates, (b) confidence ≥ Medium, (c) at least one rationale entry is attached. Remove always requires approval.

### Layer D — lab-only generated widget capability proposals

Hermes can propose a *new widget kind* that does not exist anywhere — including new TypeScript source code for its renderer. This is the only generative-over-code path, and it is tightly fenced.

#### 3.4.1 Shape

```ts
WidgetCapabilityProposal = {
  id: string;                        // ulid
  proposed_widget_kind: string;      // requested new kind name (slug)
  rationale: string;                 // Hermes' explanation
  data_schema: ZodJsonSchema;        // JSON-schema-ish description of the widget's data
  ts_renderer_source: string;        // **text only**. Never executed.
  example_data: unknown;             // example matching data_schema
  primitive_fallback: PrimitiveSurfaceSpec;  // required — what to render until human reviews/promotes
  evidence: Source[];
  proposed_at: string;
  proposed_by: NodeProvenance;
};
```

#### 3.4.2 Promotion path (human-driven, not Hermes-driven)

1. Proposal arrives via the gateway and is **stored** in `canvas_capability_proposals` (new table, §4). `ts_renderer_source` is stored as `TEXT` only. **Nothing in production reads or executes it.**
2. The proposal renders on canvas as `kind: "capability_placeholder"` — a labeled card showing the requested kind name + rationale + a button "Open proposal viewer". Inside the canvas (and in the queue UI), the placeholder uses the `primitive_fallback` to give a rough preview.
3. The proposal viewer (lab-only UI route) shows the `ts_renderer_source` in a read-only `<pre>` element, never injected into the page as code.
4. A human reviewer copies the source to their workstation, creates a branch in `hermes-lab/dynamic-canvas` (or production-side, when appropriate), adds the new widget kind to the registry as normal source-controlled code, opens a PR, gets review, lands the PR, and ships through the normal release flow.
5. Once the kind exists in the registry, the proposal can be marked `promoted` in the DB and the placeholder nodes auto-rewrite to `kind: "widget"` (via a normal Layer A action proposed by Hermes or by a human via the UI). Until then, the placeholder + primitive fallback is what users see.

#### 3.4.3 Safety invariants (mandatory)

- **The app never `import()`s, `eval()`s, or `Function()`s** `ts_renderer_source`. Static analyzers (ESLint rule + CI grep) enforce this against `web/lib/hermes/**` and `web/components/**` at PR time. Plan §6 includes the rule.
- The proposal storage column is `ts_renderer_source TEXT NOT NULL` with a hard cap (50 KB) at write time. Larger values are rejected with `payload.error_code = "ts_renderer_source_too_large"`.
- `ts_renderer_source` is never re-emitted to the browser as JavaScript. The proposal viewer fetches it and renders it inside `<pre>` with text content only.
- Production renderer must not render a `capability_placeholder` node at all unless `HERMES_RUNTIME_ENABLED=1` AND `HERMES_CANVAS_PROPOSALS_ENABLED=1`. In production default state, capability_placeholder nodes never appear because production never has Layer D rows.
- The `primitive_fallback` is run through the Layer-C safety pipeline (§3.3.2) before it is allowed into the document.

#### 3.4.4 Hermes verbs (Layer D)

- `capability.propose` — emits a `WidgetCapabilityProposal`. Effect: writes a `canvas_capability_proposals` row; emits `canvas_capability.proposed`. Does **not** by itself insert a node onto the canvas.
- `capability.placeholder.create` — Layer-D node-insertion verb that places a `kind: "capability_placeholder"` `CanvasNode` onto the document, referencing an already-stored `capability_proposal_id`. **This is the only sanctioned path for creating a placeholder node.** It does not touch the `WidgetKind` registry and cannot be used to create a Layer-A widget.

  ```ts
  type CapabilityPlaceholderCreatePayload = {
    capability_proposal_id: string;          // FK to canvas_capability_proposals.id
    node_id: string;                         // ulid for the new CanvasNode
    title: string;                           // displayed on the placeholder card
    section_id?: string;                     // optional grouping
    layout_hint?: { x?: number; y?: number; w?: number; h?: number };
    rationale: string;
  };
  ```

  The reducer validates that the referenced `capability_proposal_id` exists and is in status `"proposed"` or `"under_review"`. If not, rejects with `payload.error_code = "capability_proposal_missing"`.
- `capability.placeholder.remove` — removes a placeholder node. Always requires approval. Does not by itself withdraw the underlying proposal; pair with `capability.withdraw` for full retraction.
- `capability.withdraw` — Hermes-initiated retraction. Flips the `canvas_capability_proposals` row to `withdrawn`. **Does not** automatically remove placeholder nodes — the gateway synthesizes a paired `capability.placeholder.remove` for any placeholder that referenced it, which goes through the queue (approval required).
- `capability.register` — **does not exist as a Hermes action.** Registration is a human action, performed by merging source code, not via the runtime. The DB row's `status = "promoted"` flag is set via the `mark-promoted` browser route (admin-only) after the human PR ships.

---

## 4. Action families (full list)

The wire shape replaces the prior plan's six-kind `HermesActionKind` with a typed discriminated union of action *families*. Names are stable; payloads vary per family.

```ts
CanvasAction =
  // Layer A — built-in widgets
  | { kind: "widget.create"; payload: WidgetCreatePayload }
  | { kind: "widget.update"; payload: WidgetUpdatePayload }
  | { kind: "widget.remove"; payload: WidgetRemovePayload }
  | { kind: "widget.add_evidence"; payload: AddEvidencePayload }
  | { kind: "widget.mark_status"; payload: MarkStatusPayload }

  // Layer B — layout / design
  | { kind: "node.move"; payload: NodeMovePayload }
  | { kind: "node.resize"; payload: NodeResizePayload }
  | { kind: "node.group"; payload: NodeGroupPayload }
  | { kind: "edge.create"; payload: EdgeCreatePayload }
  | { kind: "edge.remove"; payload: EdgeRemovePayload }
  | { kind: "section.create"; payload: SectionCreatePayload }
  | { kind: "section.reorder"; payload: SectionReorderPayload }
  | { kind: "section.remove"; payload: SectionRemovePayload }
  | { kind: "layout.propose"; payload: LayoutProposePayload }   // dry-run; preview only
  | { kind: "layout.apply"; payload: LayoutApplyPayload }       // commits a previously proposed layout
  | { kind: "view.create"; payload: ViewCreatePayload }
  | { kind: "view.update"; payload: ViewUpdatePayload }
  | { kind: "view.delete"; payload: ViewDeletePayload }
  | { kind: "rationale.add"; payload: RationaleAddPayload }

  // Layer C — safe primitive composition
  | { kind: "primitive_surface.create"; payload: PrimitiveSurfaceCreatePayload }
  | { kind: "primitive_surface.update"; payload: PrimitiveSurfaceUpdatePayload }
  | { kind: "primitive_surface.remove"; payload: PrimitiveSurfaceRemovePayload }

  // Layer D — capability proposals (lab-only, never executed)
  | { kind: "capability.propose"; payload: WidgetCapabilityProposal }
  | { kind: "capability.withdraw"; payload: { capability_proposal_id: string; reason: string } }
  | { kind: "capability.placeholder.create"; payload: CapabilityPlaceholderCreatePayload }
  | { kind: "capability.placeholder.remove"; payload: { node_id: string } }

  // Cross-layer evidence/decision verbs
  | { kind: "evidence.add"; payload: EvidenceOnNodePayload }
  | { kind: "risk.add"; payload: RiskAddPayload }
  | { kind: "hypothesis.add"; payload: HypothesisAddPayload }
  | { kind: "decision.add"; payload: DecisionAddPayload }
  | { kind: "action.add"; payload: NextActionAddPayload }
  | { kind: "propose_refresh"; payload: ProposeRefreshPayload }   // unchanged from PR32 era

  // Whole-document replace (used by the gateway when a response carries
  // canvas_document but no canvas_actions). Always requires approval —
  // never auto-applies because it replaces user-visible state wholesale.
  | { kind: "document.replace"; payload: DocumentReplacePayload };

// Whole-document replace payload
type DocumentReplacePayload = {
  next_document: CanvasDocument;     // validated CanvasDocument
  prior_version: number;             // optimistic concurrency check vs canvas_states.version
  preserve_node_ids?: string[];      // optional; if present, node ids in the list must survive the replace
  rationale: string;                 // free-text; emitted into hermes_job_events.payload
};
```

`document.replace` is explicitly part of the typed union — not a synthetic gateway-internal kind. It validates, reduces, audits, and snapshots like any other action. Reducer pseudocode:

```
applyDocumentReplace(canvas, action):
  if canvas.version !== action.payload.prior_version → reject "version_stale"
  for each id in preserve_node_ids:
    if next_document.nodes has no node with that id → reject "preserve_constraint_violated"
  return next_document (with version+1, generated_at=now, generated_by=action.provenance)
```

Auto-apply policy: **`document.replace` never auto-applies.** Always queued for human approval, regardless of confidence or evidence. Rationale: it overwrites the entire user-visible workspace; a single human OK is the right gate.

A single Hermes response can carry many `CanvasAction`s. They are applied in order; a failure mid-batch aborts the batch and records each applied prefix as auto-applied or queued, and the failing tail as failed (mirrors the prior plan's per-action semantics).

**Allowlist by source** (gateway-enforced; one table):
- `proposed_by = "hermes"`: all action families, including `capability.propose`, `capability.placeholder.create`, `capability.placeholder.remove`, `capability.withdraw`, and `document.replace`.
- `proposed_by = "user"`: Layer A + Layer B + `capability.placeholder.remove` (UI lets a user remove a placeholder they no longer want). **Not** `capability.propose`, `capability.placeholder.create`, `capability.withdraw`, `document.replace`, or `propose_refresh` — those originate from Hermes only.
- `proposed_by = "system"`: `widget.mark_status`, `widget.add_evidence`, `rationale.add` only.

---

## 5. Safety model (summary)

The plan's hardest constraint:

> **No Hermes-generated code is ever loaded, imported, evaluated, or otherwise executed.** Generative is allowed over content, layout, and safe-primitive composition. Generative over code lives entirely in the proposal queue as text, and reaches production only via source-control merge of human-reviewed PRs.

Concretely:
- The renderer dispatches on a closed, source-controlled set of `WidgetKind`s (Layer A) or a closed, source-controlled set of primitive `p` types (Layer C). Anything else is dropped + audited.
- `WidgetCapabilityProposal.ts_renderer_source` is stored as `TEXT` and shown in `<pre>` only.
- Production never has Layer D rows in the default state (`HERMES_CANVAS_PROPOSALS_ENABLED=0`); even if a row appeared, the renderer would still treat the kind as unknown and fall back to the safe primitive preview.
- CI enforces a grep/lint rule banning `eval`, `new Function`, `import(<expr>)`, and dynamic `require` anywhere under `web/lib/hermes/**`, `web/lib/canvas/**`, and `web/components/canvas/**`.
- All primitive surface specs are validated three times: gateway intake, before render, before persist.
- The app remains the sole authority for auth (`requireUser`, `canReadBrief`, `canWriteBrief`), persistence (`saveCanvasState`), audit (`appendHermesJobEvent` + `brief_events`), and approval (the proposal queue UI).

---

## 6. Proposal / audit rails

### 6.1 Tables

Migration `014_canvas_generative_proposals` (forward-only, lab-only-by-flag; rows are dormant unless `HERMES_RUNTIME_ENABLED=1` AND `HERMES_CANVAS_PROPOSALS_ENABLED=1`).

```sql
-- Broad proposals table (renamed from canvas_action_proposals in the prior plan)
CREATE TABLE canvas_proposals (
  id                    TEXT PRIMARY KEY,           -- ulid
  brief_id              TEXT NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  job_id                TEXT,                       -- hermes_jobs.id, when applicable
  request_id            TEXT,                       -- caller-supplied envelope id (one per response, may carry many actions)
  request_action_index  INTEGER,                    -- 0-based index of this action within the response; null when request_id is null
  action_kind           TEXT NOT NULL,              -- one of CanvasAction.kind
  action_layer          TEXT NOT NULL,              -- "A" | "B" | "C" | "D"
  proposed_by           TEXT NOT NULL,              -- "hermes" | "user" | "system"
  action_payload_json   TEXT NOT NULL,              -- validated CanvasAction.payload, serialized
  rationale             TEXT NOT NULL DEFAULT "",
  evidence_json         TEXT NOT NULL DEFAULT "[]",
  confidence            TEXT NOT NULL,
  status                TEXT NOT NULL,              -- lifecycle FSM state
  canvas_version_before INTEGER NOT NULL,
  canvas_version_after  INTEGER,
  canvas_before_json    TEXT,                       -- snapshot for undo
  canvas_after_json     TEXT,
  error                 TEXT,
  retry_of              TEXT,
  capability_proposal_id TEXT,                      -- FK to canvas_capability_proposals (only for Layer D)
  lab_only              INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL,
  decided_at            TEXT,
  decided_by            TEXT
);

CREATE INDEX idx_canvas_proposals_brief_status ON canvas_proposals(brief_id, status);
CREATE INDEX idx_canvas_proposals_job ON canvas_proposals(job_id);
CREATE INDEX idx_canvas_proposals_layer ON canvas_proposals(action_layer);

-- Idempotency: a (brief, request, action-index) tuple uniquely identifies one
-- gateway ingestion attempt. The partial WHERE clause keeps user/system actions
-- (which carry no request_id) out of the uniqueness check.
CREATE UNIQUE INDEX idx_canvas_proposals_request_unique
  ON canvas_proposals(brief_id, request_id, request_action_index)
  WHERE request_id IS NOT NULL;

-- Layer D — capability proposals (lab-only)
CREATE TABLE canvas_capability_proposals (
  id                    TEXT PRIMARY KEY,           -- ulid
  brief_id              TEXT NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  proposed_widget_kind  TEXT NOT NULL,
  rationale             TEXT NOT NULL,
  data_schema_json      TEXT NOT NULL,
  ts_renderer_source    TEXT NOT NULL,              -- <= 50KB, never executed
  example_data_json     TEXT NOT NULL,
  primitive_fallback_json TEXT NOT NULL,
  evidence_json         TEXT NOT NULL DEFAULT "[]",
  status                TEXT NOT NULL,              -- "proposed" | "under_review" | "promoted" | "withdrawn" | "rejected"
  promoted_widget_kind  TEXT,                       -- non-null after human merges the PR registering the kind
  promoted_at           TEXT,
  promoted_by           TEXT,
  proposed_at           TEXT NOT NULL,
  proposed_by_job_id    TEXT
);
```

No `canvas_audit_events` — we continue to reuse `hermes_job_events` for the lifecycle stream (§6.3).

### 6.2 `canvas_states` interaction (unchanged from prior plan)
- Read for optimistic concurrency via `version`.
- Write through `saveCanvasState(briefId, document, { source: "hermes", jobId? })`. `source` stays in PR32's three-value enum.
- Never written for non-applied proposals.

### 6.3 `hermes_job_events` extension

`HermesEventKind` union extension (typing-only, no migration):

```ts
| "canvas_proposal.queued"
| "canvas_proposal.auto_applied"
| "canvas_proposal.applied"
| "canvas_proposal.failed"
| "canvas_proposal.rejected"
| "canvas_proposal.rejected_by_user"
| "canvas_proposal.undone"
| "canvas_proposal.retried"
| "canvas_proposal.timeout"
| "canvas_capability.proposed"
| "canvas_capability.withdrawn"
| "canvas_capability.promoted"          // emitted by the human-driven promotion path
| "canvas_layout.preview_proposed"      // for layout.propose (dry-run)
| "canvas_layout.applied"
| "canvas_view.changed"                 // when a view is created/updated/deleted
```

The append helper writes `payload` (column `payload_json`). Payload examples:

```ts
// canvas_proposal.queued
{ proposal_id, action_kind, action_layer, request_id, confidence, evidence_count }

// canvas_proposal.rejected
{ proposal_id?, action_kind?, error_code, validation_path?, request_id? }  // never the offending value

// canvas_capability.proposed
{ capability_proposal_id, proposed_widget_kind, ts_renderer_source_length, has_primitive_fallback: true }
```

> **Invariant unchanged:** exactly one `hermes_job_events` row per gateway decision, including pre-proposal rejections. Raw envelope content is never persisted (paths + codes + counts only).

### 6.4 `brief_events` policy

A `brief_events` row is appended **only when canvas state actually changes** — i.e. on `canvas_proposal.auto_applied` and `canvas_proposal.applied`. No row for queued, rejected, failed, retried, withdrawn, or any layout-preview activity. This keeps the brief timeline clean.

### 6.5 Wire types — additive extension of PR32

PR32's existing types stay; we add three optional fields:

```ts
// web/lib/hermes/types.ts (proposed additive extension)
export type HermesCanvasSynthesisResponse = {
  canvas: Canvas;                                // legacy full-state synthesis (preserved)
  canvas_document?: CanvasDocument;              // NEW — full generative document synthesis
  canvas_actions?: CanvasAction[];               // NEW — typed actions to apply
  widget_capability_proposals?: WidgetCapabilityProposal[];  // NEW — Layer D, lab only
  extensions?: BriefExtension[];
  events?: HermesRuntimeEventInput[];
};

export type HermesChatResponse = {
  reply: string;
  patches_applied: BriefPatch[];
  patch_errors: string[];
  brief?: Brief;
  canvas?: Canvas;                               // legacy
  canvas_document?: CanvasDocument;              // NEW
  canvas_actions?: CanvasAction[];               // NEW
  widget_capability_proposals?: WidgetCapabilityProposal[]; // NEW (lab only)
  events?: HermesRuntimeEventInput[];
};
```

Gateway interpretation order on a single response:

1. If `canvas_actions` is present and non-empty → run the proposal lifecycle per-action. **Authoritative.**
2. Else if `canvas_document` is present → treat as a full-document replace proposal (single proposal row with `action_kind = "document.replace"`, snapshot semantics same as a regular apply).
3. Else if `canvas` (legacy) is present → preserve PR32's legacy behavior: write `canvas_states` directly with `source: "hermes"`, no proposal row, no `canvas_proposal.*` events.
4. `widget_capability_proposals` is processed *in parallel* (always lab-only-gated). For each proposal the gateway:
   - writes a `canvas_capability_proposals` row,
   - emits `canvas_capability.proposed`,
   - and, if the gateway is configured to surface placeholders on canvas, **synthesizes an additional `capability.placeholder.create` action** (Layer D) which goes through the same proposal lifecycle as any other action.

The placeholder is **never** created via `widget.create`. `widget.create` operates on the closed source-controlled `WidgetKind` registry; `capability_placeholder` is a `CanvasNode.kind` value, not a registered `WidgetKind`, and the renderer routes it through a separate Layer-D code path. This preserves the invariant that `widget.create` payload's `widget_kind` is always a member of the registered `WidgetKind` enum.

Ambiguity is **audited but resolved deterministically**: if a response carries both `canvas_actions` and `canvas_document`, the gateway prefers `canvas_actions` and emits `canvas_proposal.rejected` with `payload.error_code = "ambiguous_canvas_document_and_actions"`. Same pattern as the prior plan's `canvas` vs `canvas_actions` ambiguity (now extended).

**No `RuntimeRequest` / `RuntimeResponse` types** — additive optional fields only.

### 6.5.1 Idempotency

A Hermes response is identified by `request_id` (carried in `HermesChatResponse.events` / `HermesCanvasSynthesisResponse.events` metadata, or supplied by the caller). A single response can carry many `canvas_actions`; each gets a stable `request_action_index = 0…n-1`. The gateway enforces idempotency via the partial unique index on `(brief_id, request_id, request_action_index)`:

- **First ingest** of `(brief_id, request_id, request_action_index = 0)` → row inserted normally.
- **Duplicate ingest** of the same triple → the gateway `safeParse`-validates as usual, then attempts the insert, catches the unique-constraint violation, and returns the existing `proposal_id` to the caller. **No second `canvas_proposals` row created. No second `hermes_job_events` row created.** A duplicate ingest is **not** a fresh gateway decision and produces **no user-visible audit event**. Duplicate detection is recorded only via a server-side log line (and an optional counter metric if observability is wired up) — not via the audit stream. This preserves the "exactly one `hermes_job_events` row per gateway decision" invariant without exception.
- **Same `request_id` with a different `request_action_index`** is **not** a duplicate; it is a distinct action within the same response.
- Actions without a `request_id` (e.g. user-originated UI mutations) are **not** subject to idempotency; each call creates a fresh proposal. UI is expected to debounce client-side.
- The unique index uses `WHERE request_id IS NOT NULL` so user/system inserts (which leave `request_id` NULL) do not contend with the index.

---

## 7. API / server plan

### 7.1 Gateway module

`web/lib/hermes/canvasGenerativeGateway.ts` (renamed from the prior plan's `canvasProposalGateway.ts` to reflect the broader scope). In-process callable; not an HTTP route.

Exports:

```ts
ingestCanvasResponse(ctx, response: HermesChatResponse | HermesCanvasSynthesisResponse)
approveProposal(ctx, proposalId)
rejectProposal(ctx, proposalId, reason)
retryProposal(ctx, proposalId)
undoProposal(ctx, proposalId)
listProposals(ctx, briefId, filter)

// Layer D management (lab-only)
listCapabilityProposals(ctx, briefId, filter)
withdrawCapabilityProposal(ctx, capabilityProposalId, reason)
markCapabilityPromoted(ctx, capabilityProposalId, registeredWidgetKind)  // human-driven, never Hermes
```

### 7.2 Browser-facing routes (lab-only)

| Path | Verb | Purpose |
|---|---|---|
| `GET /api/briefs/[id]/canvas-proposals` | GET | List proposals, filterable by status / layer. |
| `POST /api/briefs/[id]/canvas-proposals/[pid]/approve` | POST | Approve. |
| `POST /api/briefs/[id]/canvas-proposals/[pid]/reject` | POST | Body `{ reason }`. |
| `POST /api/briefs/[id]/canvas-proposals/[pid]/retry` | POST | Retry a failed. |
| `POST /api/briefs/[id]/canvas-proposals/[pid]/undo` | POST | Undo an applied. |
| `GET /api/briefs/[id]/canvas-capability-proposals` | GET | List capability proposals. |
| `POST /api/briefs/[id]/canvas-capability-proposals/[cpid]/withdraw` | POST | Withdraw. |
| `POST /api/briefs/[id]/canvas-capability-proposals/[cpid]/mark-promoted` | POST | Body `{ promoted_widget_kind }`. **admin only.** Marks the row promoted after a human PR has shipped registering the kind. |

All routes:
- Return 404 unless `HERMES_RUNTIME_ENABLED=1` AND `HERMES_CANVAS_PROPOSALS_ENABLED=1`.
- Auth via `requireUser` + `canReadBrief` / `canWriteBrief` (capability `mark-promoted` additionally requires user-role `admin`).
- Never on `/s/[token]/*`.

### 7.3 Routes NOT modified

- `/api/briefs/[id]/canvas-state` — stays GET-only; gateway writes via `saveCanvasState()`.
- `/api/briefs/[id]/hermes-events{,/stream}` — unchanged; new event kinds flow through.
- `/api/briefs/[id]/chat` — unchanged.
- `/api/share/*`, `/s/[token]/*` — untouched.
- `/api/research`, `/api/research-jobs/*` — untouched.

### 7.4 Adapter changes

- `web/lib/hermes/chatAdapter.ts`, `web/lib/hermes/researchAdapter.ts`: after the Hermes runtime response is received, call `ingestCanvasResponse(ctx, response)` directly. Behavior gated by `HERMES_RUNTIME_ENABLED && HERMES_CANVAS_PROPOSALS_ENABLED`.
- When `HERMES_CANVAS_PROPOSALS_ENABLED=0`, adapters ignore the three new optional response fields entirely — PR32 behavior is bit-for-bit preserved.

### 7.5 Feature flags (final list)

| Flag | Source | Default | Purpose |
|---|---|---|---|
| `HERMES_RUNTIME_ENABLED` | PR32 | 0 | Master Hermes gate. |
| `HERMES_RUNTIME_FAKE` | PR32 | 0 (prod) / 1 (lab) | Forces deterministic fake responses. |
| `HERMES_RUNTIME_URL` / `_PORT` / `_BIND_HOST` | PR32 | per env | Sidecar transport (127.0.0.1 only). |
| `HERMES_SERVICE_TOKEN` | PR32 | per env | Sidecar↔app auth. |
| `HERMES_CANVAS_PROPOSALS_ENABLED` | new, lab-only | 0 | Master gate for Layer A/B/C proposal lifecycle + Layer D capability proposals. |
| `HERMES_CANVAS_LAYOUT_FREEFORM` | new, lab-only | 0 | Allows `CanvasLayout.mode = "freeform" | "hierarchical"`. Off → only `"grid"`. |

Two new flags. Both default off. Production deploys leave them unset.

---

## 8. UI / lab demo plan

`/lab/canvas/runtime` — server-backed generative canvas demo. Minimal styling.

### 8.0 Auth posture (must be settled before any real-brief read path)

The current lab `/lab` middleware entry treats `/lab` as a public path (introduced for fixture-only demos on `hermes-lab/dynamic-canvas`). That is **incompatible with reading real brief data**. The plan requires one of these two postures, chosen at implementation time and documented in the page:

- **A. Authenticated mode (required if the page accepts a `?briefId=<id>`):**
  - The route requires `requireUser` middleware.
  - Every server-side load checks `canReadBrief(briefId)`; mutation routes additionally enforce `canWriteBrief`.
  - The `/lab` PUBLIC_PATHS entry is **either removed for `/lab/canvas/runtime` specifically (preferred)** or the page itself short-circuits to a login redirect when no session is present.
  - The capability viewer endpoint also requires `requireUser` + `canReadBrief` and returns `application/json` only.
- **B. Fixture-only mode (only path that may stay unauthenticated):**
  - No `?briefId` parameter accepted. Path is `/lab/canvas/runtime/fixture` (or the page ignores any provided briefId).
  - No database reads. The page is hydrated from a JS-bundled fixture only.
  - No mutations possible (`HERMES_CANVAS_PROPOSALS_ENABLED` is irrelevant on this variant).

The plan picks **A as the default for the named demo route `/lab/canvas/runtime?briefId=<id>`**, with B available as a separate route for offline demos. Authenticated mode is required for everything in §8.1–§8.3 because they assume real brief, proposal, and event data.

The middleware change is small: remove the blanket `/lab` PUBLIC_PATHS entry, or replace it with a narrower `/lab/fixture` entry. Either way, the authenticated route is the only path that touches the gateway.

### 8.1 Page sections

1. **Header strip:** brief id, canvas version, current view selector, flag status pills (e.g. "Runtime: ON", "Proposals: ON").
2. **Canvas pane (main):** renders the `CanvasDocument`:
   - Sections rendered as labeled groupings.
   - Nodes rendered per kind: Layer A via existing widget registry, Layer C via the primitive renderer (safe set only), Layer D as labeled placeholder cards with the primitive fallback inside.
   - Edges rendered as thin connectors with edge-kind icons + optional labels.
   - Layout honors `CanvasLayout.mode` (grid in v1, freeform/hierarchical only if `HERMES_CANVAS_LAYOUT_FREEFORM=1`).
3. **Proposal queue (right rail):** the existing `ProposalQueue` UI extended to show `action_layer` chips (A/B/C/D) and a separate tab for capability proposals.
4. **Event strip (bottom):** filtered to `canvas_proposal.*` and `canvas_capability.*` and `canvas_layout.*` kinds.
5. **Layout rationale panel (collapsible, below header):** lists the most recent `CanvasRationale` entries for the document. Each shows target + text + by + at.
6. **Capability proposal viewer (modal):** opens from queue or placeholder. Shows: requested kind name, rationale, data schema (rendered as JSON), example data, primitive fallback preview, and `ts_renderer_source` in a read-only `<pre>` with a "Copy to clipboard" button — no syntax-highlighting library that injects DOM, just plain `<pre>` text. No execution.

### 8.2 Demo flows (lab QA)

The demo can drive these flows from fake Hermes fixtures, no live model needed:

- **A. Generate a fresh layout.** Hermes emits a `canvas_document` plus a few rationale entries. Gateway treats it as a `document.replace` proposal. Queue shows one row. Approving applies; canvas redraws.
- **B. Rearrange.** Hermes emits `node.move` + `section.reorder` + `view.create` actions. Layer B auto-applies (per policy). Event strip shows three events; rationale panel adds an entry.
- **C. Compose a primitive surface.** Hermes emits `primitive_surface.create` with a small spec (heading + KV list + evidence_ref). The primitive renderer paints it; clicking opens a drill that shows the spec and sources.
- **D. Propose a new widget capability.** Hermes emits `capability.propose`. Capability tab in the queue lights up. Canvas shows a `capability_placeholder` with the proposed name + the primitive fallback as the in-place preview. The viewer renders the TS source in `<pre>`. No execution path exists.

### 8.3 Out of scope (UI)

No animations beyond what already exists, no themes, no drag handles for freeform layout, no edge auto-routing — straight lines only. The point is to prove the data model is renderable and safe, not to ship a designer.

---

## 9. Testing plan

### 9.1 Unit tests (Zod / pure)

| File (new) | Cases |
|---|---|
| `tests/canvas.document.schema.test.ts` | `CanvasDocument` Zod round-trip; node discriminator; required-field minima; round-trip preserves rationale ordering. |
| `tests/canvas.actions.schema.test.ts` | All `CanvasAction.kind` payloads validate; unknown kinds rejected. |
| `tests/canvas.gateway.layer_allowlist.test.ts` | Table-driven `(proposed_by, action.kind)` allowlist. |
| `tests/canvas.gateway.policy.test.ts` | Auto-apply rules per layer; `propose_refresh` never auto-apply; Layer-D never auto-apply. |
| `tests/canvas.gateway.errors.test.ts` | One `hermes_job_events` row per pre-proposal rejection, zero proposals; raw envelope never in `payload`. |
| `tests/canvas.gateway.ambiguity.test.ts` | Both-fields ambiguity (`canvas_actions` vs `canvas_document`, `canvas` vs `canvas_actions`) → audited but deterministic. |

### 9.2 Reducer / apply tests

| File (new) | Cases |
|---|---|
| `tests/canvas.reducer.layerA.test.ts` | Widget create/update/remove; idempotency on `idem_key`; evidence dedupe. |
| `tests/canvas.reducer.layerB.test.ts` | move/resize/group/edge/section/view/layout — all preserve invariants (referential integrity of `node_ids`, `from`/`to`, etc.). Removing a node cascades to edges and view membership. |
| `tests/canvas.reducer.layerC.test.ts` | primitive_surface create/update — spec validates before write; remove. |
| `tests/canvas.reducer.layerD.test.ts` | `capability.propose` writes a `canvas_capability_proposals` row only (no placeholder node, no canvas mutation). `capability.placeholder.create` (separate action) inserts the placeholder `CanvasNode` referencing an existing capability_proposal_id; rejects when the referenced row is missing. `capability.withdraw` flips the capability row to `withdrawn` and, when a placeholder referencing it exists, synthesizes a queued `capability.placeholder.remove` (approval required). `mark-promoted` (manual, admin-only browser route — not a Hermes action) flips status to `promoted` only after a human PR has registered the kind in source-controlled code; it does not synthesize any canvas action. |
| `tests/canvas.reducer.document_replace.test.ts` | `document.replace` is in the typed union; validates `prior_version`; rejects `version_stale`; honors `preserve_node_ids`; snapshot/undo round-trip; never auto-applies. |
| `tests/canvas.reducer.capability_placeholder.test.ts` | `capability.placeholder.create` inserts a `kind: "capability_placeholder"` node referencing an existing `canvas_capability_proposals.id`. **Asserts the node is NOT created via `widget.create` and that `widget.create` rejects `widget_kind: "capability_placeholder"`** (closed `WidgetKind` enum). Placeholder removal via `capability.placeholder.remove` requires approval. |
| `tests/canvas.legacy.conversion.test.ts` | `isCanvasDocument` / `isLegacyCanvas` / `legacyCanvasToDocument` round-trip. Same input → byte-identical output. A `Canvas` with no `schema_version` converts; a `CanvasDocument` passes through unchanged; an unrecognized shape produces a `canvas_proposal.rejected` audit with `payload.error_code = "unrecognized_canvas_state"` and no throw. |
| `tests/canvas.gateway.idempotency.test.ts` | Duplicate ingest of `(brief_id, request_id, request_action_index)` returns the existing `proposal_id`. **No duplicate `canvas_proposals` row. No duplicate `hermes_job_events` row.** `hermes_job_events` row count is unchanged before vs. after the duplicate call. Same `request_id` with a different `request_action_index` is **not** a duplicate (creates a fresh row + one new event). NULL `request_id` rows do not contend with the unique index. |

### 9.3 Primitive renderer safety tests

| File (new) | Cases |
|---|---|
| `tests/canvas.primitive.schema.test.ts` | Every primitive `p` value parses; unknown `p` rejected. |
| `tests/canvas.primitive.render.safety.test.ts` | Renderer never produces a `<script>`, never sets `innerHTML`, never assigns to a function-typed prop. Property-based tests over random valid specs assert no escape. Links with non-https/non-same-origin hrefs render as text. |

### 9.3.1 Route auth tests

| File (new) | Cases |
|---|---|
| `tests/canvas.route.auth.test.ts` | Unauthenticated `GET /lab/canvas/runtime?briefId=<id>` returns redirect-to-login (Option A authenticated mode). Authenticated user without `canReadBrief` on the requested brief gets 403. Authenticated `reader` cannot hit approve/reject (403). The `/lab/canvas/runtime/fixture` variant (Option B) responds 200 with no DB read and a bundled-fixture body, regardless of session presence. |

### 9.4 Generated-widget non-execution tests

| File (new) | Cases |
|---|---|
| `tests/canvas.capability.no_execution.test.ts` | Round-trip a `WidgetCapabilityProposal.ts_renderer_source` containing payload like `globalThis.__pwned = true` and assert that after gateway ingestion, render of the placeholder, and viewer mount, `globalThis.__pwned` is undefined. |
| `tests/canvas.capability.no_dynamic_import.test.ts` | Lint/grep gate: grep the gateway + renderer + viewer source for `eval(`, `new Function(`, `import(<expr>)`, `require(<expr>)`. Fail the test if matched. |
| `tests/canvas.capability.size_cap.test.ts` | `ts_renderer_source` > 50 KB → `payload.error_code = "ts_renderer_source_too_large"`. |
| `tests/canvas.capability.viewer_pre_only.test.ts` | The proposal viewer renders source as a `<pre>` with text content; assert via snapshot that no `<script>`/`<style>`/`<iframe>` is emitted. Viewer response is `Content-Type: application/json` and includes `X-Content-Type-Options: nosniff`. Source field is delivered as a JSON string; the browser-side viewer uses `textContent` only. |

### 9.5 Audit invariant tests

| File (new) | Cases |
|---|---|
| `tests/canvas.gateway.invariant.test.ts` | Every gateway decision (auto-apply, queue, fail, reject, retry, undo, capability propose/withdraw/promote, ambiguity, schema rejection) writes exactly one `hermes_job_events` row. Raw envelope never present in `payload`. |
| `tests/canvas.gateway.brief_events.test.ts` | `brief_events` row appended **only** on applied and auto_applied canvas changes — not on queued, rejected, failed, retried, withdrawn, layout-preview, view-changes. |

### 9.6 Browser QA checklist

Run with `HERMES_RUNTIME_ENABLED=1 HERMES_RUNTIME_FAKE=1 HERMES_CANVAS_PROPOSALS_ENABLED=1 npm run dev`. Open `/lab/canvas/runtime?briefId=<id>`.

- [ ] Page loads with current `canvas_states` document.
- [ ] **Flow A — generative document:** fake Hermes returns a `canvas_document` + rationale entries; one proposal queued; approve; canvas redraws; rationale panel shows new entries.
- [ ] **Flow B — layout rearrange:** fake Hermes returns multiple Layer-B actions; auto-apply happens per policy; event strip shows three events.
- [ ] **Flow C — primitive surface:** fake Hermes returns `primitive_surface.create` with a heading + KV list + evidence_ref + table; the surface renders inside the canvas; drill shows the spec.
- [ ] **Flow D — capability proposal:** fake Hermes returns `capability.propose`; the capability tab shows the proposal; the canvas shows a `capability_placeholder` with the primitive fallback as preview; opening the viewer shows the TS source in `<pre>`; the page's JS does not load any new script tag and `globalThis.__pwned` (planted by the fake) remains `undefined`.
- [ ] An ambiguous response (both `canvas_actions` and `canvas_document`) is accepted via `canvas_actions`, and one `canvas_proposal.rejected` audit event is visible with `error_code: "ambiguous_canvas_document_and_actions"`.
- [ ] A malformed `canvas_action[i]` from fake Hermes produces one `canvas_proposal.rejected` audit event, no proposal row, and `payload_json` contains a `validation_path` but not the offending value.
- [ ] Approving and undoing within the undo window round-trip the canvas; event strip shows the pair.
- [ ] Reload the page — full state reloads from server (canvas, queue, events, capability proposals).
- [ ] Public share route (`/s/[token]/*`) remains unaffected; nothing about proposals or generative content leaks.
- [ ] Browser console: clean. No CSP violations. No unhandled promise rejections.
- [ ] CI lint gate fails if any new `eval(`, `new Function(`, dynamic `import()` is added under `web/lib/hermes/**`, `web/lib/canvas/**`, or `web/components/canvas/**`.

---

## 10. Acceptance criteria

The implementation milestone is done when **all** of the following hold:

1. **Generative flow works.** A fake-Hermes response carrying `canvas_actions` / `canvas_document` / `widget_capability_proposals` ingests cleanly, persists proposals correctly, applies under policy, and renders.
2. **Production dormancy preserved.** With `HERMES_RUNTIME_ENABLED=0` (production default), the production app is bit-for-bit unchanged: same routes, same DB writes, same rendered canvas. Flipping `HERMES_RUNTIME_ENABLED=1` alone (without `HERMES_CANVAS_PROPOSALS_ENABLED=1`) preserves PR32's existing behavior — the new fields on response types are silently ignored.
3. **No code execution.** No path imports/evaluates `WidgetCapabilityProposal.ts_renderer_source`. CI grep gate enforces this. The capability viewer renders source in `<pre>` only.
4. **Renderer safety.** The Layer C primitive renderer drops unknown `p` values, never sets `innerHTML`, never accepts function props, never renders non-https/non-same-origin links as `<a>`.
5. **Audit invariant.** Exactly one `hermes_job_events` row per gateway decision, every time. Raw envelope content never present in `payload_json`.
6. **`brief_events` clean.** Only applied canvas changes append a row.
7. **Auth model honored.** All routes use `requireUser` + `canReadBrief`/`canWriteBrief`; capability `mark-promoted` additionally requires user-role `admin`. Public share routes untouched.
8. **PR32 surfaces unchanged.** `/canvas-state`, `/hermes-events`, `/hermes-events/stream` are not modified.
9. **Migrations forward-only.** Single migration `014_canvas_generative_proposals` creates `canvas_proposals` + `canvas_capability_proposals`. No drops, no alters of existing tables.
10. **All tests pass** §9.

---

## 11. Key tradeoffs

| Decision | Picked | Tradeoff |
|---|---|---|
| Document model vs. flat widget list | **CanvasDocument** | Forward-compatible with everything Hermes will want to do. Costs more code, more tests, more validation surface. |
| Four explicit layers (A/B/C/D) | **Yes** | Makes the safety boundary auditable per node. Each new action explicitly chooses its layer. |
| Primitive composition vs. ban any new surface | **Allow primitives** | Hermes can compose a new tile without code. Risk: spec drift. Mitigation: closed primitive enum + Zod + render-time validation. |
| Capability proposals vs. forbid them | **Allow as text-only proposals** | Captures the "Hermes wants to invent a widget" path without ever running its code. The promotion path is humans + source control. |
| Per-proposal canvas snapshot | **Yes** | Cheap undo. May bloat DB at scale; sweep job is a follow-up. |
| Reuse `hermes_job_events` for audit | **Yes** | One audit stream, one SSE. |
| Renamed table `canvas_action_proposals` → `canvas_proposals` | **Renamed** | Reflects broader action set. Migration is fresh (014), no rename pain. |
| Two new lab flags | **Yes** | `HERMES_CANVAS_PROPOSALS_ENABLED` is the lifecycle gate; `HERMES_CANVAS_LAYOUT_FREEFORM` keeps the visual prototype narrow. Both default off. |
| Layout `mode` exclusive | **Yes** | Renderer never has to guess. Stale fields ignored. |
| Layout `view` is a saved lens, not a separate document | **Yes** | Avoids document explosion. |
| Auto-apply for Layer B (layout/sections/edges) | **Yes for additive; no for removes** | Keeps the demo flowing; destructive layout changes still gate. |
| Capability `mark-promoted` requires user-role admin | **Yes** | Reflects that promotion is a code/release decision, not a brief-edit decision. |
| `document.replace` typed as a first-class `CanvasAction` | **Yes** | Gateway-internal "kind strings" are a code smell. Reducer validates + audits it like any other action; never auto-applies. |
| Placeholder insertion via `capability.placeholder.create` (Layer D) instead of `widget.create` | **Yes** | Preserves the closed `WidgetKind` enum invariant. `widget.create` only ever creates registered widgets. |
| Legacy `Canvas` ⇄ `CanvasDocument` conversion at read time | **Yes** | Lets the lab demo see real briefs as documents without ever writing a `CanvasDocument` into `canvas_states` when proposals are disabled. Dormant production behavior is byte-identical. |
| Idempotency via partial-unique `(brief_id, request_id, request_action_index)` | **Yes** | Cheap, declarative, lets duplicates fail at the DB layer. UI-originated mutations stay out of the contention path. |
| Safe primitive renderer vs. iframe sandbox | **Safe renderer** | Structural safety (closed enum, no `dangerouslySetInnerHTML`, no functions on the wire) beats an iframe whose escape surface still depends on browser-side bugs. Viewer endpoint adds `nosniff` + JSON-only response. |

---

## 12. Open questions

These remain unresolved and should be decided by the implementer before §6/§7 code lands.

1. **`document.replace` vs. action-stream.** When Hermes returns a full `canvas_document`, do we persist it as a single proposal (current plan) or decompose it into a synthesized action stream (`widget.create×N + edge.create×M + …`) before persisting? The current plan picks single-proposal for simplicity; decomposition would give finer-grained undo.
2. **Cross-document references.** Edges and views currently reference nodes by id within the same document. Should they ever cross documents (e.g. one focus path that spans the brief and an extension)? Plan says no in v1; revisit.
3. **Primitive renderer testing harness.** Property-based testing for `<script>` escape would benefit from a library (fast-check, etc.). Add or hand-roll? Plan defers to the implementer.
4. **Capability proposal storage TTL.** No expiration in lab. Should production (if ever enabled) auto-expire withdrawn proposals after N days?
5. **Layer C primitive set evolution.** When Hermes consistently composes the same primitive pattern, should that pattern be auto-promoted to a Layer A widget? Plan says no automatic promotion — promotion always goes through human PR review of source-controlled code.
6. **Freeform layout collision resolution.** When two nodes overlap in freeform mode, who decides? Plan says the renderer renders in `node_ids` order without collision avoidance in v1. Hierarchical mode is similarly naive.
7. **View-conditioned auto-apply.** Should auto-apply policy depend on which view is active? Probably no — auto-apply is content/data-driven, not view-driven. Confirm.
8. **`canvas_document.generated_by` granularity.** A document was produced by some combination of Hermes/job/version; what exactly do we record? Plan suggests `{ kind: "hermes", job_id, model_version? }` but the runtime might not expose `model_version`.

---

## 13. Things deliberately NOT in this milestone

- **No execution of any Hermes-generated code.** Capability proposals are stored, displayed, and promoted only via human source-control review.
- **No new wire envelope types.** PR32's existing `HermesChatResponse` / `HermesCanvasSynthesisResponse` are extended with three optional fields only.
- **No `CANVAS_RUNTIME_*` envs.** Only PR32 envs plus two lab-only gates.
- **No app-calls-itself HTTP.** Adapters call the gateway in-process.
- **No PUT on `/canvas-state`.** Writes via `saveCanvasState()`.
- **No new audit table.** `hermes_job_events` is the audit; `payload_json` is the carrier.
- **No public-share exposure.** `/s/[token]/*` is untouched.
- **No live model calls.** `HERMES_RUNTIME_FAKE=1` in lab.
- **No production behavior change.** Production deploys leave both new lab flags unset.
- **No automatic promotion of Layer C patterns to Layer A widgets.** Promotion is always a human PR.
- **No visual polish.** Functional demo only.
- **No deploy.**
