# Canvas Runtime Contract + Audit Rails — Lab Implementation Plan

Status: **PLAN ONLY**. Lab-only. Do not deploy. Do not modify production code as part of executing this plan.
Date: 2026-05-15
Author: Track 2 lab agent
Base branch: `hermes-lab/dynamic-canvas` (current closest analogue of a "lab runtime baseline"; see §1.0)
Plan branch: `lab/canvas-runtime-contract-plan`

---

## 0. Framing note (read first)

The task brief describes a "fake Hermes runtime sidecar" path:
`chat → localhost runtime service → Hermes events → Canvas state persistence → Canvas render`.

**What is actually in the lab repo today** does not match that description exactly. There is no separate localhost runtime service in this repo and no PR32-equivalent branch named `runtime-sidecar`/similar (see §1.0). What does exist is `hermes-lab/dynamic-canvas`:

- An in-process deterministic composer (`web/lib/canvas/fakeHermes.ts`).
- A lifecycle FSM and pure reducer (`web/lib/canvas/{lifecycle,reducer}.ts`).
- A localStorage-backed lab store with audit events (`web/lib/canvas/store.ts`).
- A lab-only Canvas UI route under `web/app/lab/canvas/`.

If a separate "runtime sidecar" exists in a parallel workspace (e.g. a separate Account Research checkout), this plan still applies: the contract, schemas, and rails defined here are designed to wrap whatever fake-Hermes producer is in use (in-process **or** sidecar), and the only piece that changes is the transport boundary (in-process function call vs. HTTP).

I will flag every section where the in-process vs. sidecar choice matters. See §4.4 (transport) for the explicit decision point. Recommended: **start in-process, gate the sidecar transport behind a lab-only flag**.

---

## 1. Current repo inspection

### 1.0 Branches / remotes found

```
$ git fetch origin
$ git branch -a
* lab/canvas-relationship-priority-map
  hermes-lab/dynamic-canvas
  main
  remotes/origin/main
  remotes/origin/hermes-lab/dynamic-canvas
  remotes/origin/hermes-lab/dynamic-canvas-prototype
  remotes/origin/hermes-lab/dynamic-canvas-test
  remotes/origin/lab/canvas-relationship-priority-map
  remotes/origin/claude/account-research-track-2-eGP2f
```

No branch matches `runtime`, `sidecar`, or a PR32-equivalent name in the lab remote. The closest active lab baseline with a fake-Hermes producer + lifecycle FSM + audit events is `hermes-lab/dynamic-canvas` (head `ffd7445`). This plan is based against that branch.

### 1.1 Relevant runtime / chat / canvas files

Inspected on `origin/hermes-lab/dynamic-canvas` unless noted.

```
$ git ls-tree -r origin/hermes-lab/dynamic-canvas --name-only \
    | grep -E "runtime|sidecar|hermes|chat|canvas|migrat"
```

| Concern | Files | Notes |
|---|---|---|
| Fake Hermes producer | `web/lib/canvas/fakeHermes.ts` | Deterministic in-process composer. 6 canned prompts. Stamps `fixture_only: true` on every draft. |
| Lifecycle FSM | `web/lib/canvas/lifecycle.ts` | Pure FSM. States: `proposed`, `applying`, `auto_applied`, `applied`, `failed`, `rejected`, `undone`, `expired`. Events: `auto_apply_ok`, `auto_apply_fail`, `approve_start`, `approve_ok`, `approve_fail`, `reject`, `undo`, `retry`, `expire`. |
| Reducer | `web/lib/canvas/reducer.ts` | Pure `applyAction(canvas, action) → ApplyResult`. Dedupes append by `id` and `idem_key`. |
| Store | `web/lib/canvas/store.ts` | localStorage-backed `PersistedState`. Audit events emitted on auto/approve/reject/undo/fail/retry. Refuses drafts missing `fixture_only=true`. |
| Action schema | `web/lib/canvas/actions.ts` | Zod `HermesAction` + per-kind payloads + auto-apply policy. |
| Canvas schema | `web/lib/canvas/schema.ts` | Zod `Canvas`, `CanvasWidget` discriminated union over 5 kinds, plus `idem_key` for dedupe. |
| Promotion contract | `web/lib/canvas/contract.ts` | Re-exports the production-safe subset. |
| Lab UI | `web/components/canvas/{ActionQueue,CanvasView,HermesComposer,WidgetTile,tiles,details}.tsx` | All `"use client"`. |
| Chat route (prod) | `web/app/api/briefs/[id]/chat/route.ts` | 403 LOC. Uses Anthropic SDK directly + `update_brief` tool + `applyPatches` from `lib/briefPatches.ts`. **Mutates Brief**, not Canvas. No knowledge of Canvas state. |

### 1.2 Canvas persistence today

There is **no production-side Canvas persistence**. The lab persists `Canvas`, `HermesAction[]`, and `AuditEvent[]` in `window.localStorage` under three keys (`hermes_lab_canvas_v1`, `hermes_lab_actions_v2`, `hermes_lab_audit_v1`). Production brief storage is in SQLite (`web/lib/db.ts`) but it has no `canvas_*` tables.

### 1.3 Latest migration number (production)

```
$ git show origin/main:web/lib/db.ts | grep 'id: "0'
```

| # | id |
|---|---|
| 001 | users_must_change_password |
| 002 | users_disabled_at |
| 003 | users_password_changed_at |
| 004 | login_attempts_table |
| 005 | brief_shares_role |
| 006 | brief_shares_role_rename_viewer_to_reader |
| 007 | brief_share_links |
| 008 | research_jobs_and_email_prefs |
| 009 | brief_share_emails |
| 010 | brief_versions |
| 011 | research_jobs_refresh_intent |

**Next free migration id: `012_…`**. This plan reserves it for `canvas_action_proposals` (see §3) but **does not write the migration as part of the plan**.

### 1.4 Test setup

```
$ ls tests/
canvas.actions.test.ts  canvas.contract.test.ts  canvas.fakeHermes.test.ts
canvas.lifecycle.test.ts  canvas.schema.test.ts  canvas.store.test.ts
briefMerge.test.ts  schema.test.ts  sample_brief.json
```

- Framework: `node:test` + `tsx`. No Jest/Vitest.
- Invocation: `npx tsx --test tests/<file>.ts`.
- Existing canvas suite: 41 tests (schema, actions, store, lifecycle, fakeHermes, contract).

### 1.5 PM2 / lab assumptions

`ecosystem.config.js` defines two production processes: `account-brief` (Next.js web bound to 127.0.0.1:3000) and `account-brief-worker` (research worker). **Lab does not need PM2**; the runtime-contract work is dev-time only. If a sidecar transport is implemented behind the lab flag (§4.4), a third process named `canvas-runtime-lab` MAY be added to a *lab-only* PM2 file (`ecosystem.lab.config.js`) — never to the production ecosystem file.

### 1.6 Inspection commands actually run (for reproducibility)

```
git fetch origin
git branch -a
git log --oneline -5
git log origin/hermes-lab/dynamic-canvas --oneline -8
git log origin/main --oneline -5
git ls-tree -r origin/hermes-lab/dynamic-canvas --name-only | grep -E "runtime|sidecar|hermes|chat|canvas|migrat"
git ls-tree -r origin/main --name-only | grep -E "chat|migrat|db\.ts|research"
git show origin/main:web/lib/db.ts | grep -nE "MIGRATION|^const M|id: \"0"
git show origin/main:web/app/api/briefs/[id]/chat/route.ts | head -50
git show origin/main:ecosystem.config.js | head -40
git ls-tree origin/main tests/
```

---

## 2. Proposed architecture

### 2.1 One-paragraph picture

A **producer** (fake Hermes — in-process today, optionally HTTP sidecar behind a flag) emits **typed runtime requests** to a single **runtime gateway**. The gateway validates each request against a Zod schema, classifies it under the lifecycle FSM, and either (a) auto-applies it (safe additive, high-confidence, evidence present) or (b) writes a **proposal** to durable storage and surfaces it in the **proposal queue UI**. Approval/rejection moves the proposal through the FSM with an audit event on every transition. Canvas state is read after every applied change and re-rendered. **Nothing else can mutate Canvas state.**

```
┌──────────────────┐  RuntimeRequest   ┌────────────────────┐
│ fake Hermes      │ ─────────────────▶│  Runtime Gateway   │
│ (in-proc OR      │                   │  (server-side)     │
│  HTTP sidecar)   │ ◀───────────────  │                    │
└──────────────────┘  RuntimeResponse  │  - validate        │
                                       │  - classify        │
                                       │  - propose | apply │
                                       │  - audit           │
                                       └──────┬─────────────┘
                                              │ proposals
                                              ▼
                                       ┌─────────────────┐
                                       │ canvas_action_  │
                                       │ proposals (DB)  │
                                       └──────┬──────────┘
                                              │ approve/reject
                                              ▼
                                       ┌─────────────────┐
                                       │ Canvas reducer  │ (pure)
                                       │ + audit log     │
                                       └─────────────────┘
```

### 2.2 Runtime request schema

Wire shape between producer and gateway. Zod-validated at both ends.

```ts
// web/lib/canvas/runtime/contract.ts (new — to be implemented later)
RuntimeRequest = {
  request_id: string;          // ulid, unique per producer call
  proposed_by: "hermes" | "user" | "system";
  proposed_at: string;         // ISO
  fixture_only: boolean;       // MUST be true while feature flag CANVAS_RUNTIME_LIVE != "1"
  account_id: string;          // scopes the proposal
  canvas_version: number;      // optimistic-concurrency token; gateway rejects if stale
  action: HermesAction;        // reuses existing typed action schema
  evidence_summary?: string;   // free-text Hermes rationale (≤ 500 chars)
};
```

The `action` field is the existing `HermesAction` from `web/lib/canvas/actions.ts`. **No new action shape is invented.** This keeps PR32's dormant production code aligned with this lab path.

### 2.3 Runtime response schema

```ts
RuntimeResponse =
  | { ok: true; outcome: "auto_applied"; proposal_id: string; canvas_version_after: number; audit_event_id: string }
  | { ok: true; outcome: "queued"; proposal_id: string }
  | { ok: false; outcome: "rejected"; code: ErrorCode; reason: string; proposal_id?: string; audit_event_id: string };

ErrorCode = "schema_invalid" | "version_stale" | "policy_denied" | "rate_limited"
          | "timeout" | "internal" | "fixture_marker_missing" | "unknown_account";
```

### 2.4 Canvas operation schema

The reducer already accepts the typed `HermesAction`. **No new operation schema is invented**; the runtime contract is a wrapper around the existing action set:

- `append_widget`
- `update_widget`
- `remove_widget`
- `mark_status`
- `add_evidence`
- `propose_refresh`

### 2.5 Allowed action types (per-source allowlist)

| `proposed_by` | Allowed action kinds |
|---|---|
| `hermes` | all 6 |
| `user` | `append_widget`, `update_widget`, `remove_widget`, `mark_status`, `add_evidence` (no `propose_refresh` from UI — UI uses a separate explicit "Refresh" button that goes through the production research-jobs path) |
| `system` | `mark_status` (e.g. mark stale after TTL), `add_evidence` |

This allowlist is implemented in the gateway as a single table, not scattered through call sites. Any request whose `proposed_by`+`action.kind` is not in the table fails with `policy_denied`.

### 2.6 Error / timeout behavior

- **Schema invalid** → 400, `schema_invalid`, no DB write, no audit event (logged to stderr only). The gateway never crashes on a malformed request.
- **`fixture_only !== true` while `CANVAS_RUNTIME_LIVE !== "1"`** → 400, `fixture_marker_missing`. Audit event written ("attempted live action under fixture flag") so we can detect a misconfigured producer.
- **Stale `canvas_version`** → 409, `version_stale`. The producer must refetch `canvas_version` and resubmit. Audit event written.
- **Policy denied** (action kind not in allowlist for `proposed_by`) → 403, `policy_denied`. Audit event written.
- **Reducer rejects** (e.g. `idem_key` collision, target widget missing) → 422, the proposal is recorded with `state = failed` and `error` populated. Audit event "fail".
- **Producer timeout** (sidecar transport only) → producer aborts after **2.5s**, gateway aborts after **5s**. Either timeout creates a `timeout` proposal with `state = failed`. Audit event "timeout".
- **Rate limit** → in-memory token bucket per account, 10 proposals / 60s default. Excess → `rate_limited`. Audit event "rate_limited".

### 2.7 Event audit flow

Every state transition emits exactly one `AuditEvent`:

```ts
AuditEvent = {
  id: string;
  proposal_id: string;
  action_kind: HermesActionKind;
  decided_by: "system" | "user" | string;
  decision: "auto" | "approve" | "reject" | "undo" | "fail" | "retry" | "timeout" | "rate_limited";
  at: string;
  canvas_version_before: number;
  canvas_version_after: number;
  rationale: string;          // approver reason OR error text
  request_id?: string;        // joins back to the original RuntimeRequest
};
```

The lab store already emits a near-identical shape; this plan formalizes it and persists it to SQLite (see §3).

### 2.8 Proposal vs. direct-apply decision tree

```
RuntimeRequest arrives
  ├── schema invalid?            → reject (schema_invalid)
  ├── fixture marker missing?    → reject (fixture_marker_missing)
  ├── version stale?             → reject (version_stale)
  ├── allowlist denies?          → reject (policy_denied)
  ├── rate limited?              → reject (rate_limited)
  ├── isAutoApply(action) AND
  │    confidence >= "Medium" AND
  │    evidence.length >= 1 AND
  │    action.kind ∈ AUTO_APPLY_KINDS_BY_SOURCE[proposed_by]
  │                              → apply via reducer
  │                                  ├── reducer ok    → audit "auto",   outcome auto_applied
  │                                  └── reducer fail  → audit "fail",   outcome rejected (state=failed)
  └── else                       → store proposal, audit "queued", outcome queued
```

`AUTO_APPLY_KINDS_BY_SOURCE` is a second tightening over the existing `isAutoApply`. In particular: **`propose_refresh` is never auto-apply, regardless of source.**

---

## 3. Database / migration plan

**Lab-only**. The migration will be added to `web/lib/db.ts` (same migrations list as production), but will only run in lab DBs (lab-local sqlite file). Production main has no rows in this table and the UI gate keeps the proposal queue dark on prod.

### 3.1 New table

Migration `012_canvas_action_proposals`:

```sql
CREATE TABLE canvas_action_proposals (
  id                    TEXT PRIMARY KEY,           -- ulid
  request_id            TEXT NOT NULL,              -- from RuntimeRequest
  account_id            TEXT NOT NULL,
  proposed_by           TEXT NOT NULL,              -- "hermes" | "user" | "system"
  action_kind           TEXT NOT NULL,              -- one of HermesActionKind
  action_payload_json   TEXT NOT NULL,              -- HermesAction.payload, serialized
  rationale             TEXT NOT NULL DEFAULT "",
  evidence_json         TEXT NOT NULL DEFAULT "[]", -- Source[]
  confidence            TEXT NOT NULL,
  status                TEXT NOT NULL,              -- ActionState enum
  canvas_version_before INTEGER NOT NULL,
  canvas_version_after  INTEGER,                    -- null until applied
  canvas_before_json    TEXT,                       -- snapshot for undo (optional, see §3.3)
  canvas_after_json     TEXT,                       -- snapshot for undo (optional)
  error                 TEXT,                       -- non-null if status in (failed, timeout)
  retry_of              TEXT,                       -- proposal id this retries, if any
  fixture_only          INTEGER NOT NULL DEFAULT 1, -- 1 in lab; 0 only if CANVAS_RUNTIME_LIVE
  created_at            TEXT NOT NULL,
  decided_at            TEXT,
  decided_by            TEXT
);

CREATE INDEX idx_canvas_proposals_account_status ON canvas_action_proposals(account_id, status);
CREATE INDEX idx_canvas_proposals_request ON canvas_action_proposals(request_id);
```

And the companion audit table:

```sql
CREATE TABLE canvas_audit_events (
  id                    TEXT PRIMARY KEY,           -- ulid
  proposal_id           TEXT NOT NULL,
  request_id            TEXT,
  account_id            TEXT NOT NULL,
  action_kind           TEXT NOT NULL,
  decided_by            TEXT NOT NULL,
  decision              TEXT NOT NULL,              -- "auto"|"approve"|"reject"|"undo"|"fail"|"retry"|"timeout"|"rate_limited"
  canvas_version_before INTEGER NOT NULL,
  canvas_version_after  INTEGER NOT NULL,
  rationale             TEXT NOT NULL DEFAULT "",
  at                    TEXT NOT NULL
);

CREATE INDEX idx_canvas_audit_account_at ON canvas_audit_events(account_id, at);
CREATE INDEX idx_canvas_audit_proposal ON canvas_audit_events(proposal_id);
```

And the Canvas-state table:

```sql
CREATE TABLE canvas_states (
  account_id            TEXT PRIMARY KEY,
  version               INTEGER NOT NULL,
  canvas_json           TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
```

### 3.2 Field rationale

- `request_id` allows joining a proposal back to the producer's request log without exposing PII.
- `canvas_version_before / _after` is the optimistic-concurrency token and the audit pointer.
- `canvas_before_json` / `canvas_after_json` are **optional** snapshots (see §3.3 for the choice).
- `fixture_only` is a hard bit — the gateway refuses to write `fixture_only = 0` unless `CANVAS_RUNTIME_LIVE === "1"`.
- `retry_of` mirrors the existing in-memory `HermesAction.retry_of`.

### 3.3 Rollback / snapshot strategy

Two options:

| Option | Pros | Cons | Recommendation |
|---|---|---|---|
| (A) Per-proposal snapshot (`canvas_before_json` + `canvas_after_json`) | Trivial undo. Independent of canvas_states row. | DB grows with proposal count. | **Lab default.** Acceptable because lab volume is small. |
| (B) Version replay (no snapshot) | DB stays compact. | Undo requires replaying audit log. Brittle. | Defer. |

This plan picks **(A) for lab**. Production decision (later) can revisit. If size becomes a concern, snapshots can be compressed (gzip + base64) before storage; we will not implement compression in the first lab milestone.

### 3.4 Migration name / number

- `id: "012_canvas_action_proposals"` — creates all three tables in one transaction.
- File location: same as existing migrations (inline in `web/lib/db.ts` `MIGRATIONS` array).
- Reversibility: the lab dev script `scripts/lab-reset.sh` (new, **not implemented in this plan**) will `DROP TABLE` the three tables to reset. No SQL `down` is added to the migration system — production migrations are forward-only there.

---

## 4. API / server plan

### 4.1 Route handlers to add (lab-only)

| Path | Verb | Purpose |
|---|---|---|
| `/api/canvas/runtime/propose` | POST | Producer → gateway. Body: `RuntimeRequest`. Returns `RuntimeResponse`. |
| `/api/canvas/proposals` | GET | List proposals for an account, filterable by status. |
| `/api/canvas/proposals/[id]/approve` | POST | Approve a queued proposal. Auth: admin user. |
| `/api/canvas/proposals/[id]/reject` | POST | Reject a queued proposal. Body `{ reason }`. |
| `/api/canvas/proposals/[id]/retry` | POST | Retry a `failed` proposal. |
| `/api/canvas/proposals/[id]/undo` | POST | Undo an `auto_applied` or `applied` proposal (within window). |
| `/api/canvas/state` | GET | Read current canvas state for an account. |
| `/api/canvas/audit` | GET | Tail of `canvas_audit_events` for an account. |

All routes:
- Behind the existing `requireUser` + `requireAdmin` middleware.
- Refuse to operate if `CANVAS_RUNTIME_LAB !== "1"` (server env, default off).
- Refuse cross-account writes (`account_id` is locked to the authenticated user's allowed set).

### 4.2 Route handlers to NOT modify

Explicitly:
- `web/app/api/briefs/[id]/chat/route.ts` — production chat route. Leave alone. The lab runtime does **not** route through the production chat-then-tool flow.
- `web/app/api/research/route.ts`, `web/app/api/research-jobs/*` — research worker, untouched.
- `web/app/api/share/*` — public share routes, untouched.
- `web/app/api/auth/*` — auth, untouched.

### 4.3 Runtime client changes

`web/lib/canvas/runtime/client.ts` (new):

- Exports a single function `submit(request: RuntimeRequest): Promise<RuntimeResponse>`.
- Default transport: in-process call against the gateway handler (no HTTP).
- If `CANVAS_RUNTIME_TRANSPORT === "sidecar"` (lab-only env), transport is HTTP `POST` to `http://127.0.0.1:${CANVAS_RUNTIME_PORT}/propose`. **Never** bound to 0.0.0.0.
- All transports validate against the same Zod schemas at both ends.

### 4.4 Transport decision

| Transport | When | Default |
|---|---|---|
| In-process (function call) | Standard lab use; no separate process. | **Default.** |
| HTTP sidecar (`http://127.0.0.1:N`) | Only when we want to exercise the transport boundary, prove serialization, and feed a producer that lives in a different language/runtime. Gated by `CANVAS_RUNTIME_TRANSPORT=sidecar`. | Off. |

The sidecar process, if/when added later, lives in `scripts/lab-canvas-runtime.ts` and is started by hand (`tsx scripts/lab-canvas-runtime.ts`). It does not appear in the production PM2 ecosystem. If a lab PM2 file is added, it is `ecosystem.lab.config.js` (not the production file).

### 4.5 Service token behavior

If the sidecar transport is used:

- Sidecar requires a shared secret in `CANVAS_RUNTIME_SHARED_SECRET` (lab-only). Sent as `X-Canvas-Runtime-Token` header.
- Secret is a dev-time string committed to **`.env.lab.example`** only, never to `.env.local`.
- Token mismatch → 401, `policy_denied`, audit event written.
- In-process transport skips the token check entirely.

### 4.6 Lab-only feature flags

| Flag | Default | Purpose |
|---|---|---|
| `CANVAS_RUNTIME_LAB` | `"0"` | Master switch for all routes in §4.1. Off → 404 everywhere. |
| `CANVAS_RUNTIME_LIVE` | `"0"` | Allows `fixture_only = false` requests (i.e. real model output, if we ever wire one). Off → all requests must carry `fixture_only = true`. |
| `CANVAS_RUNTIME_TRANSPORT` | `"in-process"` | `"in-process"` or `"sidecar"`. |
| `CANVAS_RUNTIME_PORT` | `"4117"` | Sidecar port. Bound to 127.0.0.1 only. |
| `CANVAS_RUNTIME_SHARED_SECRET` | unset | Required iff transport=sidecar. |

All flags default to off / safe. Production deploys must continue to leave these unset.

### 4.7 Validation boundaries

Validation runs at three boundaries; **never trust a previous layer**:

1. **Producer-side** (`runtime/client.ts`) before send.
2. **Gateway** (`runtime/gateway.ts`) on receive, before any side effect.
3. **Reducer** (`reducer.ts`) on apply.

If any of the three reject, the whole request is rejected. The reducer already throws on schema mismatch via Zod; we keep that.

---

## 5. UI plan

**Minimal UI to verify the flow. No polish.**

### 5.1 New / modified UI pieces

| File | Status | Purpose |
|---|---|---|
| `web/app/lab/canvas/runtime/page.tsx` | new | Lab route showing live canvas + proposal queue + event strip. |
| `web/components/canvas/ProposalQueue.tsx` | new | Server-backed version of the existing in-memory ActionQueue. Reads from `/api/canvas/proposals` instead of localStorage. |
| `web/components/canvas/EventStrip.tsx` | new | Tail of `/api/canvas/audit`, last 50 events, with kind + decision + at. |
| `web/components/canvas/CanvasView.tsx` | modified | Accepts a `transport` prop (`"local-store" | "server-api"`); default unchanged. Server-API mode polls `/api/canvas/state` every 5s OR uses a tiny SSE endpoint. |
| `web/components/canvas/ActionQueue.tsx` | unchanged | Kept as-is for the localStorage demo. |

### 5.2 Event strip changes

The existing localStorage audit is replaced (in server-API mode) with the SQLite-backed audit. UI shape stays similar: list rows of `decision · kind · at · rationale-truncated`. New "request_id" column added; clicking it shows the `RuntimeRequest`/`RuntimeResponse` pair for debugging.

### 5.3 Canvas refresh behavior

- After any approve/reject/undo/retry call from the UI, the client invalidates its in-memory cache of `/api/canvas/state` and refetches.
- After an auto-applied proposal lands (server-side), the next poll/SSE tick brings the new state. There is no client-side optimistic apply in v1 — the goal is to make the server the source of truth, not to feel snappy.

### 5.4 Empty / error states

- No proposals: "No proposals yet. The producer can post to `/api/canvas/runtime/propose`."
- Server-API mode disabled (`CANVAS_RUNTIME_LAB=0`): page renders a banner "Lab runtime disabled. Set `CANVAS_RUNTIME_LAB=1` in `.env.local`." and nothing else.
- Token mismatch in sidecar mode: surface the audit event ("rate_limited" / "policy_denied") in the strip rather than failing silently.

### 5.5 Out of scope for UI polish

Explicitly **not** in this milestone: theming, animations beyond what already exists, drag-to-reorder, keyboard shortcuts beyond approve/reject hotkeys (already present), tooltips beyond the existing ones, exporting events.

---

## 6. Testing plan

### 6.1 Unit tests (Zod / pure functions)

New under `tests/`:

| File | Cases |
|---|---|
| `canvas.runtime.contract.test.ts` | RuntimeRequest/Response Zod round-trip, rejects unknown fields, rejects when `fixture_only` is false unless `CANVAS_RUNTIME_LIVE`. |
| `canvas.runtime.allowlist.test.ts` | Every `(proposed_by, action.kind)` pair — table-driven. Asserts `policy_denied` for disallowed combos. |
| `canvas.runtime.policy.test.ts` | `propose_refresh` is never auto-apply. Confidence floor enforced. Evidence length floor enforced. |
| `canvas.runtime.gateway.test.ts` | Decision tree of §2.8 with mocked reducer; asserts exactly one audit event per outcome. |

Keep all 41 existing canvas tests.

### 6.2 Integration tests (DB + gateway)

| File | Cases |
|---|---|
| `canvas.runtime.db.test.ts` | Spins a lab sqlite in `/tmp`, applies migration `012`, exercises propose → approve → audit → undo round-trip. Asserts row counts and FK-like invariants. |
| `canvas.runtime.versioning.test.ts` | Stale `canvas_version` → `version_stale`. Concurrent proposes against same canvas don't double-apply. |
| `canvas.runtime.retry.test.ts` | failed → retry creates new proposal with `retry_of` set; original is untouched. |
| `canvas.runtime.timeout.test.ts` | Sidecar transport with a hung mock server; producer aborts at 2.5s, gateway at 5s. |

Test DB lifecycle: each test creates a unique `briefs.test-${ulid}.sqlite`, runs migrations, and `unlink`s at end. Never touches `web/data/briefs.sqlite`.

### 6.3 Browser QA checklist

Run with `CANVAS_RUNTIME_LAB=1 npm run dev`. Open `/lab/canvas/runtime`.

- [ ] Page loads with 5 demo widgets.
- [ ] Composer button "Scan for metric" creates a proposal that auto-applies (toast: "auto applied"). Canvas dot count grows by 1 after the next poll.
- [ ] Composer button "Propose action panel" creates a queued proposal (visible in the queue, status `proposed`).
- [ ] Approving the queued proposal moves it to `applied`; Canvas reflects the change.
- [ ] Rejecting a queued proposal with a reason moves it to `rejected`; canvas unchanged.
- [ ] Undo within 30s reverts the canvas; the event strip shows `undo`.
- [ ] Submitting a malformed request via `curl -X POST /api/canvas/runtime/propose` (missing fields) returns 400 with `code: "schema_invalid"`; nothing appears in the proposal queue; an entry **does** appear in the audit strip as a `policy_denied`-style note.
- [ ] Submitting with `fixture_only: false` while `CANVAS_RUNTIME_LIVE=0` returns 400 with `code: "fixture_marker_missing"`.
- [ ] Submitting twice with the same `request_id` returns the same `proposal_id` (idempotency).
- [ ] Hitting the rate limit (11 rapid proposals) returns `rate_limited` on the 11th.
- [ ] Reload the page; queue + canvas + event strip all reload from server (not localStorage).
- [ ] Browser devtools console: **no errors, no warnings** during any of the above.

### 6.4 Verification commands (lab)

```
npm run typecheck
npm run build
npx tsx --test tests/canvas.schema.test.ts tests/canvas.actions.test.ts \
                tests/canvas.store.test.ts tests/canvas.lifecycle.test.ts \
                tests/canvas.fakeHermes.test.ts tests/canvas.contract.test.ts \
                tests/canvas.runtime.*.test.ts
```

All must pass before merging the lab branch.

---

## 7. Acceptance criteria

The implementation milestone is done when **all** of the following hold:

1. **Typed propose path works.** A fake typed Hermes (in-process composer) can `POST` to `/api/canvas/runtime/propose` and produce a typed `RuntimeResponse`, gated by `CANVAS_RUNTIME_LAB=1`.
2. **Invalid actions are rejected and audited.** Every reject path (schema, version, allowlist, policy, fixture marker, rate limit, timeout) returns the correct `ErrorCode`, writes an audit event, and never mutates Canvas state.
3. **Canvas state persists and reloads.** Canvas state lives in `canvas_states` (SQLite); reloading the lab page restores the latest state without touching localStorage.
4. **Event log explains what happened.** Every state transition has exactly one corresponding row in `canvas_audit_events`, joinable to the originating `request_id` and proposal.
5. **Production flags untouched.** `git diff origin/main..HEAD -- web/lib/db.ts web/middleware.ts web/app/api ecosystem.config.js` is reviewed; no production behavior is changed unless gated by `CANVAS_RUNTIME_LAB === "1"`. Production envs do not set this flag.
6. **No console errors in browser QA.** §6.3 checklist passes clean.
7. **All tests pass.** §6.4 command exits 0.
8. **No live model calls.** Producers used in tests are deterministic fixtures. Live transport (`CANVAS_RUNTIME_LIVE=1`) is exercised only manually, by the lab operator, and only against a deterministic fake — never against a paid API.

---

## 8. Key tradeoffs

| Decision | Picked | Tradeoff |
|---|---|---|
| Reuse `HermesAction` vs. new wire schema | Reuse | Keeps PR32 dormant code aligned. Costs a tiny bit of coupling between producer wire and reducer wire. |
| Per-proposal snapshot vs. version replay | Snapshot | Simpler undo + audit. Wastes a few KB per proposal in lab volumes. |
| In-process vs. HTTP sidecar default | In-process | Faster, fewer moving parts, no port to manage. We can still prove the contract over HTTP behind the flag. |
| SQLite (single shared DB) vs. separate lab DB | Same DB | Reuses existing migrations machinery + db helpers. Risk: a runaway lab test could collide with dev brief data. Mitigation: tests use temp DB files; the production schema is not affected because the new tables sit alongside. |
| Auto-apply policy lives in gateway vs. reducer | Gateway | Reducer stays pure (no policy). Gateway holds env-aware decisions. |
| Proposals are durable by default vs. ephemeral | Durable | Easier replay and debugging. If volume becomes an issue, add a TTL sweep. |
| New audit table vs. extend `brief_versions` | New table | `brief_versions` is brief-shaped; canvas is its own thing. Coupling them later is straightforward. |
| Polling vs. SSE | Polling (5s) for v1 | SSE costs more code; 5s lag is fine for lab. SSE can replace polling in a tiny follow-up. |
| Allowlist as table vs. switch/case | Table | One place to audit. Easier to test exhaustively. |

---

## 9. Open questions / blockers

1. **Does a separate "runtime sidecar" branch actually exist in another workspace?** I could not find one in `alindebergASL/account-research-hermes-lab`. If a different lab repo (e.g. a separate Account Research checkout) holds the sidecar, this plan still applies but the transport defaults flip: sidecar becomes the default, in-process becomes the flag.
2. **What is "PR32" referring to, exactly?** I have no access to the production repo from this session and could not inspect it. Assumption: PR32 added Canvas-related dormant code (schema/types/route stubs) consistent with the existing lab `HermesAction`. If PR32 introduced a different wire shape, §2.2/2.3 must change to match.
3. **Who is allowed to approve proposals?** Plan assumes admin role only. If lab needs non-admin approvers, the auth check at §4.1 needs softening (but this is dangerous — recommend not softening).
4. **TTL / GC for proposals + audit?** Not addressed in v1. Risk: lab DB grows unbounded over weeks. Suggested follow-up: a 30-day sweep job, lab-only.
5. **`canvas_states` per account or per (account, version)?** Plan picks per-account (one row; version field). Versioned history is reconstructed from `canvas_audit_events` + snapshots. If we want O(1) "show me v23," we need a per-version table. Defer.
6. **What happens to the existing localStorage lab demo at `/lab/canvas`?** Plan keeps it untouched as the "local store" demo. The new `/lab/canvas/runtime` route is the server-backed demo. Two routes for two transports.
7. **Rate-limit budget defaults.** 10/60s is a guess. Real number should come from observed fake-Hermes burst behavior; adjust after first integration.
8. **Idempotency window for `request_id`.** Plan assumes idempotency forever (request_id is unique). Should this expire? Recommend: no expiration in lab; production decision later.

---

## 10. Things deliberately NOT in this milestone

- **No live model calls.** The producer is a deterministic fake. Live transport is gated and unused in CI.
- **No production code edits.** `web/app/api/briefs/[id]/chat/route.ts` is untouched. Production middleware, ecosystem, share routes, research worker — untouched.
- **No new public-share surface.** Proposals and audit events are never reachable via `/s/[token]/...`.
- **No UI polish.** Server-backed demo route is functional but ugly; localStorage demo route is unchanged.
- **No PM2 changes.** A lab-only `ecosystem.lab.config.js` may appear when the sidecar transport is exercised, but it is not in this plan's scope.
- **No deploy.** Period.
