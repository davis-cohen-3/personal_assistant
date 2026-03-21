---
name: save-history
description: Save conversation summary for context in future sessions. Use at ~70% context usage or before starting a new chat.
disable-model-invocation: true
---

# Save Session History

Save conversation summary for context in future sessions.

**When to use:** At ~70% context usage, before starting a new chat.

## Session Types

| Type | Folder | Use Case |
|------|--------|----------|
| `sessions/` | `specs/{issue}/sessions/` | Implementation work, spec-driven development |
| `qa_debug_sessions/` | `specs/{issue}/qa_debug_sessions/` | QA testing, debugging, manual testing sessions |

**How to choose:**
- Use `sessions/` for normal implementation work following requirements/design/tasks
- Use `qa_debug_sessions/` for debugging sessions, QA testing, production issues

## Workflow

### Step 1: Identify Current Issue and Session Type

1. Check current git branch:
   ```bash
   git branch --show-current
   ```

2. Find matching `specs/{branch-name}/` folder
   - If exists, use that folder
   - If no match, use `specs/_general/`

3. Determine session type:
   - If argument contains `qa_debug` → use `qa_debug_sessions/`
   - If session was QA/debugging focused → use `qa_debug_sessions/`
   - Otherwise → use `sessions/`

### Step 2: Determine Session Number

```bash
ls specs/{issue}/{session_type}/ 2>/dev/null | tail -1
```

Next session = highest number + 1 (start at 001)

### Step 3: Create Session File

Create `specs/{issue}/{session_type}/{NNN}_{summary}.md`:

- `{NNN}` = session number (001, 002, 003...)
- `{summary}` = 3-5 word description (lowercase, hyphens)

Examples:
- `specs/add-bucket-templates/sessions/002_implement-rest-endpoints.md`
- `specs/fix-websocket-reconnect/qa_debug_sessions/001_connection-timeout-fixes.md`

### Step 4: Write Summary

```markdown
# Session: {Brief Summary}

**Date:** YYYY-MM-DD
**Branch:** {branch-name}

## Summary

[2-3 sentences: what was accomplished this session]

## Key Decisions

- Decision 1: Why we chose X over Y
- Decision 2: Approach for handling Z

## Code Changes

- Created: `src/server/db/schema.ts`
- Modified: `src/server/routes.ts`

## Open Questions

- Unresolved question for next session

## Next Steps

- [ ] Task still pending
- [ ] Follow-up work needed
```

## What to Include

- High-level summary of work done
- Key decisions and rationale
- File paths changed (not code snippets)
- Open questions and blockers
- Next steps for continuation

## What NOT to Include

- Full code snippets
- Verbose debugging logs
- Back-and-forth conversation details
- Intermediate failed attempts

## Loading Context in Future Sessions

At start of new session on same issue:

1. Read latest session file in `specs/{issue}/sessions/`
2. Read `specs/{issue}/requirements.md`, `design.md`, `tasks.md` if they exist
3. Continue work with full context
