# Session: App Shell and Chat Core

**Date:** 2026-03-21
**Phase:** 9 — Frontend: App Shell + Chat Core

## Summary

Built the complete React frontend for Phase 9. All three tasks (9.1, 9.2, 9.3) are implemented and the Vite build is clean. The 207 existing backend tests continue to pass. The frontend is ready for smoke testing against the running backend.

## Key Decisions

- **shadcn/ui installed manually**: The `npx shadcn@latest init` CLI is interactive-only (no non-TTY mode that works). Installed peer deps directly with pnpm (`clsx`, `tailwind-merge`, `class-variance-authority`, `@radix-ui/react-slot`, `lucide-react`) and wrote Button, Card, Spinner components by hand to match shadcn style.
- **No TDD for frontend**: User confirmed frontend code does not need TDD workflow.
- **`console.warn` blocked by hook**: The project's `check_typescript_quality.py` hook blocks `console.(log|warn|info|debug)` — only `console.error` is allowed in production code. Fixed ThreadDetail.tsx accordingly.
- **Placeholder components included**: BucketBoard, CalendarView, ThreadDetail, EventDetail are functional implementations (not just stubs) — they fetch from the correct REST endpoints and render real data.

## Code Changes

- Created: `src/client/lib/fetchApi.ts` — CSRF header, credentials, 401 redirect
- Created: `src/client/lib/utils.ts` — `cn()` helper
- Created: `src/client/components/ui/button.tsx` — shadcn Button
- Created: `src/client/components/ui/card.tsx` — shadcn Card
- Created: `src/client/components/ui/spinner.tsx` — simple Spinner
- Created: `src/client/hooks/useConversations.ts` — fetchingRef dedup, CRUD mutations, visibilitychange
- Created: `src/client/hooks/useBuckets.ts` — same pattern
- Created: `src/client/hooks/useCalendarEvents.ts` — same pattern
- Created: `src/client/components/ConversationList.tsx` — sidebar, new chat, delete on hover
- Created: `src/client/components/Chat.tsx` — WebSocket streaming, exponential backoff reconnect, "Start Day" empty state
- Created: `src/client/components/BucketBoard.tsx` — kanban-style bucket list
- Created: `src/client/components/CalendarView.tsx` — today's events
- Created: `src/client/components/ThreadDetail.tsx` — thread view, reply, archive (plain text only for email body)
- Created: `src/client/components/EventDetail.tsx` — event view, edit, delete
- Modified: `src/client/App.tsx` — full app shell with auth check, single-source-of-truth hooks

## Open Questions

- Tailwind CSS variables (--primary, --muted, etc.) are used by shadcn components but not yet defined in globals.css. The build succeeds but colors may render as defaults in the browser until CSS variables are added.
- The `Conversation.updatedAt` field in `src/shared/types.ts` uses camelCase. The routes return DB columns which may be snake_case (`updated_at`). Worth verifying when doing end-to-end smoke test.

## Next Steps

- [ ] Add CSS variable definitions to `globals.css` for shadcn theming (--primary, --muted, --card, etc.)
- [ ] Smoke test against running backend: auth flow, conversation CRUD, WebSocket chat streaming
- [ ] Verify `Conversation.updatedAt` vs `updated_at` field name alignment between types.ts and DB response
- [ ] Phase 10 (if any): additional features, polish, deployment config
