---
name: deviation
description: Log implementation deviations from spec. Usage: /deviation "changed X because Y"
disable-model-invocation: true
---

# Deviation

Log implementation deviations from spec.

**Usage:** `/deviation "changed X because Y"`

Use during implementation when you diverge from the design or tasks.

## Dependency Check

Before anything else, verify the spec folder exists:
- Look for `specs/{issue}/` where `{issue}` matches the current work context
- If no spec folder found: **STOP** and tell the user: "No spec folder found. Run `/new-issue {name}` first."

## Process

### Step 1: Parse Argument

Read the argument passed with the invocation:
- `/deviation "changed X because Y"` — use the quoted text as the deviation description
- If no argument provided, ask: "What deviated from the spec?"

### Step 2: Ensure deviations.md Exists

- Check if `deviations.md` exists in the spec folder
- If not, copy from `specs/_templates/deviations.md`

### Step 3: Determine Next ID

- Scan existing entries in `deviations.md` for DEV-NNN IDs
- Increment to get next ID (or start at DEV-001)

### Step 4: Gather Details

Prompt the user for:
1. **Task reference:** Which task does this relate to? (e.g., "Task 3" or "general")
2. **Spec text:** What did the spec say? (Agent can look this up in `design.md` or `tasks.md` and suggest)
3. **Spec update needed:** Does the spec need updating? (yes/no)

### Step 5: Append Entry

Append a structured entry to `deviations.md`:

```markdown
## DEV-NNN: [Short Description]

**Task:** [task reference]
**Date:** [today's date]
**Impact:** [low/medium/high — agent suggests based on scope]

**Spec said:**
[what the spec specified]

**Actual implementation:**
[what was actually done]

**Reason:**
[why the deviation occurred]

**Spec update needed:** [yes/no]
```

Also update the summary table at the top of `deviations.md`:

```markdown
| DEV-NNN | [impact] | [yes/no] |
```

### Step 6: Confirm

- Announce: "Deviation DEV-NNN logged."
- If spec update is needed, suggest: "Remember to update the spec when this is resolved."
