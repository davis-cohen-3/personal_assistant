---
name: save-history
description: Save conversation summary for context in future sessions. Use at ~70% context usage or before starting a new chat.
disable-model-invocation: true
---

# Save Session History

Save conversation summary for context in future sessions.

**When to use:** At ~70% context usage, before starting a new chat.

## Workflow

### Step 1: Identify Current Phase

1. Determine which implementation phase is active based on the work done this session
   - Phase numbers match `implementation_phases/phase{N}/`
   - If unsure, check recent files changed or ask

2. Create the sessions directory if needed:
   ```bash
   mkdir -p implementation_phases/phase{N}/sessions/
   ```

### Step 2: Determine Session Number

```bash
ls implementation_phases/phase{N}/sessions/ 2>/dev/null | tail -1
```

Next session = highest number + 1 (start at 001)

### Step 3: Create Session File

Create `implementation_phases/phase{N}/sessions/{NNN}_{summary}.md`:

- `{NNN}` = session number (001, 002, 003...)
- `{summary}` = 3-5 word description (lowercase, hyphens)

Examples:
- `implementation_phases/phase1/sessions/001_scaffolding-and-configs.md`
- `implementation_phases/phase2/sessions/002_query-functions-tests.md`

### Step 4: Write Summary

```markdown
# Session: {Brief Summary}

**Date:** YYYY-MM-DD
**Phase:** {N} — {Phase Name}

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

At start of new session on same phase:

1. Read latest session file in `implementation_phases/phase{N}/sessions/`
2. Read `implementation_phases/phase{N}/completion_report.md` if it exists
3. Read `project/implementation_plan.md` for the phase's task list
4. Continue work with full context
