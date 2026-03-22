# Session: Agent fixes and Phase 10 spec

**Date:** 2026-03-22
**Phase:** 9 — Frontend App Shell & Chat

## Summary

Investigated and fixed agent subagent configuration bugs (model IDs, naming mismatches). Downgraded main agent model from Opus to Sonnet. Performed end-to-end testing of the agent via the UI — agent works (searches email, calendar, drive, creates buckets) but subagents never spawn (Sonnet handles tasks inline). Documented all chat UX issues into a Phase 10 spec.

## Key Decisions

- Model config: Main agent downgraded to `claude-sonnet-4-6`, subagents use short alias `"haiku"` (not full model IDs — SDK requires `"sonnet" | "opus" | "haiku" | "inherit"`)
- Subagent names in system prompt fixed from underscores to hyphens to match definition keys
- Subagents not spawning is acceptable for now — Sonnet prefers to handle tasks inline, and the wiring is correct per SDK docs
- Skills loading in `initAgent()` loads dev workflow skills into the agent prompt — flagged as likely unintentional but deferred
- Archive button should become Trash (Gmail trash, not permanent delete)
- Phase 10 spec written covering 4 bugs + 4 UX items + layout redesign

## Code Changes

- Modified: `src/server/agent.ts` — model aliases, name fixes, console.warn → console.info
- Modified: `src/client/components/BucketBoard.tsx` — div→button for a11y
- Modified: `src/client/components/CalendarView.tsx` — div→button for a11y
- Modified: `src/client/components/ConversationList.tsx` — div→button for a11y, button type attrs
- Modified: `src/client/components/Chat.tsx` — unique message IDs instead of array index keys
- Modified: `src/client/components/ui/spinner.tsx` — role="status" for aria-label
- Modified: `src/shared/types.ts` — added `id` field to ChatMessage
- Created: `implementation_phases/phase10/spec.md` — full Phase 10 spec

## Open Questions

- Why does `initAgent()` load dev workflow skills (.claude/skills/) into the production agent's system prompt? Should this be removed or pointed at agent-specific skills?
- Subagents may need stronger prompting or explicit invocation to trigger with Sonnet

## Next Steps

- [ ] Phase 10 Task 1: Fix WebSocket lifecycle (can't send follow-up messages)
- [ ] Phase 10 Task 2: Thinking indicator + tool status events
- [ ] Phase 10 Task 3: Markdown rendering for agent responses
- [ ] Phase 10 Task 4: Remove Start Day button
- [ ] Phase 10 Task 5: Email reply feedback in ThreadDetail
- [ ] Phase 10 Task 6: Archive → Trash across full stack
- [ ] Phase 10 Task 7: Layout redesign (chat sidebar, dashboard center)
