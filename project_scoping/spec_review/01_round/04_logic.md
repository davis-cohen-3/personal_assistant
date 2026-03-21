# Logic Review

Cross-document contradictions, requirement gaps, data flow inconsistencies, and missing edge cases.

---

## Critical

### LOGIC-001: WebSocket Message Schema Rejects set_conversation

See **CRIT-001** in `01_critical_issues.md`.

`04_backend.md` `wsMessageSchema` only accepts `{ type: 'chat', content }`. `05_frontend.md` sends `{ type: 'set_conversation', conversationId }`. The backend rejects it with "Invalid message format."

---

### LOGIC-002: Conversation Create Requires Title But Frontend Sends None

See **CRIT-007** in `01_critical_issues.md`.

`createConversationSchema` requires `title: z.string().min(1)`. `ConversationList` calls `createConversation()` with no arguments.

---

### LOGIC-003: GET /api/gmail/threads Requires `q` But Has No Frontend Consumer ✅ RESOLVED

The route requires `?q=` and returns 400 if missing. No component calls this endpoint. `BucketBoard` gets threads from `GET /api/buckets`. `ThreadDetail` uses `GET /api/gmail/threads/:id`. The list endpoint is orphaned.

**Fix:** Either document which component calls it, or make `q` optional (defaulting to `is:inbox`).

**Affected docs:** `04_backend.md`, `05_frontend.md`

---

## Warning

### LOGIC-004: Archive Tool — thread_id vs message_id Mismatch ✅ RESOLVED

`action_email` tool handler calls `email.archiveThread(params.thread_id!)`. But `07_google_connectors.md` lists `message_id` as the parameter for archive. `08_architecture_diagrams.md` shows `POST /api/gmail/messages/:id/archive`. The tool handler, the connector spec, and the architecture diagram all disagree.

**Fix:** Align everything to thread-level archive (matching the route in `routes.ts`).

**Affected docs:** `04_backend.md`, `07_google_connectors.md`, `08_architecture_diagrams.md`

---

### LOGIC-005: emitDataChanged('calendar') Missing from Tool Handlers

The `calendar` tool handles `create`, `update`, and `delete` but none call `emitDataChanged('calendar')`. The `useBuckets` equivalent correctly calls `emitDataChanged('buckets')`. Agent-initiated calendar changes won't trigger `CalendarView` to refetch.

**Fix:** Add `emitDataChanged('calendar')` in the `create`, `update`, and `delete` cases.

**Affected docs:** `04_backend.md`

---

### LOGIC-006: REST Bucket Create Marks Rebucket But Can't Trigger Agent

`POST /api/buckets` calls `queries.markAllForRebucket()` after creating a bucket. But re-bucketing is triggered by the MCP `buckets create` tool returning `rebucket_required: true` — the REST path has no mechanism to notify the agent.

**Fix:** Either don't call `markAllForRebucket()` from the REST route (leave it to the tool path), or document that re-bucketing after a direct UI bucket create requires the user to explicitly ask the agent.

**Affected docs:** `04_backend.md`, `02_agent_spec.md`

---

### LOGIC-007: Bearer Token Lost on Page Refresh

See **CRIT-002** in `01_critical_issues.md`.

---

### LOGIC-008: Variable Shadowing in email.ts ✅ RESOLVED

Module-level `const limit = pLimit(5)` is shadowed by local `const limit = Math.min(...)` inside `search()`. If someone adds parallel fetching inside `search` and references `limit`, they get a number, not the concurrency limiter.

**Fix:** Rename the local variable to `maxLimit` or `resultLimit`.

**Affected docs:** `04_backend.md`

---

### LOGIC-009: WebSocketProvider Connects Without conversationId

`WebSocketProvider` connects at app mount with no `conversationId`. The backend's `handleWebSocket` requires it and closes the socket immediately if missing. The initial connection always fails.

See **CRIT-001** in `01_critical_issues.md` for the full analysis.

---

### LOGIC-010: Subagent "No Write" Constraint Contradicts email_classifier ✅ RESOLVED

`02_agent_spec.md` line 225: "No write operations. Subagents cannot send email, create events, or modify data." But the `email_classifier` subagent has `buckets (list + assign only)` — `assign` is a DB write. The spec contradicts itself.

**Fix:** Clarify: "Subagents cannot perform external side-effects (send email, create/modify calendar events). Internal data writes (bucket assignment) are permitted for the email_classifier."

**Affected docs:** `02_agent_spec.md`

---

### LOGIC-011: Architecture Diagram Shows Wrong Archive Endpoint ✅ RESOLVED

`08_architecture_diagrams.md` component tree shows `POST /api/gmail/messages/:id/archive`. The actual route is `POST /api/gmail/threads/:id/archive`. The frontend code uses the correct thread endpoint.

**Fix:** Update the diagram.

**Affected docs:** `08_architecture_diagrams.md`

---

## Note

### LOGIC-012: Sequential Search vs Parallel syncInbox ✅ RESOLVED

`email.ts` `search()` fetches threads sequentially in a for-loop. `syncInbox` uses `Promise.all` + `pLimit(5)`. For 25 results, search is ~5x slower.

**Fix:** Apply the same `pLimit(5)` pattern to search.

**Affected docs:** `04_backend.md`

---

### LOGIC-013: Calendar timeMax Defaults to Undefined ✅ RESOLVED

`GET /api/calendar/events` passes `undefined` for `timeMax` when not provided, causing `events.list` to return events with no upper bound.

**Fix:** Default `timeMax` to end of current day.

**Affected docs:** `04_backend.md`

---

### LOGIC-014: No Guard on Applying Template Twice

`POST /api/bucket-templates/:id/apply` can be called after buckets already exist, causing duplicate name conflicts.

**Fix:** Add a guard: if buckets exist, return 409 Conflict.

**Affected docs:** `04_backend.md`, `03_data_layer.md`

---

### LOGIC-015: GOOGLE_REDIRECT_URI Missing from REQUIRED_ENV ✅ RESOLVED

`GOOGLE_REDIRECT_URI` is in `.env.example` but not in the `REQUIRED_ENV` array validated at startup. The OAuth flow will fail at runtime rather than at startup.

**Fix:** Add `GOOGLE_REDIRECT_URI` to `REQUIRED_ENV`.

**Affected docs:** `04_backend.md`
