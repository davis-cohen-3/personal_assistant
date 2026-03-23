# Session: Group Emails Button Feature

**Date:** 2026-03-22
**Phase:** Final Touches — Template Picker + Auto-Rebucket UI

## Summary

Implemented a "Group emails" button that lets users classify their inbox without using the chat. The button is always visible in the inbox view — when clicked, it shows an editable list of bucket categories (with sensible defaults). On confirm, existing buckets are deleted, new ones created via REST, and the agent is auto-triggered via WebSocket to classify the last 200 threads. Chat input is disabled during classification.

## Key Decisions

- **Option A (auto-send agent message) over Option B (separate endpoint):** Reuses the existing agent classification pipeline instead of duplicating LLM logic in a standalone endpoint. The chat shows the agent working, which is good UX for a demo.
- **Delete-all-and-recreate on rebucket:** When the user modifies buckets and confirms, all existing buckets are deleted and new ones created. Since the agent reclassifies everything anyway, preserving old assignments isn't needed.
- **No first-visit auto-trigger:** The button is manual — no auto-classification on load. User has full control over taxonomy before anything happens.
- **Queued message pattern for WebSocket:** Added `queuedMessage` prop to ChatPanel with `socketReady` state tracking, so the auto-sent message reliably fires even when a new conversation + WebSocket is created in the same flow.

## Code Changes

- Created: `src/client/components/GroupEmailsSetup.tsx` — editable bucket list with defaults (Important, Can Wait, Newsletter, Auto-archive)
- Modified: `src/client/components/InboxView.tsx` — "Group emails" button always visible, setup overlay, classifying banner
- Modified: `src/client/components/ChatPanel.tsx` — `disabled`, `queuedMessage`, `onQueuedMessageSent` props; `socketReady` state for reliable queued message delivery
- Modified: `src/client/App.tsx` — `isGrouping`/`queuedMessage` state, `handleGroupEmails` callback (delete existing → create new → queue agent message)
- Modified: `src/server/agent.ts` — Updated email-classifier subagent prompt to loop until zero unbucketed threads remain

## Bugs Fixed

- **TDZ crash (blank page):** The queued message `useEffect` referenced `send` in its dependency array before `send` was declared (`const send = useCallback(...)`). Moved the effect after the `send` declaration.

## Open Questions

- Agent approval pattern: the system prompt says "NEVER execute side-effect operations directly" — the auto-sent message says "Proceed immediately without asking for confirmation." This works in practice (bucket assignment isn't a dangerous side-effect like sending email), but the prompt tension could cause inconsistent behavior.

## Next Steps

- [ ] Test review + coverage (plan item #3)
- [ ] Codebase cleanup (plan item #4)
- [ ] Smoke test end-to-end (plan item #5)
- [ ] Multi-tenancy (plan item #6 — required for reviewers)
- [ ] Deploy to GCP Cloud Run + README
