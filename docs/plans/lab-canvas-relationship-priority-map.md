# Lab prototype: Canvas relationship / priority map

Status: lab-only. Branch `lab/canvas-relationship-priority-map` off `main`. **Not** a production deploy plan.

## What this is

A working prototype of a Canvas-native view that the existing Brief view structurally cannot do: a **2D priority matrix** (impact × urgency) where every dot is an initiative, sized by the number of derived relationship edges, and a side panel showing the selected initiative's full graph — personas, risks, signals, and the brief's next action.

Live route in the lab: `/lab/canvas/priority-map`.

Demo account: `Acme Regional Health` (regional healthcare system, mid-program AI review). The page renders this single hand-tuned fixture with a "Show derived JSON" toggle for product review — there is **no** account picker in the prototype. Adding one would be a small follow-up; the derivation function works against any Brief that conforms to the production schema.

## Why this is Canvas-native

A static brief renders initiatives, personas, risks, and signals as four independent sections. The viewer has to reconstruct the relationships by reading prose. Canvas can present them as a single object with explicit edges, in a fixed visual frame the eye can scan. None of this requires a model call — every edge is derived deterministically from the existing Brief schema by token overlap and name appearance.

The differentiator is **placement plus structure**:
- Placement (impact × urgency) is the prioritization argument.
- Structure (typed edges to personas/risks/signals/next-action) is the rationale.
- A reviewer can audit any edge — the `evidence_text` field on every edge says why it was drawn.

## Files in this branch

```
web/middleware.ts                                       (added /lab to PUBLIC_PATHS)
web/lib/canvas/priorityMap/schema.ts                    Zod schema for derived PriorityMap
web/lib/canvas/priorityMap/derive.ts                    pure derivation from Brief
web/lib/canvas/priorityMap/fixtures.ts                  Acme Regional Health demo account
web/components/canvas/PriorityMap.tsx                   SVG matrix + relationship panel
web/app/lab/canvas/priority-map/page.tsx                lab route
tests/priorityMap.derive.test.ts                        13 deterministic tests
docs/plans/lab-canvas-relationship-priority-map.md      this document
```

No other files touched.

## Data contract

A `PriorityMap` is purely derived data — nothing in it should be authored by hand.

```ts
PriorityMap = {
  account_name: string;
  generated_at: string;          // copied from Brief.generated_at
  initiatives: PriorityMapInitiative[];
  nodes: PriorityMapNode[];      // side index of every related node
  next_action: string;           // copied from Brief.next_action
  diagnostics: {                 // populated-counts for QA
    initiative_count, edge_count,
    persona_link_count, risk_link_count,
    signal_link_count, next_action_link_count,
  };
}

PriorityMapInitiative = {
  id: string;                    // slug of title
  title: string;
  detail: string;
  confidence: "High" | "Medium" | "Low" | "Not found";
  source: string;
  impact: 0..5;                  // y-axis
  urgency: 0..5;                 // x-axis
  evidence_count: number;        // edge count (proxy until production wires real Source counts)
  edges: RelationshipEdge[];
}

RelationshipEdge = {
  kind: "persona" | "risk" | "signal" | "next_action";
  target_id: string;             // node id
  label: string;                 // display text
  evidence_text: string;         // **required** — why this edge was drawn
  confidence?: Confidence;       // inherited from linked node when present
}

PriorityMapNode = {
  id: string;
  label: string;
  kind: "persona" | "risk" | "signal" | "next_action";
  confidence?: Confidence;
  meta: Record<string, string>;  // free-form descriptive metadata
}
```

The Zod schema lives at `web/lib/canvas/priorityMap/schema.ts` and is the single source of truth for production import.

## Derivation rules

All deterministic, no model. Implemented in `derive.ts`. The intent is "conservative — better to miss an edge than fabricate one."

- **Impact** = `confidence_floor + min(persona_overlap_score, 2.5)`, clamped to 0..5.
  - `confidence_floor`: High=3, Medium=2, Low=1, Not found=0.
  - `persona_overlap_score`: sum of persona priority weights for personas whose name appears in the initiative text OR whose profile shares ≥2 tokens with the initiative.
- **Urgency** = `confidence_present ? 1 : 0 + min(signal_match_count, 4)`, clamped to 0..5.
  - `signal_match_count`: number of recent_signals with ≥1 token overlap with the **initiative title** (stricter than the persona/risk overlap to avoid false positives).
- **Initiative → persona edge**: drawn if the persona's name appears in the initiative text, or ≥2 tokens overlap with the persona profile.
- **Initiative → risk edge**: drawn if ≥1 token overlaps with the risk string.
- **Initiative → signal edge**: drawn if ≥1 token overlaps with the signal text, against the initiative title.
- **Initiative → next_action edge**: drawn if ≥1 token overlaps with the brief's `next_action`.
- Tokenization: lowercase, alpha-numeric, drop stopwords + a small domain-stopword set (`ai`, `data`, `platform`, `team`, `new`, `modern`, `key`, `next`) to suppress overly-generic matches.

Every edge carries an `evidence_text` field that explains the derivation rule that fired. A reviewer can audit any edge without re-running the algorithm.

## Recommended production architecture

### Is a new widget kind justified?

**Yes — `priority_map` should be a new Canvas widget kind**, for three reasons:

1. **Different rendering surface.** All other widget kinds are tile + drill modal; the priority map needs a half-width SVG matrix with a coupled detail panel. Forcing this into the existing tile model would either shrink it to uselessness or break the grid metaphor.
2. **Different data shape.** The `data` is a graph (nodes + edges) plus a 2D placement, not a flat list. The discriminated-union pattern in the existing widget schema fits this cleanly.
3. **Different update cadence.** It's derived, so it regenerates with the Brief — never user-authored. Treating it as a first-class kind makes the regen path explicit: when a Brief refreshes, the canvas refreshes its `priority_map` widget by re-running `derivePriorityMap(brief)`.

The widget body holds the full `PriorityMap`. Confidence/status/sources at the widget level mirror the highest-confidence initiative's confidence (as a default — production can decide).

### What can be derived now, from existing Canvas data

Everything in this prototype. Production already has, on each Brief:

- `top_initiatives[]` (title, detail, confidence, source)
- `personas[]` (name, title, priority, opener, confidence)
- `risks[]` (string list)
- `recent_signals[]` (text, source, confidence)
- `next_action` (string)

The derivation in `derive.ts` does **not** require any additional fields. Production can wire this into the existing brief→canvas bridge with a single call:

```ts
const priorityMapWidget: CanvasWidget = {
  kind: "priority_map",
  data: derivePriorityMap(brief),
  // ...standard widget metadata...
};
```

### What should wait

These would be improvements but should not block a production port:

- **Per-edge sources.** Today `evidence_text` is a derivation rationale, not a citation. Once Hermes (or another tool) populates a richer edge with the originating Source rows, the panel can linkify and show the same SourcesBlock pattern the rest of Canvas uses.
- **Custom weights / weighting UI.** The current scoring is hardcoded. Production should not expose weight knobs in v1 — but the function signature should leave room for a weights argument (`derivePriorityMap(brief, weights?)`).
- **Animations / drag-to-reprioritize.** Out of scope; would conflate derived data with user state.
- **Cross-account view.** Useful, but a separate product question; the per-account map should land first.

## Risks / complexity

- **Token-overlap heuristics are brittle.** Stopword tuning is the main lever. The prototype's stopword set already drops generic domain terms like "AI" and "data"; production should expand this list based on real briefs and add explicit term-skip lists per segment (healthcare vs. public sector vs. financial services).
- **Persona name false positives** are the biggest risk (a persona whose name is also a common noun). Mitigation: persona edges require name-appearance OR strong token overlap — never just title-overlap.
- **Sparse briefs produce empty maps.** Handled — the empty-Brief test passes and the UI shows zero dots with no error. Production should gate the widget on `briefCompleteness(b).filled >= 4` or similar.
- **Visual scaling.** With >25 initiatives the matrix gets crowded. v1 should cap at top 12 (highest impact*urgency product) and show the rest in a "More initiatives" list below. The prototype does not enforce a cap because the test fixture has only 5.

## Port-back plan

**Important — do not copy the lab schema verbatim.** The lab module redeclares a local `Confidence` Zod enum (`web/lib/canvas/priorityMap/schema.ts`) so the prototype is sandbox-isolated and has no dependency on production's Brief schema. **In production, the priority-map schema must reuse / import production's existing `Confidence` definition** rather than redeclaring it. The local redeclaration is for lab isolation only and is not part of the recommended production shape.

Likewise, the **`/lab` entry added to `web/middleware.ts` `PUBLIC_PATHS` is lab-only** and must not be ported. Production's Canvas continues to be gated by the existing server/admin Canvas gate:

- `CANVAS_PREVIEW_ENABLED=1` (server env, default off)
- admin role required
- not exposed to the public-share route

**PR-A (lab→prod):**
- Port the **shapes** of `web/lib/canvas/priorityMap/schema.ts` into production, but rewrite the import line to use production's existing `Confidence` enum from `web/lib/schema.ts`. Drop the local `Confidence` redeclaration — it is sandbox-isolation scaffolding only. All other types (`PriorityMap`, `PriorityMapInitiative`, `PriorityMapNode`, `RelationshipEdge`, `RelationshipKind`) port unchanged.
- Port `web/lib/canvas/priorityMap/derive.ts` as a pure function. No edits needed beyond the `Confidence` import path.
- Add `priority_map` to production's `WidgetKind` enum and to its registry.
- Mirror `tests/priorityMap.derive.test.ts` against a representative production-shape fixture.
- No DB migration. No API route. No model calls. Pure derivation at bridge time.
- **Do NOT** port `web/middleware.ts` changes. **Do NOT** port `web/lib/canvas/priorityMap/fixtures.ts` (lab-only demo data). **Do NOT** port `web/app/lab/canvas/priority-map/page.tsx` (lab demo route).

**PR-B (visual):**
- Port `web/components/canvas/PriorityMap.tsx` (the visual component itself). Drop any lab-specific imports.
- Mount it in production's Canvas under the **existing** server-side Canvas gate — `CANVAS_PREVIEW_ENABLED=1` + admin role — not under any new flag and explicitly not exposed via the public share route. If production has additional preview flags, follow whatever is already in place; do not introduce a new client-visible flag for this.
- Visual QA against three representative briefs (one high-data, one medium, one sparse) before flipping the env var on.

**PR-C (refresh wiring):**
- Re-run `derivePriorityMap(brief)` on brief refresh / revert / version select, the same way other derived widgets refresh today.

No DB migration is required for any step. The `PriorityMap` is computed on read; if production prefers to skip serialization entirely, it can also compute the map on every render — the function is microsecond-fast and pure.

## Verification

Run from the repo root:

```bash
cd web && npm run typecheck     # clean
cd web && npm run build         # /lab/canvas/priority-map static, 6.06 kB
npx tsx --test tests/priorityMap.derive.test.ts   # 13/13 pass
npx tsx --test tests/schema.test.ts tests/briefMerge.test.ts tests/priorityMap.derive.test.ts   # 16/16 pass
```

## Things intentionally NOT touched

- Production repo (`alindebergASL/account-research`) — no PRs, no branches.
- Production brief schema, brief merge, or any production component.
- Auth, sessions, share routes, email, nodemailer.
- Anthropic SDK, research worker, cost ledger.
- DB / SQLite / migrations.
- PM2, nginx, deployment scripts.
- Production env vars or secrets.
- Existing lab branch `hermes-lab/dynamic-canvas` (this branch is independent off main).

Lab artifacts only.
