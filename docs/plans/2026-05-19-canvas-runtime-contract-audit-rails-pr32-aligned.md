# Canvas Runtime Contract + Audit Rails — Lab Implementation Plan (PR32-aligned)

Status: **PLAN ONLY**. Lab-only. Do not deploy. Do not modify production code as part of executing this plan.
Date: 2026-05-19
Author: Track 2 lab agent
Plan branch: `lab/canvas-runtime-contract-plan` (this revision lives alongside the original)
Supersedes: `docs/plans/2026-05-15-canvas-runtime-contract-audit-rails.md` (original 2026-05-15 plan; left in tree for traceability)
Production target: `alindebergASL/account-research` `main` (head includes `2afadeb feat: add lab Hermes runtime service (#32)`)

---

## 0. Source-of-truth note (read first)

I do **not** have direct MCP/git access to `alindebergASL/account-research` from this session — that repo is out of scope for this agent. The PR32 inventory below (file paths, migration numbers, env var names, `canvas_states` columns, sibling tables) is taken **verbatim from the task brief** rather than inspected. Every statement that depends on production state is tagged `[per brief]`. Before implementation, the engineer executing this plan must spot-check each `[per brief]` claim against the production repo and surface any drift before writing code.

The previous plan was written without this PR32 inventory and so reinvented several things PR32 already provides. This revision aligns the lab work to PR32.

---

## 1. PR32 inventory (assumed truth — verify before implementing)

### 1.1 Production main head [per brief]
- Commit `2afadeb feat: add lab Hermes runtime service (#32)` is on `alindebergASL/account-research` `main`.

### 1.2 Files PR32 added [per brief]
| File | Role (inferred from name) |
|---|---|
| `web/lib/hermes/types.ts` | Wire types for the Hermes runtime service: requests, responses, events, job records. **Source of truth** for `HermesChatResponse` / `HermesCanvasSynthesisResponse`. |
| `web/lib/hermes/client.ts` | App-side HTTP client to the sidecar. |
| `web/lib/hermes/config.ts` | Reads `HERMES_RUNTIME_*` env, computes URL, exports a single config object. |
| `web/lib/hermes/events.ts` | Emit/read helpers for `hermes_job_events` and `brief_events`. |
| `web/lib/hermes/chatAdapter.ts` | Wraps the prod chat path to optionally route through the Hermes runtime when `HERMES_RUNTIME_ENABLED=1`. Dormant by default. |
| `web/lib/hermes/researchAdapter.ts` | Same idea for the research path. Dormant by default. |
| `web/scripts/hermes-runtime-service.ts` | The actual sidecar (Node script). Binds 127.0.0.1:`HERMES_RUNTIME_PORT`. |
| `ecosystem.hermes-lab.config.js` | **Lab-only** PM2 file for the sidecar. Production deploys do not load it. |
| `web/app/api/briefs/[id]/canvas-state/route.ts` | GET/PUT canvas state for a brief, backed by `canvas_states`. |
| `web/app/api/briefs/[id]/hermes-events/route.ts` | Tail of audit/event rows. |
| `web/app/api/briefs/[id]/hermes-events/stream/route.ts` | SSE stream of new events. |

### 1.3 Migration numbers [per brief]
- `012_brief_events`
- `013_hermes_runtime_events_and_canvas_state`
- **Next free id: `014_…`**. The old plan's reservation of `012` is wrong and is retracted.

### 1.4 Tables that already exist [per brief]
- `hermes_jobs`
- `hermes_job_events`
- `brief_events`
- `canvas_states`:
  ```
  brief_id PRIMARY KEY,
  canvas_json,
  source,
  version,
  updated_at,
  updated_by_job_id
  ```

### 1.5 Env flags already defined [per brief]
| Flag | Purpose |
|---|---|
| `HERMES_RUNTIME_ENABLED` | Master gate. Off → all Hermes paths dormant. |
| `HERMES_RUNTIME_FAKE` | Use the deterministic fake instead of any real model. |
| `HERMES_RUNTIME_URL` | Sidecar URL. |
| `HERMES_RUNTIME_PORT` | Sidecar port. |
| `HERMES_RUNTIME_BIND_HOST` | Should be `127.0.0.1` in lab. |
| `HERMES_SERVICE_TOKEN` | Shared secret between app and sidecar. |

This plan **uses only these flags** and adds at most one new lab-only flag (§4.6).

### 1.6 What this plan does NOT inspect
- I did not fetch production `web/lib/db.ts` to confirm the migration list ends at 013.
- I did not fetch `web/lib/hermes/types.ts` to read `HermesChatResponse` / `HermesCanvasSynthesisResponse` shapes — they are treated as opaque envelope types in §2.
- I did not fetch `ecosystem.hermes-lab.config.js` to verify the sidecar process name.

A first-pass implementer must read those three files and surface deltas before §2/§3 are committed to.

---

## 2. Proposed architecture (PR32-aligned)

### 2.1 Headline decision

**Choice: (B) app-side proposal gateway that consumes `HermesCanvasSynthesisResponse` (and chat tool-call output where relevant) and persists proposals.** Not (A) (new endpoint on the sidecar).

Reasons:

1. The sidecar (`web/scripts/hermes-runtime-service.ts`) is a model adapter: it produces typed envelopes and emits job-level events. Proposal lifecycle, approval, undo, and human-in-the-loop are **app-side** concerns and belong next to the brief/share auth model, not next to the model adapter.
2. PR32 already added a `/canvas-state` route and a `canvas_states` table app-side. The gateway lives in the same surface — natural to extend, no transport boundary to redesign.
3. Choice (A) would force the sidecar to read/write `canvas_states` and own the proposal table, duplicating auth and migration concerns the app already handles.
4. Reverting (A) is hard; reverting (B) is just removing the gateway module and a route. (B) preserves PR32's dormancy.

The sidecar is unchanged by this plan. The new work sits **after** the sidecar response is received.

### 2.2 Data flow (PR32-aligned)

```
chat / research path
        │
        ▼
┌─────────────────────────────┐
│ hermes/chatAdapter.ts or    │ (PR32 — unchanged)
│ hermes/researchAdapter.ts   │
└──────────────┬──────────────┘
               │ HermesChatResponse / HermesCanvasSynthesisResponse
               ▼
┌─────────────────────────────┐
│  Canvas proposal gateway    │ (NEW — app-side, lab-only behind flag)
│  web/lib/hermes/canvas      │
│  ProposalGateway.ts         │
│                             │
│  - extract canvas ops       │
│  - classify (auto vs queue) │
│  - write canvas_action_     │
│    proposals row            │
│  - emit hermes_job_events   │
│  - on auto: bump            │
│    canvas_states + audit    │
└──────┬───────────────┬──────┘
       │               │
       ▼               ▼
canvas_action_      hermes_job_events
proposals           (lifecycle audit)
       │               │
       ▼               ▼
canvas_states     brief_events
(only on apply)   (human-readable changes that landed)
       │
       ▼
GET /api/briefs/[id]/canvas-state   ← PR32 route, untouched
GET /api/briefs/[id]/hermes-events  ← PR32 route, untouched
GET /api/briefs/[id]/hermes-events/stream  ← PR32 route, untouched
```

### 2.3 Wire shapes (existing, reused)

The gateway operates on **the response shapes PR32 already defined** in `web/lib/hermes/types.ts`. This plan does not invent new wire types:

- `HermesChatResponse` — tool calls (existing brief-patch tool today; potentially a canvas-op tool tomorrow).
- `HermesCanvasSynthesisResponse` — typed canvas operations.

If those shapes do not yet carry the canvas-op data we need, the implementing engineer extends them inside the existing module — they are still PR32's wire types, not ours.

For internal use (gateway → store), the gateway projects the response into the existing lab `HermesAction` shape (`web/lib/canvas/actions.ts` on `hermes-lab/dynamic-canvas`) so the existing reducer and lifecycle FSM can be reused. **No new `RuntimeRequest`/`RuntimeResponse` types** — that was the old plan's mistake.

### 2.4 Canvas operation schema (reused)

Reuse the existing `HermesActionKind` and per-kind payloads from `web/lib/canvas/actions.ts`:
`append_widget`, `update_widget`, `remove_widget`, `mark_status`, `add_evidence`, `propose_refresh`.

If the production `HermesCanvasSynthesisResponse` shape exposes a different operation enum, the gateway translates at the boundary; only the translation table changes.

### 2.5 Allowed action types (per-source allowlist)

| `proposed_by` (job actor) | Allowed action kinds |
|---|---|
| `hermes` (job rows from the runtime service) | all 6 |
| `user` (in-app user via UI) | append, update, remove, mark_status, add_evidence (no `propose_refresh`; UI uses a separate explicit refresh button → research-jobs path) |
| `system` (sweep jobs, TTL marks) | `mark_status`, `add_evidence` |

Implemented as a single table in the gateway, not scattered. Disallowed combos → `policy_denied` (see §2.7).

### 2.6 Proposal vs. auto-apply decision tree

```
HermesCanvasSynthesisResponse arrives
  ├── HERMES_RUNTIME_ENABLED != 1?         → 404 / dormant (route should not exist)
  ├── envelope schema invalid?              → reject; one hermes_job_event row
                                              (event_type="canvas_proposal.rejected",
                                               metadata={ error_code: "schema_invalid",
                                                          request_id?, source });
                                              NO canvas_action_proposals row
  ├── HERMES_RUNTIME_FAKE expected, marker missing?
                                            → reject; same pattern, code=fake_marker_missing
  ├── canvas_states.version stale?          → reject; code=version_stale
  ├── allowlist denies?                     → reject; code=policy_denied
  ├── per-brief rate limit exceeded?        → reject; code=rate_limited
  ├── auto-apply policy satisfies all of:
  │     - action.kind in AUTO_APPLY_KINDS_BY_SOURCE[proposed_by]
  │     - confidence >= Medium
  │     - evidence.length >= 1
  │     - reducer succeeds on the current canvas
  │                                          → AUTO APPLY:
  │                                            * write canvas_action_proposals row
  │                                              (status="auto_applied")
  │                                            * update canvas_states (version++)
  │                                            * hermes_job_events row
  │                                              (event_type="canvas_proposal.auto_applied")
  │                                            * brief_events row for human-readable log
  └── else                                   → QUEUED:
                                              * write canvas_action_proposals row
                                                (status="proposed")
                                              * hermes_job_events row
                                                (event_type="canvas_proposal.queued")
                                              (no brief_events yet — only on apply)
```

`propose_refresh` is **never** auto-apply, regardless of source.

### 2.7 Error / timeout behavior (precise, single definition)

Resolves the contradiction the reviewer flagged in the prior plan:

**Malformed envelope (`schema_invalid`):**
- Gateway returns HTTP 400 to the caller (sidecar adapter / chat adapter).
- **No** `canvas_action_proposals` row written.
- **One** `hermes_job_events` row written with:
  - `event_type = "canvas_proposal.rejected"`
  - `metadata = { error_code: "schema_invalid", request_id?: string, source: "chatAdapter"|"canvasSynthesis"|"manual", validation_path: string }`
  - Raw payload **never** stored. We persist only the Zod error path (e.g. `"action.payload.widget.title"`), not the offending value.
- UI: the malformed request appears in the existing `/hermes-events/stream` SSE feed (it's a real `hermes_job_events` row); it does **not** appear in the proposal queue UI (no proposals row).
- Rationale: the lab operator can see the request happened, classify it, and triage; the proposal queue stays clean of garbage.

Other error codes (`version_stale`, `policy_denied`, `rate_limited`, `fake_marker_missing`, `timeout`):
- Same pattern: HTTP error to caller, **one** `hermes_job_events` row written, **no** `canvas_action_proposals` row, raw payload not persisted (only field paths / counts).
- These never appear in the proposal queue UI; they show only in the event stream.

Apply-time failure (`reducer_rejected`, e.g. `idem_key` collision, target widget missing):
- We have a valid proposal — **one** `canvas_action_proposals` row written with `status = "failed"` and `error` populated.
- **One** `hermes_job_events` row with `event_type = "canvas_proposal.failed"`.
- This **does** appear in the queue UI under the `failed` filter and supports retry.

**Timeouts:**
- Sidecar HTTP call timeout: 5s app-side, 2.5s producer-side (the sidecar's outbound model call, if any) [per brief, per PR32 likely already enforces].
- A timeout that arrives after a partial write is treated as `failed` proposal with `error = "timeout"`; full timeline visible in `hermes_job_events`.

### 2.8 Event audit flow

Every `canvas_action_proposals` transition emits exactly one `hermes_job_events` row. Schema-invalid and policy rejections also emit one `hermes_job_events` row (but no proposal row). So:

> **Invariant:** exactly one `hermes_job_events` row per gateway decision. Always. Even for things rejected before they become proposals.

This invariant is testable (§6) and is the single audit guarantee the plan offers.

We **reuse `hermes_job_events`** rather than creating a `canvas_audit_events` table because:
- PR32 already wires the audit/event read path through `hermes_job_events`.
- Both `hermes-events` GET and SSE routes already serialize this table.
- The proposal lifecycle is naturally a sub-flow of a Hermes job; the join key (`job_id`) is already on `hermes_job_events`.
- A separate `canvas_audit_events` table would double the read path and force two SSE streams.

Reviewer's prompt said "A new `canvas_action_proposals` table is probably acceptable. A separate `canvas_audit_events` table must be justified." — we agree and we drop `canvas_audit_events`.

`brief_events` is the human-readable timeline for the brief. We append a `brief_events` row **only when canvas state actually changes** (auto-apply or post-approve apply). That keeps `brief_events` from being polluted with proposal noise.

### 2.9 Authorization model (real, brief-scoped)

Replacing all `account_id` language from the prior plan.

| Operation | Required |
|---|---|
| `POST /api/briefs/[id]/canvas-proposals` (internal route, lab-only, called by adapters; not a public API) | adapter has `HERMES_SERVICE_TOKEN`; brief must exist; `HERMES_RUNTIME_ENABLED=1` |
| `GET /api/briefs/[id]/canvas-proposals` | `requireUser` + `canReadBrief(briefId)` (reader+) |
| `POST /api/briefs/[id]/canvas-proposals/[pid]/approve` | `requireUser` + `canWriteBrief(briefId)` (editor or admin) |
| `POST /api/briefs/[id]/canvas-proposals/[pid]/reject` | `requireUser` + `canWriteBrief(briefId)` |
| `POST /api/briefs/[id]/canvas-proposals/[pid]/retry` | `requireUser` + `canWriteBrief(briefId)` |
| `POST /api/briefs/[id]/canvas-proposals/[pid]/undo` | `requireUser` + `canWriteBrief(briefId)` |

Uses existing `requireUser`, `canReadBrief`, `canWriteBrief` helpers (`web/lib/auth.ts`) — same helpers the production chat route uses. **Public share routes (`/s/[token]/...`) are not touched**; the proposal queue is never exposed to share viewers.

Role mapping per existing `brief_shares.role`:
- `viewer`/`reader` → read proposals + audit, cannot approve/reject.
- `editor` → all of viewer + approve/reject/retry/undo on this brief.
- `admin` (global) → same as editor on any brief.

---

## 3. Database / migration plan

### 3.1 New table — `014_canvas_action_proposals`

Forward-only migration, lab-only-by-flag (column `lab_only` defaults 1; rows with `lab_only=0` are only inserted when `HERMES_RUNTIME_FAKE != 1`).

```sql
CREATE TABLE canvas_action_proposals (
  id                    TEXT PRIMARY KEY,           -- ulid
  brief_id              TEXT NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  job_id                TEXT,                       -- hermes_jobs.id, when the proposal came from a Hermes job
  request_id            TEXT,                       -- optional caller-supplied envelope id
  proposed_by           TEXT NOT NULL,              -- "hermes" | "user" | "system"
  action_kind           TEXT NOT NULL,              -- one of HermesActionKind
  action_payload_json   TEXT NOT NULL,              -- validated HermesAction.payload, serialized
  rationale             TEXT NOT NULL DEFAULT "",
  evidence_json         TEXT NOT NULL DEFAULT "[]", -- Source[]
  confidence            TEXT NOT NULL,
  status                TEXT NOT NULL,              -- ActionState enum (proposed/applying/auto_applied/applied/failed/rejected/undone/expired)
  canvas_version_before INTEGER NOT NULL,
  canvas_version_after  INTEGER,                    -- null until applied
  canvas_before_json    TEXT,                       -- snapshot for undo (small in lab)
  canvas_after_json     TEXT,                       -- snapshot for undo
  error                 TEXT,                       -- non-null if status in (failed, timeout)
  retry_of              TEXT,                       -- proposal id this retries, if any
  lab_only              INTEGER NOT NULL DEFAULT 1, -- defense in depth; matches HERMES_RUNTIME_FAKE
  created_at            TEXT NOT NULL,
  decided_at            TEXT,
  decided_by            TEXT                        -- users.id if approved/rejected/undone by a person
);

CREATE INDEX idx_canvas_proposals_brief_status ON canvas_action_proposals(brief_id, status);
CREATE INDEX idx_canvas_proposals_request ON canvas_action_proposals(request_id);
CREATE INDEX idx_canvas_proposals_job ON canvas_action_proposals(job_id);
```

### 3.2 Tables NOT created
- **No `canvas_audit_events`** — superseded by reusing `hermes_job_events` (§2.8).
- **No new `canvas_states`** — table already exists from migration `013` and we use its `brief_id`, `version`, `updated_by_job_id` exactly as PR32 defines them.

### 3.3 `canvas_states` interaction
- Reads: gateway reads `(version, canvas_json)` to enforce optimistic concurrency.
- Writes: gateway updates `canvas_json`, increments `version`, sets `updated_at = now()`, sets `updated_by_job_id` to the originating job id when present. `source` is set to a stable string like `"hermes_proposal_auto"` / `"hermes_proposal_applied"` to distinguish from PR32's existing sources.
- The gateway **never** writes `canvas_states` for non-applied proposals.

### 3.4 `hermes_job_events` interaction
Add three new `event_type` values used by the gateway (no schema change needed if `event_type` is a free string column):
- `canvas_proposal.rejected` — pre-proposal rejections (schema_invalid, version_stale, policy_denied, rate_limited, fake_marker_missing). Metadata describes the reason; no payload stored.
- `canvas_proposal.queued` — proposal accepted, awaiting approval.
- `canvas_proposal.auto_applied` — proposal applied without human approval.
- `canvas_proposal.applied` — proposal applied after human approval.
- `canvas_proposal.failed` — proposal valid but reducer rejected it.
- `canvas_proposal.rejected_by_user` — human reject.
- `canvas_proposal.undone` — human undo.
- `canvas_proposal.retried` — human retry created a new proposal.
- `canvas_proposal.timeout` — sidecar/apply timeout.

If `hermes_job_events.event_type` is a CHECK constraint or enum (likely [per brief check needed]), this list must be added to that constraint in migration `014` as a single ALTER. Document at implementation time.

### 3.5 `brief_events` interaction
One row appended per **applied** canvas change (auto-applied or post-approve applied). Not per proposal. Keeps the human-readable brief timeline clean.

### 3.6 Rollback / snapshot strategy
Per-proposal snapshot (`canvas_before_json` + `canvas_after_json`) for undo. Simple, fits lab volumes. No compression. If lab volume becomes a problem, gzip is a one-line follow-up.

### 3.7 Migration id
`014_canvas_action_proposals` — explicit retraction of the prior plan's `012` claim. The migration is forward-only in production but the rows it creates are dormant unless `HERMES_RUNTIME_ENABLED=1`.

---

## 4. API / server plan

### 4.1 Routes to add (lab-only, all under existing brief auth)

| Path | Verb | Purpose |
|---|---|---|
| `POST /api/briefs/[id]/canvas-proposals` | POST | Internal callable. Adapter posts a typed proposal envelope here. Authenticated by `HERMES_SERVICE_TOKEN` header; never exposed to browsers. |
| `GET /api/briefs/[id]/canvas-proposals` | GET | List proposals for a brief, filterable by status. Browser/UI. |
| `POST /api/briefs/[id]/canvas-proposals/[pid]/approve` | POST | Approve a queued proposal. |
| `POST /api/briefs/[id]/canvas-proposals/[pid]/reject` | POST | Body `{ reason }`. |
| `POST /api/briefs/[id]/canvas-proposals/[pid]/retry` | POST | Re-emit a failed proposal as a new queued proposal. |
| `POST /api/briefs/[id]/canvas-proposals/[pid]/undo` | POST | Undo an auto-applied or applied proposal. |

All six routes:
- Return 404 unless `HERMES_RUNTIME_ENABLED=1`.
- Use `requireUser` + `canReadBrief` / `canWriteBrief` from `web/lib/auth.ts`.
- Never accept share-token auth. Never available on `/s/[token]/...`.
- Reject cross-brief writes by route shape.

The internal `POST .../canvas-proposals` route additionally:
- Requires `HERMES_SERVICE_TOKEN` header equal to `process.env.HERMES_SERVICE_TOKEN` (PR32's existing secret).
- Refuses any envelope missing `lab_only: true` (or whatever PR32's existing fake marker is) when `HERMES_RUNTIME_FAKE=1`.

### 4.2 Routes NOT modified
- `/api/briefs/[id]/canvas-state` (PR32) — unchanged. UI continues to read it.
- `/api/briefs/[id]/hermes-events` (PR32) — unchanged. New event types flow through it automatically.
- `/api/briefs/[id]/hermes-events/stream` (PR32) — unchanged.
- `/api/briefs/[id]/chat` (prod) — unchanged. The gateway only fires from inside `chatAdapter.ts` / `researchAdapter.ts`, which are already dormant behind `HERMES_RUNTIME_ENABLED`.
- `/api/share/*`, `/s/[token]/*` — public share, untouched.
- `/api/research`, `/api/research-jobs/*` — untouched.

### 4.3 Adapter changes (small, gated)
- `web/lib/hermes/chatAdapter.ts` — when the chat tool-call output includes canvas operations, forward to the gateway instead of applying directly. Guarded by `HERMES_RUNTIME_ENABLED && HERMES_CANVAS_PROPOSALS_ENABLED`.
- `web/lib/hermes/researchAdapter.ts` — same forwarding when the research path yields a canvas-synthesis response.

These are the **only** places the adapter behavior changes. If `HERMES_CANVAS_PROPOSALS_ENABLED=0`, the adapters behave exactly as PR32 shipped them.

### 4.4 Transport
No new transport. The sidecar transport from PR32 (`HERMES_RUNTIME_URL`, `HERMES_SERVICE_TOKEN`, `HERMES_RUNTIME_BIND_HOST=127.0.0.1`) is the only transport. The previous plan's `CANVAS_RUNTIME_TRANSPORT` / `CANVAS_RUNTIME_PORT` / `CANVAS_RUNTIME_SHARED_SECRET` are **retracted** — they duplicated PR32's flags.

### 4.5 Validation boundaries
Three boundaries; never trust a previous layer:
1. **Sidecar wire** — validated by PR32's existing Zod schemas in `web/lib/hermes/types.ts`.
2. **Gateway** — re-validates the projected `HermesAction` against the existing lab action schema.
3. **Reducer** — validates per-kind payload (PR32-independent).

### 4.6 Lab-only feature flags
| Flag | Source | Default | Purpose |
|---|---|---|---|
| `HERMES_RUNTIME_ENABLED` | PR32 | `0` | Master gate. All gateway routes 404 when 0. |
| `HERMES_RUNTIME_FAKE` | PR32 | `0` (in prod) / `1` (in lab) | Refuses non-fake envelopes when 1. |
| `HERMES_RUNTIME_URL` / `_PORT` / `_BIND_HOST` | PR32 | per env | Transport. Bind host must be `127.0.0.1`. |
| `HERMES_SERVICE_TOKEN` | PR32 | per env | Sidecar ↔ app auth. |
| `HERMES_CANVAS_PROPOSALS_ENABLED` | **new, lab-only** | `0` | Routes adapter canvas ops through the proposal gateway instead of applying directly. Off → PR32 behavior unchanged. |

`HERMES_CANVAS_PROPOSALS_ENABLED` is the **only** new env var this plan introduces. Justification: PR32's `HERMES_RUNTIME_ENABLED` is the master Hermes gate; we need a separate, finer gate so that the proposal lifecycle can be toggled independently of the underlying Hermes substrate (e.g. for A/B reviews where Hermes is enabled but canvas mutations should remain dormant). It defaults off in every environment.

---

## 5. UI plan

### 5.1 Minimal UI surface
| File | Status | Purpose |
|---|---|---|
| `web/app/lab/canvas/runtime/page.tsx` | new | Lab demo route — proposal queue + canvas state + event strip, all wired to PR32's existing `/canvas-state` and `/hermes-events/stream` plus the new `/canvas-proposals`. |
| `web/components/canvas/ProposalQueue.tsx` | new | Reads `/api/briefs/[id]/canvas-proposals`. Approve / reject / retry / undo. |
| `web/components/canvas/EventStrip.tsx` | new | Renders the SSE stream from `/hermes-events/stream`, filtered to `canvas_proposal.*` event types. |
| `web/components/canvas/CanvasView.tsx` | reused from `hermes-lab/dynamic-canvas` | Mounted in server-backed mode (reads `canvas-state` instead of localStorage). |

No changes to production Canvas components. The lab demo route exists alongside the existing `/lab/canvas` localStorage demo.

### 5.2 SSE vs polling
Reuse `/hermes-events/stream` (PR32 SSE) — no new polling. Old plan's 5s polling is retracted.

### 5.3 Empty / disabled states
- `HERMES_RUNTIME_ENABLED=0` → page shows a banner "Lab runtime disabled" and nothing else.
- `HERMES_CANVAS_PROPOSALS_ENABLED=0` → page shows a banner "Canvas proposals disabled" and the read-only canvas (PR32's existing surface).
- No proposals → "No proposals yet. Trigger a Hermes job to create one."

### 5.4 Out of scope
Theming, drag-reorder, keyboard shortcuts beyond what exists, animations, export. UI must verify the flow; that's the only goal.

---

## 6. Testing plan

### 6.1 Unit tests
| File (new) | Cases |
|---|---|
| `tests/canvas.gateway.contract.test.ts` | Projection `HermesCanvasSynthesisResponse → HermesAction[]`. Zod round-trip. Rejects unknown action kinds. |
| `tests/canvas.gateway.allowlist.test.ts` | Every `(proposed_by, action.kind)` pair table-driven. Asserts `policy_denied` for disallowed combos. |
| `tests/canvas.gateway.policy.test.ts` | `propose_refresh` is never auto-apply. Confidence floor enforced. Evidence floor enforced. |
| `tests/canvas.gateway.errors.test.ts` | **Each pre-proposal rejection writes exactly one `hermes_job_events` row and zero `canvas_action_proposals` rows.** Raw payload never appears in the metadata column. |

### 6.2 Integration tests (lab sqlite)
| File | Cases |
|---|---|
| `tests/canvas.gateway.db.test.ts` | Apply migrations 001..014 against a temp sqlite. propose → queued → approve → applied → audit round-trip. FK invariants. |
| `tests/canvas.gateway.versioning.test.ts` | Stale `canvas_states.version` → `version_stale`. Concurrent proposes don't double-apply. |
| `tests/canvas.gateway.retry.test.ts` | failed → retry creates new proposal with `retry_of` set. |
| `tests/canvas.gateway.brief_events.test.ts` | `brief_events` row is appended on apply only, not on queue/reject/fail. |
| `tests/canvas.gateway.invariant.test.ts` | The §2.8 invariant: exactly one `hermes_job_events` row per gateway decision, always. |

All tests use temp DB files; never `web/data/briefs.sqlite`.

### 6.3 Browser QA checklist
Run with `HERMES_RUNTIME_ENABLED=1 HERMES_RUNTIME_FAKE=1 HERMES_CANVAS_PROPOSALS_ENABLED=1 npm run dev`. Open `/lab/canvas/runtime?briefId=<id>`.

- [ ] Page loads with the current `canvas_states` snapshot for the brief.
- [ ] Triggering a fake Hermes job (existing PR32 affordance) produces a queued proposal that appears in the queue UI.
- [ ] Triggering a fake Hermes job that meets auto-apply policy applies immediately; canvas updates after the SSE event.
- [ ] Approving a queued proposal moves it to `applied`; canvas updates after SSE; `brief_events` shows the change.
- [ ] Rejecting a queued proposal with a reason moves it to `rejected`; canvas unchanged; `brief_events` does **not** get a row.
- [ ] Undo within 30s reverts; event strip shows `canvas_proposal.undone`.
- [ ] Posting a malformed envelope to `/api/briefs/[id]/canvas-proposals` (with valid token) returns 400 + `error_code: "schema_invalid"`; the event strip shows a `canvas_proposal.rejected` event; the proposal queue is **unchanged**.
- [ ] Posting a non-fake envelope while `HERMES_RUNTIME_FAKE=1` returns 400 + `fake_marker_missing`.
- [ ] Posting twice with the same `request_id` is idempotent (returns the same proposal id).
- [ ] Rate limit triggers `rate_limited` on the configured threshold.
- [ ] Reload the page; queue + canvas + event strip reload from the server.
- [ ] Public share route (`/s/[token]/...`) is **unaffected**: open it as an unauthenticated viewer and confirm no proposals/events surface.
- [ ] Browser devtools console is clean.

### 6.4 Verification commands

```
npm run typecheck
npm run build
npx tsx --test tests/canvas.*.test.ts tests/canvas.gateway.*.test.ts
```

---

## 7. Acceptance criteria

Done when all hold:

1. **Adapter forwarding works.** With `HERMES_RUNTIME_ENABLED=1 HERMES_RUNTIME_FAKE=1 HERMES_CANVAS_PROPOSALS_ENABLED=1`, fake Hermes jobs produce typed proposals that land in `canvas_action_proposals` and emit `hermes_job_events`.
2. **Invariant holds.** Every gateway decision — including all pre-proposal rejections — emits exactly one `hermes_job_events` row. Raw envelope payloads are never persisted.
3. **PR32 surfaces are unchanged.** `/api/briefs/[id]/canvas-state` and `/api/briefs/[id]/hermes-events{,/stream}` are not modified.
4. **Production dormancy preserved.** With all flags off (production default), `git diff origin/main..HEAD` shows no observable behavior change for production routes. Production chat, research, share, auth flows are bit-for-bit unchanged.
5. **Auth model honored.** Read needs `canReadBrief`; mutate needs `canWriteBrief`. No share-token reaches the proposal routes.
6. **Migration is 014.** No collision with `012_brief_events` or `013_hermes_runtime_events_and_canvas_state`.
7. **No new wire types invented.** Gateway consumes existing PR32 wire types and projects to the existing lab `HermesAction`.
8. **No `CANVAS_RUNTIME_*` envs.** Only `HERMES_RUNTIME_*` from PR32 plus the single new `HERMES_CANVAS_PROPOSALS_ENABLED`.
9. **Browser QA passes** §6.3, console clean.
10. **All tests pass** §6.4.

---

## 8. Key tradeoffs (updated)

| Decision | Picked | Tradeoff |
|---|---|---|
| App-side gateway (B) vs. sidecar endpoint (A) | **B** | Keeps proposal lifecycle/auth/audit next to the brief model. Sidecar stays a model adapter. Reverting is cheap. |
| Reuse `hermes_job_events` vs. new `canvas_audit_events` table | **Reuse** | PR32 already serializes the event stream. Single audit pipeline. We accept that `hermes_job_events.event_type` becomes the canonical canvas-proposal event vocab. |
| Reuse `canvas_states` (PR32) | **Reuse** | Already exists with the right shape; matches PR32's source-of-truth choice. |
| Reuse existing wire types vs. new RuntimeRequest/Response | **Reuse** | The prior plan invented `RuntimeRequest`/`RuntimeResponse` for no clear reason. Retracted. |
| Reuse `HERMES_RUNTIME_*` flags | **Reuse** | Single source of truth for Hermes gating. No `CANVAS_RUNTIME_*` parallel namespace. |
| Add only `HERMES_CANVAS_PROPOSALS_ENABLED` | **Yes** | Separates "proposal lifecycle on/off" from "Hermes on/off" — needed because the latter is a coarser gate. |
| Reuse PR32 SSE vs. new polling | **SSE** | One source of truth for live updates. |
| Per-proposal snapshot for undo | **Yes** | Cheap in lab. Compress later if needed. |
| brief_id (not account_id) | **brief_id** | Matches `canvas_states` PK and the existing auth helpers (`canReadBrief` / `canWriteBrief`). |
| Roles via existing `brief_shares.role` | **Yes** | reader/editor mapping is in place. |
| Reuse PR32 sidecar transport | **Yes** | `HERMES_RUNTIME_URL` + `HERMES_SERVICE_TOKEN` + `HERMES_RUNTIME_BIND_HOST=127.0.0.1` is the only transport. |

---

## 9. Open questions / blockers

These need answers from someone with production-repo access before §3/§4 implementation begins. I cannot resolve them from this session.

1. **`HermesCanvasSynthesisResponse` shape.** Does PR32 already define a typed list of canvas operations on this response? If yes, what kinds (do they cover all six existing `HermesActionKind`s, or a subset)? If no, the gateway needs a projection from a less-typed shape — that's a real design change in `web/lib/hermes/types.ts`, not just glue.
2. **`hermes_job_events.event_type`.** Is it a free TEXT column or constrained (CHECK / enum / app-side allowlist)? If constrained, migration `014` must extend it.
3. **`canvas_states.source` allowed values.** PR32 defined this column; what string values is it expected to take? The plan assumes free-form strings (`"hermes_proposal_auto"`, `"hermes_proposal_applied"`). If it's an enum, the migration adds entries.
4. **`canvas_states.updated_by_job_id` FK.** Does this reference `hermes_jobs(id)` strictly? When a proposal is human-approved without a backing job (e.g. a user-originated UI mutation later), what goes here? Plan assumes it can be NULL.
5. **`brief_shares` role names.** I assumed `viewer`/`reader` for read, `editor` for write — the actual role enum needs confirming. The existing `canReadBrief` / `canWriteBrief` helpers encapsulate this; using them avoids hardcoding role strings.
6. **Idempotency window for `request_id`.** No expiration in lab. Re-evaluate before any production wiring.
7. **Rate-limit budget.** 10/60s default is a guess. Calibrate after the first fake-Hermes burst.
8. **TTL / GC for proposals + events.** Not in this milestone. Suggested 30-day sweep as a lab follow-up; production is dormant so no GC pressure.
9. **The two demo routes.** Existing `/lab/canvas` (localStorage) stays; new `/lab/canvas/runtime` is server-backed. Confirm that's the desired final shape.
10. **PR32 file paths** — every `[per brief]` claim in §1 must be spot-checked against the production repo by the implementer. If any path diverged after the brief was written, the plan needs a follow-up patch.

---

## 10. Things deliberately NOT in this milestone

- **No new wire types.** PR32's existing `HermesChatResponse` / `HermesCanvasSynthesisResponse` are the wire.
- **No new audit table.** `hermes_job_events` is the audit.
- **No `CANVAS_RUNTIME_*` envs.** Only PR32 envs plus one new fine-grained gate.
- **No sidecar endpoint changes.** The sidecar is unchanged.
- **No production behavior change.** With flags off (production default), production routes are bit-for-bit identical.
- **No public-share exposure.** `/s/[token]/*` is untouched.
- **No live model calls.** `HERMES_RUNTIME_FAKE=1` is required in lab.
- **No deploy.**
