---
name: spec-driven-dev
description: Spec-driven development pipeline. Use when starting any new feature, bug fix, or significant change. Produces design and task specs from approved requirements.
disable-model-invocation: true
---

# Spec-Driven Development

STARTER_CHARACTER = 📋

When starting, announce: "📋 Using SPEC-DRIVEN-DEV skill"

All spec documents go to `specs/<issue-name>/`. Create the directory if it doesn't exist.

## Pre-check

Verify `requirements.md` exists in the spec folder and its Status is "Approved".
- If missing or not approved: **STOP** — "Approved requirements.md required. Run `/brainstorm → /synthesize → /review-spec requirements` first."

## Pipeline

```
requirements.md (input) → design.md → tasks.md
```

Each phase produces one document. Do not advance until the user confirms the current one.

## Phase 1 — Design (`design.md`)

Define how the feature will be built.

### Process

1. Read `requirements.md` for context
2. Research relevant architecture:
   - Backend: Routes → Queries → PostgreSQL (Drizzle)
   - MCP tools and REST routes share queries/connectors
   - Google connectors are thin wrappers around googleapis
   - Agent is text-only — writes data via tools, frontend renders from REST
3. Write `design.md` with the sections below
4. Present to user for confirmation before advancing

### Document Template

```markdown
# <Feature Name> — Design

> **Version:** 1.0
> **Date:** YYYY-MM-DD
> **Status:** Draft | Approved

## Technical Approach

High-level description of the solution. Which interaction path (agent chat, direct UI, or both)?

## Architecture Decisions

| Decision | Options Considered | Choice | Rationale |
|----------|-------------------|--------|-----------|
| ...      | ...               | ...    | ...       |

## Data Model

New or modified Drizzle schema tables/columns.

## API Design

### MCP Tools (if agent needs access)
Tool name, parameters, return type.

### REST Endpoints (if direct UI needs access)
Method, path, request/response shape, status codes.

### WebSocket Messages (if applicable)
New message types.

## Frontend Components

New or modified React components.

## Error Handling

Expected failure modes and how each is handled.
```

### Gate

Ask: "Design looks complete. Ready to break this into tasks?" Do not proceed until confirmed.

## Phase 2 — Tasks (`tasks.md`)

Break the design into implementable units.

### Process

1. Read `requirements.md` and `design.md` for context
2. Decompose into tasks sized for a single coding session
3. Write `tasks.md` with the sections below
4. Present to user for confirmation

### Document Template

```markdown
# <Feature Name> — Tasks

> **Version:** 1.0
> **Date:** YYYY-MM-DD
> **Status:** Draft | Approved

## Task 1: <Short Description>

**Files to change:** `src/...`, `src/...`
**Tests:** What to test and where
**Acceptance criteria:**
- [ ] Criterion 1
- [ ] Criterion 2
**Dependencies:** None | Task N
**Notes:** Any implementation hints

## Task 2: <Short Description>

...
```

### Task Sizing Rules

- One task = one coding session
- Each task produces a working, testable increment
- If a task touches more than 5 files, split it
- If you can't describe the task in 2-3 sentences, split it

## Anti-Patterns

- **Over-designing**: Design should answer "how" at the level needed to write tasks, not specify every line of code
- **Mega-tasks**: A task that takes multiple sessions is too big — split it
- **Coding before tasks.md**: Writing code without a task list leads to scope drift and missed edge cases
