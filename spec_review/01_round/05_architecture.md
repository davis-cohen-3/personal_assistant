# Architecture Review

Coupling, layer boundaries, modularity, complexity budget, and technology fit.

## Overall Assessment

The design is well-scoped for a single-user v1. The dual-path model (WebSocket for agent, REST for direct UI) sharing the same connectors and query layer is clean. The `email.ts` orchestration layer is a good call. The custom architecture linters are an unusually strong quality control. The decisions log is thorough.

---

## Warning

### ARCH-001: Asymmetric Orchestration — email.ts Exists, calendar.ts / drive.ts Don't

`email.ts` is an orchestration layer between tools/routes and the Gmail connector, handling DB coordination (upserts, syncing, caching). The `calendar` and `drive` tools call Google connectors directly from `tools.ts`. REST routes for calendar/drive also bypass any orchestration layer.

This means:
- Email: tools → `email.ts` → `gmail.ts` (consistent shared path)
- Calendar: tools → `calendar.ts` directly, routes → `calendar.ts` directly (no shared path)

As needs grow (e.g., caching calendar events in v2), there's no established place for coordination logic.

**Fix:** Either introduce `calendar.ts` / `drive.ts` orchestration modules (mirroring email.ts), or explicitly document that calendar/drive are connector-direct by design because they have no DB coordination needs.

**Affected docs:** `04_backend.md`

---

### ARCH-002: data_changed Events Not Emitted by REST Routes

REST routes mutate data (reply, archive, calendar edit) but don't emit `data_changed` events. Only MCP tool handlers emit them. If the user sends a reply via the direct UI, other data panels (BucketBoard, CalendarView) won't auto-refresh — they rely on their own hook's `refetch()` only.

**Fix:** Either have REST handlers call `emitDataChanged()` for shared-state mutations, or document that `data_changed` is agent-path only and REST mutations rely on hook-level refetch.

**Affected docs:** `04_backend.md`, `05_frontend.md`

---

### ARCH-004: Bearer Token Split-Brain Auth

See **CRIT-002** in `01_critical_issues.md`. Two auth states exist: "has bearer token in memory" and "has valid cookie but no bearer token." The page-refresh recovery path is missing.

---

## Note

### ARCH-003: search() Uses Sequential Fetch, syncInbox Uses Parallel ✅ RESOLVED

Inconsistency within the `email.ts` orchestration layer itself. Not a layer boundary issue, but surprising when both paths share the same module.

**Fix:** Apply `pLimit(5)` to search as well.

---

### ARCH-005: Module-Level pLimit Shared Across Concurrent Calls

`email.ts` has a module-level `const limit = pLimit(5)` shared by all callers. If two `syncInbox` calls are in-flight (e.g., from main agent + subagent), they share the same concurrency pool. Not a problem for single-user v1, but an implicit shared-state assumption.

**Fix:** Document that `syncInbox` is not safe for truly concurrent calls, or scope `pLimit` per-invocation.

---

### ARCH-006: SDK Session Resume Failure Path Unspecified

`conversations.sdk_session_id` stores the session file path. On Railway redeploy, session files are lost. The design says "attempt resume, fall back to fresh session" but doesn't specify: what error does the SDK throw when a session file is missing? How does `streamQuery` recover?

**Fix:** Specify the error-handling contract for failed resume in `agent.ts`.

**Affected docs:** `04_backend.md`

---

### ARCH-007: Module Boundary Linter Doesn't Block routes.ts → tools.ts

The linter checks that `tools.ts` doesn't import from `routes.ts`, but doesn't enforce the reverse. A developer could add a helper in `tools.ts` that a route imports, creating an upward dependency.

**Fix:** Add a rule: `routes.ts` must not import from `tools.ts`.

**Affected docs:** `10_dev_tooling.md`

---

### ARCH-008: bucket_templates JSONB Shape Not Validated

`bucket_templates.buckets` is a JSONB column with an untyped contract. If the shape diverges from what `applyBucketTemplate` expects, the failure is a runtime error.

**Fix:** Add a Zod schema or TypeScript type in `queries.ts` for the template bucket shape. Validate on read.

**Affected docs:** `03_data_layer.md`
