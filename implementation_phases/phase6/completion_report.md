# Phase 6 Completion Report — Email Orchestration

**Status:** Complete
**Output:** One orchestration file + 27 unit tests (all passing)
**Test count after phase:** 132 total (up from 105)

---

## What Was Built

Phase 6 built `src/server/email.ts` — the service layer that sits between the Gmail connector (`gmail.ts`) and the database (`db/queries.ts`). All email reads and writes from MCP tools and REST routes go through this layer so the local cache stays consistent and body text extraction (IMP-020) is applied uniformly.

### `src/server/email.ts`

10 exported functions:

| Function | Type | Notes |
|---|---|---|
| `syncInbox(maxResults?)` | Read | Diff-based: skips unchanged threads (snippet match), fetches only new/changed; returns `{ new, updated }` |
| `search(query, maxResults?)` | Read | Syncs matching threads to DB; caps at `BATCH_SIZE=25`; returns from DB |
| `getThread(gmailThreadId)` | Read | Always re-fetches from Gmail (MIN-003 accepted); upserts; returns from DB |
| `getUnbucketedThreads()` | Read | Pure DB read; returns `{ unbucketed, threads }` |
| `sendMessage(to, subject, body, opts?)` | Write | Delegates to `gmail.sendMessage`; opts limited to `{ cc? }` |
| `replyToThread(threadId, messageId, body)` | Write | Delegates to `gmail.replyToThread` |
| `createDraft(to, subject, body, threadId?)` | Write | Delegates to `gmail.createDraft` |
| `archiveThread(gmailThreadId)` | Write | Delegates to `gmail.archiveThread` |
| `markAsRead(messageId)` | Write | Delegates to `gmail.markAsRead` |

**Private helpers (not exported):**

- `extractBodyText(msg)` — returns `msg.bodyText` when non-empty; strips HTML tags, style blocks, `&nbsp;`, and collapses whitespace from `msg.bodyHtml` as fallback. Fixes IMP-020: HTML-only promotional emails previously synced with empty `body_text`.
- `parseFrom(from)` — parses `"Name <email>"` format into `{ from_email, from_name }`.
- `toThreadRecord(full, snippet?)` — maps `GmailThread` → `upsertEmailThread` input shape.
- `toMessageRecords(messages)` — maps `GmailMessage[]` → `upsertEmailMessages` input shape, applying `extractBodyText` on every message.

**Concurrency:** `pLimit(5)` module-level pool shared across `syncInbox` and `search`. A 200-thread inbox sync with 20 changed threads makes at most 5 concurrent `gmail.getThread` calls at any time.

---

## Issues Addressed

| Issue | Resolution |
|---|---|
| IMP-020: HTML-only emails have empty `bodyText` | `extractBodyText` strips HTML from `bodyHtml` as fallback; applied in `toMessageRecords`, which is called by every `upsertEmailMessages` call |
| IMP-014: Snippet comparison may not work in all cases | Accepted for v1 — diff falls back to always fetching if snippet is absent (missing snippet ≠ matching snippet) |
| MIN-003: `getThread` always re-fetches | Accepted for v1; no cache check added |

---

## Issues Discovered

### MIN-016: `sendMessage`/`createDraft` do not expose attachments (deferred to v2)

`gmail.ts` supports `EmailAttachment[]` in `SendMessageOptions`. `email.ts` narrows `sendMessage` opts to `{ cc?: string[] }`, so neither the MCP tool nor REST send route can pass attachments. The agent's v1 workflows (classify, summarize, draft reply) don't require sending attachments. Noted in `issues_to_be_aware_of.md` for v2.

---

## Tests

27 new unit tests in `tests/unit/email.test.ts`. Both `gmail.ts` and `db/queries.ts` are fully mocked — no real API calls or DB.

| Describe block | Tests | What's covered |
|---|---|---|
| `extractBodyText` | 4 | Plain text returned as-is; style blocks stripped; whitespace collapsed; both empty → `""` |
| `syncInbox` | 9 | Empty inbox; new thread; unchanged thread skipped; changed snippet fetched; mixed counts; `gmail_thread_id` in upsert; message IDs in upsert; default limit (200); custom limit |
| `search` | 5 | Empty results; sync+return; BATCH_SIZE cap (no maxResults); BATCH_SIZE cap (exceeds 25); `extractBodyText` applied |
| `getThread` | 2 | Always fetches from Gmail; returns DB result after upsert |
| `getUnbucketedThreads` | 2 | Returns count + threads; passes BATCH_SIZE (25) as limit |
| `sendMessage` | 1 | Delegates with same args |
| `replyToThread` | 1 | Delegates with same args |
| `createDraft` | 1 | Delegates with same args; returns draft ID |
| `archiveThread` | 1 | Delegates with same args |
| `markAsRead` | 1 | Delegates with same args |

---

## What's Next

Phase 7: MCP tools (`src/server/tools.ts`) and REST routes (`src/server/routes.ts`). Both tasks can be run as parallel subagents — they depend on Phase 6 but not on each other.
