# Final Touches — Remaining Work

## 1. Agent Skill Files (DEFERRED)

**Status:** Investigated but deferred. The SDK's native Skill tool requires `bypassPermissions` to be disabled and filesystem tools (Read, Bash) to be available. Conflicts with our current permission model. The agent already follows the right workflows (batch-25 classification, meeting prep by attendee search) from the system prompt alone.

**Future work:** Revisit when the SDK supports skills without requiring filesystem tools, or switch to a manual loading approach that appends skill markdown to the system prompt at startup.

---

## 2. Template Picker + Auto-Rebucket UI (~45 min)

When buckets are empty (first load or after deleting all):
- Show template picker in InboxView (list from `GET /api/bucket-templates`)
- On template select: `POST /api/bucket-templates/:id/apply`
- After apply: trigger `POST /api/gmail/sync` then background agent inbox review
- Challenge: rebucketing via agent shouldn't block chat. Options:
  - Fire-and-forget API call that triggers server-side classification
  - Or: auto-send "Review my inbox" to the agent on first load

---

## 3. Test Review + Coverage (~30 min)

- Review all test files for gaps (routes, tools, email, queries)
- Ensure new polling/sync code paths are tested
- Remove any redundant tests
- Verify all mocks match current function signatures

---

## 4. Codebase Cleanup (~15 min)

- Remove unused imports, dead code
- Check for verbose logging that should be trimmed
- Verify no `console.log` or `any` types slipped through
- Ensure consistent error handling patterns

---

## 5. Smoke Test (~15 min)

End-to-end manual test:
1. Login via Google OAuth
2. Inbox syncs, buckets display (or template picker if empty)
3. Ask agent "Review my inbox" → threads get classified
4. Open a thread, send a reply → reply shows in thread
5. Check calendar → events display for the week
6. Ask agent to create a calendar event → appears in UI
7. Trash a thread → disappears from bucket

---

## 6. Multi-Tenancy (~2-2.5 hr)

Full spec at `implementation_phases/multi-tenancy/spec.md`. Summary:
- Add `users` table, add `user_id` to conversations/buckets/email_threads/google_tokens
- Drop `ALLOWED_USERS` allowlist — OAuth consent screen controls access
- Thread `userId` through all queries (~25 functions), routes, email.ts, tools.ts, agent.ts
- Per-user Google token loading via `withUserTokens(userId)`
- Update all tests to pass userId

**Required for reviewers to use the deployed app.**

---

## 7. Deploy to GCP Cloud Run (~30 min)

- Configure GCP Cloud Run project with Postgres + web service
- Set env vars (DATABASE_URL, JWT_SECRET, CSRF_SECRET, GOOGLE_*, ANTHROPIC_API_KEY, ENCRYPTION_KEY)
- Update Google OAuth redirect URI for production domain
- Verify build + deploy succeeds
- Smoke test on production URL

---

## 8. README.md (~20 min)

- What it does (personal assistant for Gmail + Calendar)
- Tech stack overview
- Setup instructions (env vars, Docker, dev server)
- Architecture diagram (text)
- Test instructions
- Live demo link

---

## Execution Order

**Now (coding time):**
1. Skill files
2. Template picker + auto-rebucket
3. Test review + cleanup
4. Smoke test

**Then evaluate:** multi-tenancy (required for reviewers to access)

**Last:**
5. Deploy to GCP Cloud Run
6. README.md
