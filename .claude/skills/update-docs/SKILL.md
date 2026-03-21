---
name: update-docs
description: Update project documentation after a significant code addition or change. Usage: /update-docs {what changed}
disable-model-invocation: true
---

# Update Documentation

Update project documentation after a significant code addition or change.

## Instructions

### Step 1: Identify What Changed

If no argument was provided, check recent git changes:
```bash
git diff --stat main...HEAD
```

Understand:
- **What was added?** (new feature, new module, new endpoint, etc.)
- **What domain?** (buckets, people, gmail, calendar, agent, etc.)
- **What type?** (REST route, MCP tool, query function, component, etc.)
- **Breaking changes?** (API changes, schema changes, config changes)

### Step 2: Determine Which Docs Need Updates

| Change Type | Documentation to Update |
|-------------|------------------------|
| **New REST endpoint** | `agent_docs/backend-patterns.md` (if new patterns) |
| **New MCP tool** | `agent_docs/backend-patterns.md` (tools section) |
| **New domain/module** | `CLAUDE.md` (architecture table if new system) |
| **Database schema** | `agent_docs/backend-patterns.md` (Drizzle section) |
| **New query patterns** | `agent_docs/backend-patterns.md` |
| **Testing changes** | `agent_docs/testing.md` |
| **New linter/hook** | `agent_docs/code-quality.md` |
| **Frontend changes** | Add `agent_docs/frontend-patterns.md` if needed |
| **WebSocket changes** | `agent_docs/backend-patterns.md` (protocol section) |
| **Build/deploy changes** | `CLAUDE.md` (build section) |
| **New skill/command** | `CLAUDE.md` (workflow section if pipeline changed) |

### Step 3: Read Current Documentation

Read the relevant files to understand current structure and style before making changes.

**Coding guides** (agent reads these when writing code):
- `CLAUDE.md` — architecture, code style, workflow
- `agent_docs/code-quality.md` — anti-patterns, fail-fast rules
- `agent_docs/backend-patterns.md` — routes, queries, connectors, tools
- `agent_docs/testing.md` — test types, fixtures, patterns

### Step 4: Update Documentation

- Match the existing style and structure of each file
- Keep updates minimal — only document what changed
- Prefer updating existing sections over adding new ones
- Don't add boilerplate or filler text

### Step 5: Verify Consistency

- [ ] File paths in docs match actual codebase
- [ ] Code examples are accurate
- [ ] No contradictions between different docs
