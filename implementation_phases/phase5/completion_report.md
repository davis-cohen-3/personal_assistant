# Phase 5 Completion Report — Google Connectors

**Status:** Complete
**Output:** Three production connector files + 73 unit tests (all passing)
**Test count after phase:** 103 total (up from 30)

---

## What Was Built

Phase 5 replaced the planned `@aaronsb/google-workspace-mcp` subprocess dependency with three thin, in-process connector files wrapping the official `googleapis` package.

### `src/server/google/gmail.ts`

10 exported functions:

| Function | API | Notes |
|---|---|---|
| `getMessage(id)` | `messages.get` | format: full; decodes MIME body |
| `getThread(id)` | `threads.get` | format: full; decodes all messages |
| `searchThreads(query, maxResults)` | `threads.list` | Returns `ThreadSummary[]` (CLARITY-021) |
| `sendMessage(to, subject, body, opts?)` | `messages.send` | opts: cc, bcc, replyTo, attachments |
| `replyToThread(threadId, messageId, body)` | `messages.send` | Fetches original for In-Reply-To/References headers |
| `createDraft(to, subject, body, threadId?, opts?)` | `drafts.create` | opts: attachments |
| `modifyLabels(id, add, remove)` | `messages.modify` | |
| `markAsRead(id)` | → `modifyLabels` | Removes UNREAD |
| `archiveThread(threadId)` | `threads.modify` | Removes INBOX from thread |
| `listLabels()` | `labels.list` | |

**MIME body decoder:** `decodeBase64Url()` + `findBodyPart()` walk the `payload.parts` tree recursively, handling `multipart/mixed`, `multipart/alternative`, and plain `text/plain` payloads. Extracts both `text/plain` and `text/html` parts.

**RFC 2822 construction:** Uses `mimetext`'s `createMimeMessage()` / `msg.asEncoded()` for all outbound messages. All three write functions (`sendMessage`, `replyToThread`, `createDraft`) call `gmail.users.getProfile({ userId: 'me' })` to populate the From header.

**Attachment support:** `EmailAttachment` interface accepts `Buffer | string` for data. Buffers are converted to base64 by a `toBase64()` helper before being passed to `msg.addAttachment()`.

### `src/server/google/calendar.ts`

7 exported functions:

| Function | API | Notes |
|---|---|---|
| `listEvents(timeMin, timeMax, opts?)` | `events.list` | Always sets `singleEvents: true, orderBy: 'startTime'` |
| `getEvent(eventId)` | `events.get` | |
| `createEvent(input)` | `events.insert` | `sendUpdates: 'all'` |
| `updateEvent(eventId, patch)` | `events.patch` | Partial update; `sendUpdates: 'all'` |
| `deleteEvent(eventId)` | `events.delete` | `sendUpdates: 'all'` |
| `checkFreeBusy(timeMin, timeMax, calendarIds?)` | `freebusy.query` | Defaults to `['primary']` |
| `parseEvent(data)` | — | Helper; also exported for callers |

**`parseEvent` helper:** Normalizes all-day vs. timed events (`isAllDay` flag, `start`/`end` drawn from `.date` vs. `.dateTime`). Extracts attendees array, handles missing optional fields.

### `src/server/google/drive.ts`

5 exported functions:

| Function | API | Notes |
|---|---|---|
| `searchFiles(query, opts?)` | `files.list` | Translates query via `translateQuery()` |
| `listRecentFiles(maxResults?)` | `files.list` | `orderBy: 'viewedByMeTime desc'`; default 20 |
| `readDocument(fileId)` | `files.export` | `text/plain`; FEAS-012 error handling |
| `getFileMetadata(fileId)` | `files.get` | id, name, mimeType, modifiedTime, webViewLink |
| `translateQuery(query)` | — | Exported helper |

**`translateQuery` helper:** Plain-text queries become `fullText contains 'x' and trashed = false`. Queries that already contain Drive DSL operators (`contains`, `mimeType =`, `' in `, `sharedWithMe`, `trashed`) are passed through with only `and trashed = false` appended.

---

## Issues Discovered and Resolved

### `asRaw()` vs `asEncoded()` — mimetext API correction

The research doc (`project_scoping/research/googleapis_reference.md`) incorrectly documented `msg.asRaw()` as returning a base64url-encoded string. It does not — `asRaw()` returns raw RFC 2822 MIME text. `asEncoded()` returns the base64url-encoded version that Gmail's API `raw` field expects.

**Fix:** All three write functions now call `msg.asEncoded()` directly. The research doc was corrected in all three code examples and an Attachments section was added. The original implementation used `Buffer.from(msg.asRaw()).toString('base64url')` as a workaround that happened to work, but `asEncoded()` is the correct call.

---

## Issues Addressed

| Issue | Resolution |
|---|---|
| CLARITY-021: `searchThreads` return type | `ThreadSummary[]` defined and returned |
| FEAS-012: Drive 10MB export limit | `readDocument` catches 403 size errors, throws user-facing `AppError` with clear message; non-size errors re-thrown |

---

## Tests

73 new unit tests across three files. All mock `googleapis` and `getAuthClient` — no real API calls.

| File | Tests | Coverage |
|---|---|---|
| `tests/unit/google/gmail.test.ts` | 33 | All 10 functions + MIME decoding (nested multipart, plain-text only, html) + attachments + asEncoded verification |
| `tests/unit/google/calendar.test.ts` | 20 | All 7 functions + parseEvent (timed, all-day, attendees) |
| `tests/unit/google/drive.test.ts` | 20 | All 5 functions + translateQuery (plain text, DSL passthrough, mimeType filter) |

---

## What's Next

Phase 6: `src/server/email.ts` — the orchestration layer that coordinates `gmail.ts` and `queries.ts`. Implements `syncInbox`, `getThread`, `searchThreads` (the email sync/read path that MCP tools call into).
