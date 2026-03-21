# Phase 7 Completion Report: MCP Tools + REST Routes

**Completed:** 2026-03-21
**Status:** Complete — all tests green

## What Was Built

Two parallel tasks delivered the full agent-facing and UI-facing interfaces over the service layers from Phases 5–6.

### Task 7.1 — `src/server/tools.ts` (23 tests)

5 in-process MCP tools that the Agent SDK calls during chat:

| Tool | Actions |
|------|---------|
| `buckets` | list, create, update, delete, assign |
| `sync_email` | sync, search, get_thread, get_unbucketed |
| `action_email` | send, reply, draft, archive, mark_read |
| `calendar` | list, get, create, update, delete, free_busy |
| `drive` | search, list_recent, read, metadata |

Key behaviors:
- `buckets create` calls `markAllForRebucket()` and returns `rebucket_required: true`
- `buckets assign` enforces max 25 per batch, maps snake_case input → camelCase for `assignThreadsBatch`
- All `action_email` operations delegate to `email.ts` (not `gmail.ts` directly)
- Exports `handlers` object for direct unit testing without SDK wrapper

### Task 7.2 — `src/server/routes.ts` (31 tests)

35 REST endpoints mounted at `/api/*`:

| Group | Routes |
|-------|--------|
| Gmail | GET /gmail/threads, GET /gmail/threads/:id, POST /gmail/send, POST /gmail/threads/:id/reply, POST /gmail/threads/:id/archive, POST /gmail/messages/:id/read |
| Calendar | GET/POST /calendar/events, GET/PATCH/DELETE /calendar/events/:id |
| Buckets | GET/POST /buckets, POST /buckets/assign, PATCH/DELETE /buckets/:id |
| Bucket Templates | GET /bucket-templates, GET /bucket-templates/:id, POST /bucket-templates/:id/apply |
| Conversations | GET/POST /conversations, GET/PATCH/DELETE /conversations/:id |

Also updated `src/server/index.ts` to mount `apiRoutes`.

## Review Issues Addressed

| Issue | Resolution |
|-------|-----------|
| HIGH-4: AppError message leak | Already implemented in index.ts; verified correct |
| HIGH-5: GET param validation | Zod validation on maxResults (1–25), timeMin/timeMax (datetime), q (max 200 chars) |
| HIGH-8: Route registration order | `POST /buckets/assign` registered before `PATCH /buckets/:id` |
| LOGIC-010: Reply/archive route schemas | Zod schemas on reply (body + messageId), archive, read routes |

## Test Results

```
Test Files  11 passed (11)
     Tests  186 passed (186)
```

54 new tests added this phase (23 tools + 31 routes).

## Files Changed

| File | Status |
|------|--------|
| `src/server/tools.ts` | Created |
| `src/server/routes.ts` | Created |
| `src/server/index.ts` | Updated (apiRoutes mount) |
| `tests/unit/tools.test.ts` | Created |
| `tests/unit/routes.test.ts` | Created |
