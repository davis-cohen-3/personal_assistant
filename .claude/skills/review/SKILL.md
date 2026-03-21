---
name: review
description: Multi-perspective code review before creating a PR. Covers security, architecture, code quality, testing.
disable-model-invocation: true
---

# Code Review

Multi-perspective code review before creating a PR.

## Before You Start

Ask: **What files or changes should I review?**

Options:
- Specific files (provide paths)
- All uncommitted changes (`git diff`)
- All changes on current branch vs main (`git diff main...HEAD`)

## Review Perspectives

### 1. Security Review

- [ ] **No credentials or secrets** in code
- [ ] **Google OAuth tokens** handled securely (stored in Postgres kv_store, not filesystem)
- [ ] **JWT session cookie** — httpOnly, secure, sameSite
- [ ] **No raw SQL** — all queries through Drizzle query builder
- [ ] **No internal error details** exposed in API responses
- [ ] **Input validation** on REST endpoints
- [ ] **WebSocket messages** validated

### 2. Architecture Review

- [ ] **Routes are thin** — validate, call query/connector, respond
- [ ] **MCP tools share code** with REST routes (same queries, same connectors)
- [ ] **Google connectors** have no business logic (thin wrappers)
- [ ] **No circular imports**
- [ ] **Async consistency** — all I/O is async/await, no missing awaits
- [ ] **Agent is text-only** — no UI rendering from agent
- [ ] **Shared types** in `src/shared/types.ts` if used by both server and client

### 3. Code Quality Review

- [ ] **No `any` types** or `as any` assertions
- [ ] **No fallbacks** — code fails fast, no silent defaults
- [ ] **No exception swallowing** — errors handled or re-thrown
- [ ] **No console.log** — use project logger
- [ ] **Minimal changes** — only what's needed, no over-engineering
- [ ] **No unnecessary abstractions** — three similar lines > premature abstraction

### 4. Testing Review

- [ ] **New functionality has tests**
- [ ] **DB tests use real Postgres** (not mocked)
- [ ] **Google API tests mock googleapis**
- [ ] **Edge cases covered** — error cases, empty inputs, boundaries
- [ ] **Tests pass locally**: `npm test`

### 5. Frontend Review (if applicable)

- [ ] **Components fetch from REST API**, not agent
- [ ] **Data panels auto-refetch** on `data_changed` WebSocket event
- [ ] **Tailwind + shadcn/ui** used (no custom CSS)
- [ ] **Loading states** handled

## After Review

If issues found:
1. List each issue with file:line reference
2. Explain why it's a problem
3. Suggest the fix
4. Prioritize: Critical → High → Medium → Low
