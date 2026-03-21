---
name: new-issue
description: Create a spec folder structure for a new issue/feature/bug. Usage: /new-issue {issue-name}
disable-model-invocation: true
---

# New Issue

Create a spec folder structure for a new issue/feature/bug.

**Usage:** `/new-issue {issue-name}`

Examples:
- `/new-issue add-bucket-templates`
- `/new-issue fix-websocket-reconnect`
- `/new-issue refactor-google-connectors`

## What Gets Created

```
specs/{issue-name}/
├── brainstorm/
│   └── chunks/
├── requirements.md
├── design.md
├── tasks.md
├── sessions/
└── qa_debug_sessions/
```

## Workflow

### Step 1: Validate Issue Name

- Must be lowercase
- Must use hyphens (no spaces or underscores)
- Should be descriptive (3-7 words)

### Step 2: Create Directory Structure

```bash
mkdir -p specs/{issue-name}/sessions
mkdir -p specs/{issue-name}/qa_debug_sessions
mkdir -p specs/{issue-name}/brainstorm/chunks
```

### Step 3: Copy Templates

Copy from `specs/_templates/`:

```bash
cp specs/_templates/requirements.md specs/{issue-name}/
cp specs/_templates/design.md specs/{issue-name}/
cp specs/_templates/tasks.md specs/{issue-name}/
```

### Step 4: Update Template Placeholders

Replace placeholders in each file:
- `{FEATURE_NAME}` → Title-cased issue name
- `{DATE}` → Today's date (YYYY-MM-DD)

### Step 5: Confirm Creation

Output:

```
Created spec folder: specs/{issue-name}/

Next steps:
1. Fill in requirements.md with problem statement and acceptance criteria
2. Use /brainstorm for exploration or /spec-driven-dev for structured planning
3. Sessions will auto-save to sessions/
```

## Naming Conventions

| Pattern | Example | Use Case |
|---------|---------|----------|
| `add-{desc}` | `add-contact-export` | New feature |
| `fix-{desc}` | `fix-login-timeout` | Bug fix |
| `refactor-{desc}` | `refactor-query-layer` | Code refactoring |
| `update-{desc}` | `update-email-templates` | Enhancement |
