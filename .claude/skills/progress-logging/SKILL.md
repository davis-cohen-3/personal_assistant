---
name: progress-logging
description: Per-feature progress logging at specs/{feature-name}/progress_log.md. Use at end of coding sessions.
disable-model-invocation: true
---

# Progress Logging

Per-feature progress logging at `specs/{feature-name}/progress_log.md`.

**Usage:** `/progress-logging`

Use at the end of every coding session to record what was done, decisions made, and open questions.

## When to Write

Write an entry at the **end** of every coding session on a feature. Never before work — only after.

## When to Read

At the **start** of a new session on a feature, read the progress log first to pick up context.

## Log Format

Each entry is appended to the bottom of the file. Never edit previous entries.

### File Header (first entry only)

```markdown
# <Feature Name> — Progress Log
```

### Entry Template

```markdown
---

## YYYY-MM-DD — <Brief Summary>

**Decisions made:**
- Decision and why

**Files changed:**
- `path/to/file` — what changed

**Blockers / Questions:**
- Open items that need resolution
```

## Rules

1. **Write after work, not before** — log what actually happened, not what you plan to do
2. **Never edit previous entries** — the log is append-only, mistakes get corrected in new entries
3. **Omit empty sections** — if no blockers exist, don't include the Blockers section
4. **Keep entries under 15 lines** — be concise; this is a log, not documentation
5. **One entry per session** — don't split a session into multiple entries
6. **Use file paths** — always reference changed files by their path, not by description

## Starting a New Session

When picking up work on an existing feature:

1. Read `specs/{feature-name}/progress_log.md`
2. Read the most recent entry carefully for blockers and open questions
3. If a `tasks.md` exists, check which tasks are complete
4. Announce what you're picking up and any unresolved items from last session
