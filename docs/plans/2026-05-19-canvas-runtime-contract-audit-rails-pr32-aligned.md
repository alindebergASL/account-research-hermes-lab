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

### 2.3 Wire shapes — required PR32 extension (corrected per Hermes review)

PR32 today defines:

```ts
// web/lib/hermes/types.ts (production main, verified)
export type HermesCanvasSynthesisResponse = {
  canvas: Canvas;
  extensions?: BriefExtension[];
  events?: HermesRuntimeEventInput[];
};

export type HermesChatResponse = {
  reply: string;
  patches_applied: BriefPatch[];
  patch_errors: string[];
  brief?: Brief;
  canvas?: Canvas;
  events?: HermesRuntimeEventInput[];
};
```

Neither response carries typed canvas operations. The gateway therefore cannot project today's PR32 responses into `HermesAction[]` without a wire change.

**Decision:** extend both PR32 response shapes with an **optional** `canvas_actions?: HermesAction[]` field. **Do not** create a parallel `RuntimeRequest` / `RuntimeResponse` shape.

```ts
// web/lib/hermes/types.ts (proposed extension, additive)
export type HermesCanvasSynthesisResponse = {
  canvas: Canvas;                         // legacy / full-state synthesis path
  canvas_actions?: HermesAction[];        // NEW — typed operations, preferred when present
  extensions?: BriefExtension[];
  events?: HermesRuntimeEventInput[];
};

export type HermesChatResponse = {
  reply: string;
  patches_applied: BriefPatch[];
  patch_errors: string[];
  brief?: Brief;
  canvas?: Canvas;                        // legacy / full-state synthesis path
  canvas_actions?: HermesAction[];        // NEW — typed operations, preferred when present
  events?: HermesRuntimeEventInput[];
};
```

Behavioral rules for the gateway:

- If `canvas_actions` is present and non-empty → run each through the proposal lifecycle (§2.6). This is the path this plan is designed for.
- If `canvas_actions` is absent or empty but `canvas` (full state) is present → preserve PR32's existing legacy/full-state behavior: `saveCanvasState()` server-side with `source: "hermes"`, no proposal rows, no lifecycle. This keeps PR32 dormant deployments byte-identical.
- The two paths are mutually exclusive per response; if both are present the gateway treats `canvas_actions` as authoritative and logs a `hermes_job_events` row (`event_type: "canvas_proposal.rejected"`, `payload: { error_code: "ambiguous_response_both_canvas_and_actions" }`) but still uses `canvas_actions`.

**`HermesAction` is the existing lab schema** at `web/lib/canvas/actions.ts` on `hermes-lab/dynamic-canvas`. Promoting it from lab into production via `lib/canvas/contract.ts` (see the promotion contract doc) is a prerequisite of this milestone.

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
                                              (kind="canvas_proposal.rejected",
                                               payload={ error_code: "schema_invalid",
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
- Gateway returns an error to the caller (a thrown `GatewayError` for in-process adapter calls; if the gateway is ever surfaced as an HTTP route, this maps to HTTP 400 — but per §4.1 it is not an HTTP route in this milestone).
- **No** `canvas_action_proposals` row written.
- **One** `hermes_job_events` row appended via the existing PR32 helper:
  - `kind = "canvas_proposal.rejected"` (must be added to the `HermesEventKind` union — see §2.8.1)
  - `payload = { error_code: "schema_invalid", request_id?: string, source: "chatAdapter"|"canvasSynthesis", validation_path: string }`
  - Persisted in column `payload_json`. Raw envelope body **never** stored. We persist only the Zod error path (e.g. `"canvas_actions.0.payload.widget.title"`), not the offending value.
- UI: the rejected request appears in the existing `/hermes-events/stream` SSE feed (it's a real `hermes_job_events` row); it does **not** appear in the proposal queue UI (no proposals row).
- Rationale: the lab operator can see the request happened, classify it, and triage; the proposal queue stays clean of garbage.

Other error codes (`version_stale`, `policy_denied`, `rate_limited`, `fake_marker_missing`, `timeout`):
- Same pattern: error thrown to caller, **one** `hermes_job_events` row appended (with the corresponding `kind`), **no** `canvas_action_proposals` row, raw envelope not persisted (only field paths / error codes / counts in `payload`).
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

### 2.8.1 `HermesEventKind` extension (required)

Per Hermes review: although the SQLite column `event_type` is free TEXT, the TypeScript helper that appends events takes `kind: HermesEventKind`. Today `HermesEventKind` does **not** include any `canvas_proposal.*` variants. The plan therefore requires extending `HermesEventKind` in `web/lib/hermes/types.ts` (or wherever PR32 defines it) with the following exact literals:

```ts
// proposed addition to HermesEventKind
| "canvas_proposal.queued"
| "canvas_proposal.auto_applied"
| "canvas_proposal.applied"
| "canvas_proposal.failed"
| "canvas_proposal.rejected"           // pre-proposal rejection (schema/policy/version/rate/timeout)
| "canvas_proposal.rejected_by_user"
| "canvas_proposal.undone"
| "canvas_proposal.retried"
| "canvas_proposal.timeout"
```

The DB column is unchanged (`event_type TEXT`); only the type union and any local exhaustiveness switches need updating. This is a typing-only extension and ships in the same PR as the gateway. No migration is required to add these kinds because the column accepts arbitrary strings.

### 2.8.2 Event row shape (PR32-correct naming)

Per Hermes review: the existing PR32 helper writes to **`payload_json`** (column) via a typed `payload` parameter — not `metadata`. All references in this plan use `payload`. A `canvas_proposal.queued` row, for example, looks like:

```ts
appendHermesJobEvent({
  job_id,
  brief_id,
  kind: "canvas_proposal.queued",
  payload: {
    proposal_id: "ulid...",
    action_kind: "append_widget",
    proposed_by: "hermes",
    confidence: "Medium",
    request_id: "ulid...",
  },
});
```

The gateway never puts the raw `canvas_actions[i].payload` into `payload`; it only puts identifiers, action kinds, counts, and error codes — enough to audit, never enough to leak the offending value.

### 2.9 Authorization model (real, brief-scoped)

Replacing all `account_id` language from the prior plan. Per Hermes review, the production app has **two distinct role enums** and they must not be conflated:

- **User roles** (global, on the user record): `admin` / `member` / `viewer`.
- **Share roles** (per-brief, on `brief_shares.role`): `reader` / `editor`.

The gateway never inspects either enum directly. All authorization goes through the existing `requireUser`, `canReadBrief(briefId)`, and `canWriteBrief(briefId)` helpers (`web/lib/auth.ts`) — the same helpers PR32's `/canvas-state` route already uses. Those helpers internally encapsulate the user-role × share-role logic; the gateway code stays unaware of role-string literals.

| Operation | Required |
|---|---|
| `GET /api/briefs/[id]/canvas-proposals` | `requireUser` + `canReadBrief(briefId)` |
| `POST /api/briefs/[id]/canvas-proposals/[pid]/approve` | `requireUser` + `canWriteBrief(briefId)` |
| `POST /api/briefs/[id]/canvas-proposals/[pid]/reject` | `requireUser` + `canWriteBrief(briefId)` |
| `POST /api/briefs/[id]/canvas-proposals/[pid]/retry` | `requireUser` + `canWriteBrief(briefId)` |
| `POST /api/briefs/[id]/canvas-proposals/[pid]/undo` | `requireUser` + `canWriteBrief(briefId)` |

(There is **no** internal HTTP POST for proposal ingestion — see §4.1 for the corrected design.)

Public share routes (`/s/[token]/...`) are not touched; the proposal queue is never exposed to share viewers. Share-grant `reader` does not get approve/reject (only `canWriteBrief` does, which is share-grant `editor` or user-role `admin`/`member`-on-own-brief, depending on what the existing helpers compute).

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

### 3.3 `canvas_states` interaction (corrected per Hermes review)
- Reads: gateway reads `(version, canvas_json)` from the existing `canvas_states` row by `brief_id` to enforce optimistic concurrency.
- Writes: gateway calls the existing `saveCanvasState()` helper (do **not** add a new PUT route — see §4.1). The helper accepts `jobId?: string | null`, so `updated_by_job_id` is set when the proposal came from a Hermes job and left NULL otherwise.
- **`source` stays inside PR32's existing constrained set** (`"deterministic" | "hermes" | "fake"` per Hermes review). The gateway always writes `source: "hermes"` for proposal-driven applies. **Do not** invent `"hermes_proposal_auto"` / `"hermes_proposal_applied"` strings.
- Provenance discrimination (auto vs. human-approved, proposal id, request id) lives in the matching `hermes_job_events.payload`, not in `canvas_states.source`.
- The gateway **never** writes `canvas_states` for non-applied proposals.

### 3.4 `hermes_job_events` interaction (corrected per Hermes review)

The SQLite column `event_type` is **free TEXT** (no CHECK / no migration needed). The constraint lives in TypeScript: the helper takes `kind: HermesEventKind`. Per §2.8.1, we extend the `HermesEventKind` union with these literals:

- `canvas_proposal.queued` — proposal accepted, awaiting approval.
- `canvas_proposal.auto_applied` — proposal applied without human approval.
- `canvas_proposal.applied` — proposal applied after human approval.
- `canvas_proposal.failed` — proposal valid but reducer rejected it (post-validation apply failure).
- `canvas_proposal.rejected` — pre-proposal rejection (schema_invalid, version_stale, policy_denied, rate_limited, fake_marker_missing, ambiguous_response_both_canvas_and_actions). `payload.error_code` discriminates.
- `canvas_proposal.rejected_by_user` — human reject.
- `canvas_proposal.undone` — human undo.
- `canvas_proposal.retried` — human retry created a new proposal.
- `canvas_proposal.timeout` — sidecar/apply timeout.

Each row is appended through PR32's existing event helper. The helper's `payload` argument is serialized to the `payload_json` column. The gateway only puts identifiers, action kinds, counts, and error codes into `payload` — never raw envelope content.

### 3.5 `brief_events` interaction
One row appended per **applied** canvas change (auto-applied or post-approve applied). Not per proposal. Keeps the human-readable brief timeline clean.

### 3.6 Rollback / snapshot strategy
Per-proposal snapshot (`canvas_before_json` + `canvas_after_json`) for undo. Simple, fits lab volumes. No compression. If lab volume becomes a problem, gzip is a one-line follow-up.

### 3.7 Migration id
`014_canvas_action_proposals` — explicit retraction of the prior plan's `012` claim. The migration is forward-only in production but the rows it creates are dormant unless `HERMES_RUNTIME_ENABLED=1`.

---

## 4. API / server plan

### 4.1 Routes to add (lab-only, all under existing brief auth) (corrected per Hermes review)

**There is no internal POST route for proposal ingestion.** Per Hermes review the previous design (POST `/api/briefs/[id]/canvas-proposals` authenticated by `HERMES_SERVICE_TOKEN`) is the app calling itself over HTTP for no reason. Adapters live in the same Next.js process and call the gateway module directly.

Gateway module to add:

```
web/lib/hermes/canvasProposalGateway.ts
```

Exported entry points (in-process function calls, not HTTP):

- `ingestCanvasActions(ctx, response)` — called by `chatAdapter.ts` and `researchAdapter.ts` after a Hermes runtime response is received. Reads `response.canvas_actions ?? []`, runs the decision tree from §2.6, persists proposals/audit, and (for auto-apply) calls `saveCanvasState()`.
- `approveProposal(ctx, proposalId)` — invoked by the approve route handler.
- `rejectProposal(ctx, proposalId, reason)` — invoked by the reject route handler.
- `retryProposal(ctx, proposalId)` — invoked by the retry route handler.
- `undoProposal(ctx, proposalId)` — invoked by the undo route handler.
- `listProposals(ctx, briefId, filter)` — invoked by the GET route handler.

The browser-facing routes are the only HTTP surface this milestone adds:

| Path | Verb | Purpose |
|---|---|---|
| `GET /api/briefs/[id]/canvas-proposals` | GET | List proposals for a brief, filterable by status. |
| `POST /api/briefs/[id]/canvas-proposals/[pid]/approve` | POST | Approve a queued proposal. |
| `POST /api/briefs/[id]/canvas-proposals/[pid]/reject` | POST | Body `{ reason }`. |
| `POST /api/briefs/[id]/canvas-proposals/[pid]/retry` | POST | Re-emit a failed proposal as a new queued proposal. |
| `POST /api/briefs/[id]/canvas-proposals/[pid]/undo` | POST | Undo an auto-applied or applied proposal. |

All five routes:
- Return 404 unless `HERMES_RUNTIME_ENABLED=1` AND `HERMES_CANVAS_PROPOSALS_ENABLED=1`.
- Use `requireUser` + `canReadBrief` / `canWriteBrief` from `web/lib/auth.ts`.
- Never accept share-token auth. Never available on `/s/[token]/...`.
- Reject cross-brief writes by route shape.
- Are thin wrappers — each handler validates auth, parses params, calls the matching `canvasProposalGateway` function, returns the result. No business logic in the route file.

`HERMES_SERVICE_TOKEN` continues to authenticate the **sidecar↔app** HTTP boundary that PR32 already owns. It is **not** used by the gateway because the gateway is in-process.

### 4.2 Routes NOT modified
- `/api/briefs/[id]/canvas-state` (PR32) — **stays GET-only**, unchanged. The gateway writes canvas state by calling the existing `saveCanvasState()` helper server-side. No new PUT/POST is added to this route. UI continues to read it.
- `/api/briefs/[id]/hermes-events` (PR32) — unchanged. New `canvas_proposal.*` kinds flow through it automatically (free-TEXT column; typing extension is application-level).
- `/api/briefs/[id]/hermes-events/stream` (PR32) — unchanged.
- `/api/briefs/[id]/chat` (prod) — unchanged. The gateway only fires from inside `chatAdapter.ts` / `researchAdapter.ts`, which are already dormant behind `HERMES_RUNTIME_ENABLED`.
- `/api/share/*`, `/s/[token]/*` — public share, untouched.
- `/api/research`, `/api/research-jobs/*` — untouched.

### 4.3 Adapter changes (small, gated)
- `web/lib/hermes/chatAdapter.ts` — when `response.canvas_actions?.length` is non-zero, call `ingestCanvasActions(ctx, response)` from the gateway module **directly**, in-process. When `canvas_actions` is empty/absent but `canvas` (full-state) is present, preserve PR32's existing behavior (legacy `saveCanvasState()` path with `source: "hermes"`). Guarded by `HERMES_RUNTIME_ENABLED && HERMES_CANVAS_PROPOSALS_ENABLED`.
- `web/lib/hermes/researchAdapter.ts` — same forwarding rule for `HermesCanvasSynthesisResponse`.

No HTTP call between the adapter and the gateway. No service token check on this path (PR32's `HERMES_SERVICE_TOKEN` only authenticates the sidecar↔app boundary).

These are the **only** places adapter behavior changes. If `HERMES_CANVAS_PROPOSALS_ENABLED=0` (production default), the adapters behave exactly as PR32 shipped them and the `canvas_actions` field is treated as if absent.

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
| `tests/canvas.gateway.contract.test.ts` | Extraction of `canvas_actions` from `HermesCanvasSynthesisResponse` and `HermesChatResponse`. Zod round-trip. Rejects unknown action kinds. Confirms legacy `canvas`-only responses do not trigger the proposal path. |
| `tests/canvas.gateway.allowlist.test.ts` | Every `(proposed_by, action.kind)` pair table-driven. Asserts `policy_denied` for disallowed combos. |
| `tests/canvas.gateway.policy.test.ts` | `propose_refresh` is never auto-apply. Confidence floor enforced. Evidence floor enforced. |
| `tests/canvas.gateway.errors.test.ts` | **Each pre-proposal rejection writes exactly one `hermes_job_events` row (with the matching `kind` literal) and zero `canvas_action_proposals` rows.** `payload.error_code` is set. Raw envelope body never appears in `payload_json`. |
| `tests/canvas.gateway.event_kinds.test.ts` | All `canvas_proposal.*` literals are members of `HermesEventKind`. Compile-time exhaustiveness check via a `switch` over each kind. |

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
Run with `HERMES_RUNTIME_ENABLED=1 HERMES_RUNTIME_FAKE=1 HERMES_CANVAS_PROPOSALS_ENABLED=1 npm run dev`. Open `/lab/canvas/runtime?briefId=<id>`. Since there is no internal POST route (§4.1), the "malformed envelope" cases are driven by fake-Hermes responses constructed in tests/dev fixtures, not by `curl`.

- [ ] Page loads with the current `canvas_states` snapshot for the brief.
- [ ] Triggering a fake Hermes job that returns `canvas_actions` for non-auto-apply kinds produces a queued proposal that appears in the queue UI.
- [ ] Triggering a fake Hermes job that returns `canvas_actions` meeting auto-apply policy applies immediately; canvas updates after the SSE event.
- [ ] Triggering a fake Hermes job that returns **only** `canvas` (full-state, no `canvas_actions`) preserves PR32's legacy behavior: `canvas_states` updated with `source: "hermes"`, no proposal row, no `canvas_proposal.*` events.
- [ ] Approving a queued proposal moves it to `applied`; canvas updates after SSE; `brief_events` shows the change.
- [ ] Rejecting a queued proposal with a reason moves it to `rejected`; canvas unchanged; `brief_events` does **not** get a row.
- [ ] Undo within 30s reverts; event strip shows `canvas_proposal.undone`.
- [ ] A fake-Hermes response carrying a malformed `canvas_actions[i]` (e.g. missing required field) yields a thrown error to the adapter, no proposal row, and exactly one `canvas_proposal.rejected` event with `payload.error_code = "schema_invalid"` visible in the event strip.
- [ ] A fake-Hermes response containing both `canvas` and `canvas_actions` records one `canvas_proposal.rejected` audit event with `payload.error_code = "ambiguous_response_both_canvas_and_actions"` and still proceeds using `canvas_actions`.
- [ ] Posting twice through the adapter with the same `request_id` is idempotent (returns the same proposal id).
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
| Reuse existing wire types vs. new RuntimeRequest/Response | **Reuse + additive extension** | PR32's existing `HermesCanvasSynthesisResponse` / `HermesChatResponse` are kept; we add an optional `canvas_actions?: HermesAction[]`. The prior `RuntimeRequest`/`RuntimeResponse` design is retracted. |
| Internal HTTP `POST /canvas-proposals` vs. in-process gateway module | **In-process module** | App-calls-itself HTTP added latency, auth complexity, and a service-token check on a same-process call. Adapters now call `canvasProposalGateway.ts` directly. |
| Write `canvas_states` via new PUT route vs. existing `saveCanvasState()` helper | **Helper** | `canvas-state` route stays GET-only per PR32. Gateway writes through the existing helper, keeping write authority in one place. |
| New `canvas_states.source` values vs. reuse the existing enum | **Reuse `"hermes"`** | Provenance discrimination lives in `hermes_job_events.payload`, not in `source`. Avoids drifting PR32's three-value enum. |
| Free-string `event_type` vs. typed `HermesEventKind` extension | **Typed extension** | SQLite accepts free strings but the helper requires a `HermesEventKind` value. Plan extends the union once; no migration needed. |
| Reuse `HERMES_RUNTIME_*` flags | **Reuse** | Single source of truth for Hermes gating. No `CANVAS_RUNTIME_*` parallel namespace. |
| Add only `HERMES_CANVAS_PROPOSALS_ENABLED` | **Yes** | Separates "proposal lifecycle on/off" from "Hermes on/off" — needed because the latter is a coarser gate. |
| Reuse PR32 SSE vs. new polling | **SSE** | One source of truth for live updates. |
| Per-proposal snapshot for undo | **Yes** | Cheap in lab. Compress later if needed. |
| brief_id (not account_id) | **brief_id** | Matches `canvas_states` PK and the existing auth helpers (`canReadBrief` / `canWriteBrief`). |
| Roles via existing `brief_shares.role` | **Yes** | reader/editor mapping is in place. |
| Reuse PR32 sidecar transport | **Yes** | `HERMES_RUNTIME_URL` + `HERMES_SERVICE_TOKEN` + `HERMES_RUNTIME_BIND_HOST=127.0.0.1` is the only transport. |

---

## 9. Open questions / blockers

Resolved by Hermes review (now part of the plan above):

- ~~Q1 `HermesCanvasSynthesisResponse` shape~~ — verified: today's shape does **not** carry canvas operations. Plan now requires an additive `canvas_actions?: HermesAction[]` field on both response types (§2.3).
- ~~Q2 `hermes_job_events.event_type` constraint~~ — verified: column is free TEXT; constraint is in the TypeScript `HermesEventKind` union. Plan requires extending that union (§2.8.1, §3.4). No migration needed for this.
- ~~Q3 `canvas_states.source` allowed values~~ — verified: `"deterministic" | "hermes" | "fake"`. Plan uses `"hermes"` for proposal-driven applies; provenance discrimination lives in `hermes_job_events.payload` (§3.3).
- ~~Q4 `canvas_states.updated_by_job_id` nullability~~ — verified: `saveCanvasState()` accepts `jobId?: string | null`. Mark resolved (§3.3).
- ~~Q5 share role names~~ — verified: user roles are `admin`/`member`/`viewer`; share roles are `reader`/`editor`. Plan uses `canReadBrief` / `canWriteBrief` helpers throughout and avoids hardcoding role strings (§2.9).
- ~~Q10 PR32 file paths spot-check~~ — Hermes confirmed the paths in §1 against production main.

Still open:

1. **`HermesAction` promotion path.** Lab `web/lib/canvas/actions.ts` (on `hermes-lab/dynamic-canvas`) needs to land in production via `lib/canvas/contract.ts` before §4 implementation can begin; the gateway depends on `HermesAction` being a real production import. This is itself a small PR — not in this milestone.
2. **`canvas_actions` typing in `HermesAction`.** When promoted, lab `HermesAction.fixture_only` is a lab-only marker. Production wire `canvas_actions` should drop that field (or treat it as informational). Spec the production-side `HermesAction` precisely when promoting.
3. **Idempotency window for `request_id`.** No expiration in lab. Re-evaluate before any production wiring.
4. **Rate-limit budget.** 10/60s default is a guess. Calibrate after the first fake-Hermes burst.
5. **TTL / GC for proposals + events.** Not in this milestone. Suggested 30-day sweep as a lab follow-up; production is dormant so no GC pressure.
6. **Two demo routes.** Existing `/lab/canvas` (localStorage) stays; new `/lab/canvas/runtime` is server-backed. Confirm that's the desired final shape.
7. **"Ambiguous response" behavior.** §2.3 says when both `canvas` and `canvas_actions` are present, the gateway prefers `canvas_actions` and logs a `canvas_proposal.rejected` audit event. Confirm this is the desired triage signal rather than (a) preferring `canvas`, (b) hard-failing, or (c) silently using only `canvas_actions` without an audit.

---

## 10. Things deliberately NOT in this milestone

- **No new wire envelope types.** PR32's existing `HermesChatResponse` / `HermesCanvasSynthesisResponse` are the wire. The only wire change is an additive optional field (`canvas_actions?: HermesAction[]`) on each.
- **No new audit table.** `hermes_job_events` is the audit. `payload_json` is the carrier (not "metadata").
- **No `CANVAS_RUNTIME_*` envs.** Only PR32 envs plus one new fine-grained gate (`HERMES_CANVAS_PROPOSALS_ENABLED`).
- **No new write endpoint on `canvas-state`.** Existing GET-only route stays GET-only; writes go through the `saveCanvasState()` helper.
- **No internal app-calls-itself HTTP route.** Adapters call the gateway module in-process.
- **No sidecar endpoint changes.** The sidecar is unchanged.
- **No production behavior change.** With flags off (production default), production routes are bit-for-bit identical.
- **No public-share exposure.** `/s/[token]/*` is untouched.
- **No live model calls.** `HERMES_RUNTIME_FAKE=1` is required in lab.
- **No deploy.**
