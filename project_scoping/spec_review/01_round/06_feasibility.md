# Feasibility Review

SDK constraints, Google API limits, Railway deployment, and implementation complexity.

---

## Blocker

### FEAS-001: Agent SDK API Surface Unverified

See **CRIT-006** in `01_critical_issues.md`.

The entire `agent.ts` is built on assumed SDK APIs: `query()` as async generator, `resume:` option, `Agent` tool for subagents, session file paths. None verified against actual SDK types.

---

### FEAS-002: SDK Session Files on Railway's Ephemeral Filesystem

Session files live at `~/.claude/projects/<cwd>/<session-id>.jsonl`. Railway's filesystem is ephemeral — lost on every deploy. The design's "attempt resume, fall back to fresh" flow works only within a single Railway instance lifetime. If the SDK cannot write to its target path at all, it may throw on startup.

**Fix:** Determine the SDK's session storage path. If configurable, point to `/tmp`. If not, accept that resume never works on Railway.

---

## Risk

### FEAS-003: Drizzle Upsert Must Target Correct Conflict Index

`email_messages` has FK on `gmail_thread_id` referencing `email_threads.gmail_thread_id`. The `upsertEmailThread` query must use `.onConflictDoUpdate({ target: emailThreads.gmail_thread_id })`, not the PK. Wrong conflict target breaks incremental sync.

**Fix:** Use the correct conflict target in the implementation and test it.

**Affected docs:** `03_data_layer.md`

---

### FEAS-004: Snippet-Based Diff Sync May Cause Spurious Re-fetches

`syncInbox` compares `local.snippet !== thread.snippet` to detect changes. Gmail's `threads.list` snippet may differ in whitespace/encoding between calls, or be absent for drafts. This could double the number of `getThread` calls.

**Fix:** If `thread.snippet` is undefined/empty, treat as unchanged. Log a warning. Accept some staleness for v1.

**Affected docs:** `04_backend.md`

---

### FEAS-005: Prompt-Only Approval Gate

See **CRIT-004** in `01_critical_issues.md`. The design defers tool-layer enforcement, but the risk is concrete for email sends.

---

### FEAS-006: Hono WebSocket API Mismatch ✅ RESOLVED

The design uses `ws.on('message', ...)` and `ws.on('close', ...)` (Node.js EventEmitter style). `@hono/node-ws` provides `WSContext` with `ws.onmessage`/`ws.onclose` callback-style API.

**Fix:** Replace `ws.on('message', handler)` with `ws.onmessage = handler` etc. Verify `WSContext` type signature before implementing.

**Affected docs:** `04_backend.md`

---

### FEAS-007: Sequential Search vs Parallel syncInbox ✅ RESOLVED

`search()` fetches 25 threads serially at ~300ms each = ~7.5s blocking. `syncInbox` uses `pLimit(5)`.

**Fix:** Apply `pLimit(5)` to search. One-line change.

**Affected docs:** `04_backend.md`

---

### FEAS-008: Bearer Token Lost on Page Refresh

See **CRIT-002** in `01_critical_issues.md`.

---

### FEAS-009: createChatMessage Must Explicitly Touch conversations.updated_at ✅ RESOLVED

The `set_updated_at` trigger fires on the `conversations` table, not transitively on `chat_messages` inserts. `createChatMessage` must issue an explicit `UPDATE conversations SET updated_at = NOW()` to trigger recency sorting.

**Fix:** Implement the explicit UPDATE in `queries.ts`.

**Affected docs:** `03_data_layer.md`

---

### FEAS-010: Drizzle Initialized Without Connection Pool ✅ RESOLVED

`drizzle(process.env.DATABASE_URL!, { schema })` uses a single connection. Concurrent queries from `pLimit(5)` operations + subagent writes serialize against one connection, causing timeouts.

**Fix:** Initialize with `pg.Pool`: `const pool = new Pool({ connectionString }); const db = drizzle(pool, { schema });`. Pool size of 5 is sufficient.

**Affected docs:** `03_data_layer.md`, `04_backend.md`

---

### FEAS-011: Archive — thread_id vs message_id ✅ RESOLVED

See LOGIC-004. The tool, REST route, and architecture diagram disagree on whether archive operates on a thread or message.

**Fix:** Align to thread-level archive before implementation.

---

## Note

### FEAS-012: Google Token expiry_date Is Epoch Milliseconds

The `googleapis` library returns `expiry_date` as epoch ms (a number). The schema stores it as `timestamp with time zone`. Raw number insertion will fail or be interpreted incorrectly.

**Fix:** In `persistTokens()`: `expiry_date: new Date(tokens.expiry_date)`. Add a test.

**Affected docs:** `07_google_connectors.md`

---

### FEAS-013: Drive Document Export Can Blow Context Window

`drive.files.export` returns full plain text (up to 10MB). Even 100KB = ~25K tokens, consuming significant context window during multi-step workflows.

**Fix:** Add `maxChars` parameter to `readDocument` with default ~8000 chars, truncating with a note.

**Affected docs:** `07_google_connectors.md`

---

### FEAS-014: One-Bucket-Per-Thread Constraint

The `thread_buckets` unique index on `gmail_thread_id` is correctly expressed. `assignThreadsBatch` upsert must target this index.

**Fix:** Verify during implementation. No spec change needed.

---

### FEAS-015: Biome Version Not Pinned

`biome.json` targets 2.0.x schema but no version is pinned in `package.json`. Biome 2.x vs 1.x are not config-compatible.

**Fix:** Pin `@biomejs/biome` to a specific 2.x version in devDependencies.

**Affected docs:** `06_tech_stack.md`

---

### FEAS-016: tsconfig moduleResolution "bundler" Used for Server Build

`moduleResolution: "bundler"` is for Vite/esbuild, not `tsc` + Node.js. `tsc` may accept imports that Node.js rejects at runtime (e.g., missing `.js` extensions).

**Fix:** Set `"moduleResolution": "node16"` or `"nodenext"` in `tsconfig.server.json`, or use `tsx`/`esbuild` for the server build.

**Affected docs:** `06_tech_stack.md`
