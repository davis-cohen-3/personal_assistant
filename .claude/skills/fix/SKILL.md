---
name: fix
description: Debug and fix a specific bug or error. Use when investigating errors, test failures, or unexpected behavior.
disable-model-invocation: true
---

# Fix Bug or Error

STARTER_CHARACTER = 🔧

**Usage:** `/fix <error message or bug description>`

## Debugging Workflow

### Step 1: Parse the Error

Analyze the error message or bug description:
- What type of error? (TypeScript error, HTTP error, runtime error)
- What component is affected? (API route, MCP tool, Google connector, frontend, DB)
- Is there a file path or line number mentioned?

### Step 2: Check Server Logs

**CRITICAL: Always check logs first!**

```bash
# For dev server issues
tail -100 logs/server.log

# Search for errors
grep -i "error\|exception\|throw" logs/server.log | tail -50
```

Look for:
- Full stack trace with file:line references
- Timestamp of when error occurred
- Related HTTP requests (method, path, status)
- Database errors (Drizzle, Postgres)

### Step 3: Search Codebase

Find related files based on error context:

```bash
# Search for error text in source
grep -r "error message text" src/

# Search for function names from stack trace
grep -r "function_name" src/
```

### Step 4: Trace the Code Path

1. Start from the entry point (REST route, MCP tool, WebSocket handler)
2. Follow the call chain: Route/Tool → Query/Connector
3. Identify where the error originates
4. Check related code for context

### Step 5: Identify Root Cause

Common causes:
- **Missing `await`** on async methods
- **Wrong method name** (verify actual method exists)
- **Type mismatch** (expecting different shape)
- **Schema mismatch** (Drizzle schema vs actual DB — migration not run)
- **Missing validation** (null/empty values)
- **Google API auth** (token expired, scopes insufficient)
- **WebSocket format** (message type mismatch between client/server)

### Step 6: Propose Fix

Before implementing:
1. Explain what caused the error
2. Describe the fix approach
3. Identify files that need changes
4. Consider if tests need updating

### Step 7: Verify Fix

After implementing:
1. Reproduce the original error — confirm it's fixed
2. Run related tests: `npm test -- --grep "relevant"`
3. Check for regressions in related functionality

## Common Error Patterns

| Error Pattern | Likely Cause | Where to Look |
|---------------|--------------|---------------|
| `TypeError: X is not a function` | Wrong import or method name | Check exports |
| `TypeError: Cannot read properties of undefined` | Null/missing data | Check query result |
| `Error: connect ECONNREFUSED` | DB not running | docker-compose |
| `NotFoundError` | Missing record | Check ID, migration |
| `401 Unauthorized` | JWT/OAuth issue | auth.ts, kv_store |
| `Google API 403` | Scopes or quota | OAuth consent, quotas |
| `Drizzle: relation does not exist` | Migration not run | drizzle-kit migrate |
| `WebSocket closed` | Agent/server error | agent.ts, tools.ts |

## Architecture Reminders

When fixing bugs, remember:
- **Routes** are thin — delegate to query functions and connectors
- **MCP tools** share the same queries/connectors as REST routes
- **Google connectors** are thin wrappers — no business logic
- **No fallbacks** — fail fast with clear errors
- **No exception swallowing** — handle or re-throw
