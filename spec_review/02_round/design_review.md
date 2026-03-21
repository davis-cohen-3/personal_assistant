# Design Docs Review — Implementation Readiness Assessment

**Date:** 2026-03-21
**Scope:** All 13 files in `project/design/`
**Method:** 5 parallel review agents (clarity, logic, feasibility, architecture, security)

---

## Verdict

**Almost ready. 2 remaining blockers to resolve, ~13 high-value items to address during implementation, ~30 lower-priority items to track.**

The design docs are exceptionally detailed — full code samples for every layer, clear module boundaries, custom linter setup, and consistent architectural decisions. The reviewers found ~50 issues total across 13 docs; the majority are doc inconsistencies or missing details, not design flaws.

---

## Blockers — Must Fix Before Implementing

### ~~BLOCKER-1: Pick V1 or V2 Agent SDK API~~ RESOLVED

**Decision:** V1 `query()` API. All V2 (`unstable_v2_*`) references removed from `02_agent_spec.md`. Session resume uses `{ resume: sessionId }` in query options. IMP-017 (verify resume throw behavior) still applies.

---

### ~~BLOCKER-2: Re-bucketing Has No Actor in the Direct UI Path~~ ✅ RESOLVED

**Sources:** LOGIC-001, LOGIC-003, ARCH-001

**Resolution:** Removed `markAllForRebucket()` from the REST `POST /api/buckets` route. Only the agent (via the `buckets create` tool) triggers rebucketing. The REST route returns `rebucket_required: true` so the frontend can prompt the user to ask the agent to re-sort their inbox. This keeps the agent as the single actor for thread classification and eliminates the code duplication.

---

### ~~BLOCKER-3: Agent Write Approval Is Prompt-Only~~ ACCEPTED

**Decision:** Prompt-only enforcement is acceptable for v1. This is a single-user personal tool; worst case is an unwanted email, which is reversible.

---

### ~~BLOCKER-4: Gmail OAuth Scope Missing Send Permission~~ ✅ RESOLVED

**Source:** FEAS-009

**Resolution:** Added `gmail.send` scope to the OAuth scope array in `04_backend.md` and corrected the scope table in `07_google_connectors.md` (removed "send" from `gmail.modify` description, added separate `gmail.send` row).

---

## High-Priority — Fix During Implementation

These won't block you from starting but will cause bugs or confusion if left unresolved.

### ~~HIGH-1: ConversationList Duplicate Hook Instance~~ ✅ RESOLVED

**Sources:** LOGIC-005, ARCH-004

**Resolution:** `ConversationList` now accepts `conversationsHook` as a prop from `App.tsx` instead of creating its own `useConversations()` instance. Single source of truth.

---

### ~~HIGH-2: Schema Import Missing `index`~~ RESOLVED

Added `index` to the Drizzle import in `03_data_layer.md`.

---

### ~~HIGH-3: `email.ts` Missing `getUnbucketedThreads()`~~ NOT AN ISSUE

Already defined at `04_backend.md:651` in the email.ts spec. The clarity reviewer missed it.

---

### HIGH-4: AppError Message Passthrough Leaks Internals

**Source:** SEC-001

`AppError.message` is passed directly into HTTP responses via `c.json({ error: err.message }, err.status)`. If any `AppError` includes internal details (DB IDs, SQL fragments, googleapis error strings), they reach the client.

**Fix:** Add a `userFacing: boolean` flag to `AppError`. Only expose `err.message` when `userFacing` is true; otherwise return a generic message and log details server-side.

---

### HIGH-5: GET Route Query Params Lack Zod Validation

**Sources:** SEC-008, SEC-009

POST bodies are well-validated with Zod, but GET query params (`?q=`, `?timeMin=`, `?timeMax=`, `?maxResults=`) are passed directly to Google APIs without validation.

**Fix:** Add Zod schemas for GET route query params. Validate `maxResults` as `z.number().int().min(1).max(100)`, `timeMin`/`timeMax` as `z.string().datetime()`, and enforce a max length on `q`.

---

### ~~HIGH-6: `maxResults` Cap Inconsistency~~ ✅ RESOLVED

**Source:** CLARITY-012

**Resolution:** Route table now says `?maxResults=25` (max 25, capped by BATCH_SIZE), matching `email.search()` behavior.

---

### HIGH-7: `getQueryParam(ws, 'conversationId')` Undefined

**Source:** CLARITY-011

The WebSocket handler calls `getQueryParam(ws, 'conversationId')` but this function is never defined. Hono's WebSocket upgrade doesn't expose a query parameter helper on the `ws` object.

**Fix:** Show the actual extraction mechanism (e.g., `const url = new URL(ws.url); const conversationId = url.searchParams.get('conversationId');`).

---

### HIGH-8: Route Registration Order for `/buckets/assign`

**Source:** CLARITY-013

`POST /api/buckets/assign` is registered after `PATCH /api/buckets/:id`. The dynamic `:id` segment could match "assign" depending on Hono's routing rules.

**Fix:** Register `POST /api/buckets/assign` before any `/:id` routes, or confirm Hono handles literal-before-dynamic automatically.

---

### HIGH-9: Separate `CSRF_SECRET` from `JWT_SECRET`

**Source:** SEC-005

`JWT_SECRET` does double duty: signs JWTs and generates CSRF tokens via HMAC. One leaked secret compromises both.

**Fix:** Use a separate `CSRF_SECRET` env var. Add it to the `REQUIRED_ENV` startup check.

---

### HIGH-10: Streaming May Not Be Token-by-Token

**Source:** FEAS-003

The SDK's `AssistantMessage` type emits full content blocks, not individual tokens. The `text_delta` WebSocket messages will deliver one large chunk at a time, not the smooth typing effect depicted in wireframes.

**Fix:** Verify whether the SDK emits multiple progressive `AssistantMessage` events during a single turn. If not, adjust frontend expectations or use the Anthropic API directly for token streaming.

---

### ~~HIGH-11: No Implementation Order Specified~~ NOT AN ISSUE

Already exists at `project/implementation_plan.md` — 9 phases, 25 tasks.

---

### ~~HIGH-12: Bucket Template Seed Data Missing~~ RESOLVED

Added full seed data for all 3 templates (Executive, Sales, Engineering) with 5 buckets each to `03_data_layer.md`.

---

### ~~HIGH-13: Test Auth Bypass Mechanism Unspecified~~ RESOLVED

**Sources:** CLARITY-023, SEC-010

Added `createApp({ skipAuth })` factory pattern to `10_dev_tooling.md` with code example. No `NODE_ENV` conditional.

The spec says tests should bypass auth middleware but doesn't specify how. Using `NODE_ENV=test` to conditionally disable auth creates a production risk if `NODE_ENV` is misconfigured.

**Fix:** Export a `createApp({ skipAuth: true })` factory for tests. Keep the production path unconditionally protected.

---

## Medium-Priority — Track and Address as Encountered

### Clarity Issues

| ID | Issue | Doc | Fix |
|---|---|---|---|
| CLARITY-002 | Model ID `"claude-opus-4-6"` needs verification against Anthropic API | 02, 04 | Verify exact model string |
| ~~CLARITY-004~~ | ~~Bucketing loop behavior when sync returns `{ new: 0 }` unspecified~~ | 02 | ✅ Added "always call `get_unbucketed` regardless of sync count" |
| ~~CLARITY-005~~ | ~~`clearRebucketFlag` caller in re-bucket skill unspecified~~ | 02 | ✅ Clarified: `buckets assign` clears flag implicitly |
| ~~CLARITY-007~~ | ~~`createChatMessage` dual-statement requirement non-obvious~~ | 03 | ✅ Added implementation note: INSERT + UPDATE in transaction |
| ~~CLARITY-008~~ | ~~`applyBucketTemplate` behavior when buckets exist undefined~~ | 03 | ✅ Throws AppError(409) if buckets exist — first-launch only |
| CLARITY-009 | Migration naming collision with Drizzle auto-numbering | 03 | Embed trigger in initial migration or use journal |
| CLARITY-010 | Which SDK message type carries `session_id` unclear | 04 | Inline the relevant message shape |
| CLARITY-014 | WebSocket CSRF — `sameSite: Strict` sufficiency unverified | 04 | Add `Origin` header validation or confirm sufficiency |
| ~~CLARITY-015~~ | ~~Concurrent send while streaming not addressed~~ | 05 | ✅ Input and Send button disabled while `loading` is true |
| ~~CLARITY-016~~ | ~~ConversationList Props interface inconsistent with App.tsx~~ | 05 | ✅ Props now accept `conversationsHook` from App.tsx — single source of truth |
| ~~CLARITY-017~~ | ~~Hook error state missing — fetch errors silently swallowed~~ | 05 | ✅ Added `error` field to hook return value |
| CLARITY-018 | Thread detail response shape unspecified | 05 | Add response shape example to route table |
| ~~CLARITY-019~~ | ~~`ENCRYPTION_KEY` parse format not specified~~ | 07 | ✅ Added `Buffer.from(key, 'hex')` |
| ~~CLARITY-020~~ | ~~Which token fields are encrypted unclear~~ | 07 | ✅ Specified: only `access_token` and `refresh_token` |
| CLARITY-021 | `searchThreads` return type and snippet availability | 07 | Add return type signature |
| CLARITY-024 | Architecture linter misses multi-level relative paths | 10 | Add `'../../db'` etc. to forbidden imports |
| CLARITY-027 | "Start Day" button ownership and prerequisites | 01, 05 | Add to Chat component empty state spec |
| ~~CLARITY-028~~ | ~~401 interceptor mechanism not implemented in fetchApi~~ | 05 | ✅ Added global 401 → redirect to `/auth/google` in `fetchApi` |

### Logic Issues

| ID | Issue | Doc | Fix |
|---|---|---|---|
| LOGIC-002 | Tool count says "6" in `06_tech_stack.md`, actual is 5 | 06 | Fix the comment |
| ~~LOGIC-004~~ | ~~`onTitleUpdate` prop type is `(title: string) => void` but caller ignores arg~~ | 05 | ✅ Changed to `() => void` |
| LOGIC-006 | Archive from direct UI doesn't refresh BucketBoard | 05 | Pass `onArchive` callback from App.tsx |
| LOGIC-008 | "Start Day" button in wireframes has no component spec | 05 | Add empty-state branch to Chat |
| LOGIC-010 | REST route schemas for reply/archive/read never designed | 04 | Add route specification section |
| LOGIC-011 | No timeout on SDK resume when session file missing | 04 | Add `Promise.race` with 30s timeout |
| LOGIC-012 | Window focus refetch promised in decisions log but not designed | 05 | Add to hook spec or remove from decisions log |
| LOGIC-013 | Architecture diagram shows duplicate Google API boxes | 08 | Simplify to one set |
| LOGIC-014 | Model identifier format unverified for SDK | 02, 04 | Verify and pin in decisions log |

### Feasibility Issues

| ID | Issue | Risk | Fix |
|---|---|---|---|
| FEAS-004 | Drizzle FK to non-PK unique column may generate unexpected SQL | Medium | Inspect generated migration SQL |
| FEAS-005 | Batch upsert conflict target must be unique column, not PK | Medium | Enforce 25-row cap in query function; verify SQL |
| FEAS-006 | Repeated `countUnbucketedThreads` queries during classification | Low | Acceptable for v1; cache if latency observed |
| FEAS-008 | Gmail `threads.list` snippet availability depends on format | Medium | Use `historyId`-based sync or accept always-fetch |
| FEAS-010 | Drizzle migration journal conflict with hand-written trigger | Medium | Track in journal or embed in initial migration |
| FEAS-011 | `expiry_date` epoch ms → Date conversion must be explicit | Low | Add `new Date(tokens.expiry_date)` in auth.ts |
| FEAS-012 | Drive `files.export` 10MB limit needs graceful error handling | Low | Catch and return descriptive message |
| FEAS-013 | Server tsconfig inherits `"moduleResolution": "bundler"` | Low | Override to `"node16"` in `tsconfig.server.json` |

### Security Issues

| ID | Issue | Severity | Fix |
|---|---|---|---|
| SEC-002 | OAuth callback reflects raw Google error in redirect URL | High | Redirect to `/?auth_error=oauth_failed` instead |
| ~~SEC-004~~ | ~~WebSocket doesn't validate conversationId exists at upgrade time~~ | ~~Medium~~ | ✅ Added `getConversation` check before `onmessage` in `04_backend.md` |
| SEC-006 | SDK session `.jsonl` files accumulate plaintext PII in local dev | Medium | Add `~/.claude/projects/` to `.gitignore`; document cleanup |
| ~~SEC-007~~ | ~~No CSP header; email body rendering must be text-only~~ | ~~Medium~~ | ✅ Added CSP middleware in `04_backend.md`; added text-only rendering note in `ThreadDetail` (`05_frontend.md`) |
| SEC-011 | SDK session IDs in Postgres — informational | Low | No action for v1 |
| ~~SEC-012~~ | ~~Error wireframe shows HTTP status code to user~~ | ~~Low~~ | ✅ Removed "401" from error wireframe in `wireframes.md`; uses plain language |

### Architecture Issues

| ID | Issue | Severity | Fix |
|---|---|---|---|
| ~~ARCH-002~~ | ~~Calendar routes bypass orchestration layer (unlike email)~~ | ~~Warning~~ | ✅ Documented as intentional in `decisions_log.md` (no local cache for calendar/drive) |
| ~~ARCH-003~~ | ~~Linter doesn't enforce routes.ts can't import from tools.ts~~ | ~~Warning~~ | ✅ Added `routes.ts` rule to `lint_module_boundaries.ts` in `10_dev_tooling.md` |
| ~~ARCH-005~~ | ~~email.ts write functions are thin pass-throughs~~ | ~~Warning~~ | ✅ Documented rationale in `decisions_log.md` (single import path for all email ops) |
| ~~ARCH-006~~ | ~~Linter uses string matching, misses barrel re-exports~~ | ~~Note~~ | Accepted — MIN-009 sufficient; upgrade if needed |
| ~~ARCH-007~~ | ~~Single-user assumption not called out as hard constraint in schema~~ | ~~Note~~ | ✅ Added load-bearing constraint note to `03_data_layer.md` overview |
| ~~ARCH-008~~ | ~~Async hygiene linter uses `readFileSync` internally~~ | ~~Note~~ | ✅ Added comment in `10_dev_tooling.md` linter code |

---

## What's Working Well

The reviewers consistently called out strengths:

- **Dual path (WebSocket + REST) sharing code** via `email.ts` and `queries.ts` is genuinely implemented, not aspirational
- **Layer boundary linting** with three custom scripts (`lint_module_boundaries.ts`, `lint_async_hygiene.ts`, `lint_error_handling.ts`) is unusually strong for a solo project
- **Single-user assumption is coherent** — no `user_id` columns, singleton token row, module-level OAuth client — uniform, not patchwork
- **Auth design is solid** — httpOnly cookies, CSRF via HMAC, email allowlist, encrypted token storage (AES-256-GCM)
- **Agent text-only constraint is structural** — WebSocket protocol has no message type for dynamic UI components, making the constraint architectural rather than cultural
- **`email.ts` orchestration layer** cleanly separates Gmail API complexity from both tool and route layers
- **Error handling design** — Zod validation, `AppError` hierarchy, `app.onError` centralized handler — well-structured
- **Encryption at rest** for Google tokens (AES-256-GCM) with proper IV per encryption

---

## Summary Table

| Category | Blockers | High | Medium | Low/Note |
|---|---|---|---|---|
| Clarity | 1 (V1/V2) | 4 | 14 | 4 |
| Logic | 1 (rebucket) | 1 | 8 | 3 |
| Feasibility | 2 (V1/V2, scope) | 1 | 5 | 4 |
| Architecture | 1 (rebucket dup) | 0 | 3 | 3 |
| Security | 1 (approval) | 2 | 5 | 2 |
| **Total** | **2 remaining** | **13** | **~30** | **~15** |

Note: Several findings were flagged by multiple reviewers (V1/V2 ambiguity, rebucket actor, approval gate). BLOCKER-1 (V1/V2) resolved — V2 references removed from `02_agent_spec.md`. BLOCKER-3 (approval gate) accepted as-is for v1.

---

## Recommended Action Plan

1. **Fix the 2 remaining blockers in the design docs** (rebucket actor, Gmail scope)
2. **Create `project/implementation_plan.md`** with phased build order (HIGH-11)
3. **Start implementing** — address HIGH items as you encounter them in each phase
4. **Track MEDIUM items** in `issues_to_be_aware_of.md` (many are already there)
