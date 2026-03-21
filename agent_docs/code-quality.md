# Code Quality Guidelines

These rules apply to ALL TypeScript code changes. Violations cause bugs that are hard to debug.

## Verify Before Coding

**CRITICAL: Verify before making changes:**
- **CHECK method names**: Verify actual method names before calling them
- **CHECK signatures**: Verify if methods are async or sync
- **CHECK imports**: Ensure modules are imported before use
- **READ error messages**: They often suggest the fix
- **USE grep/read first**: Before assuming an API, search for its definition

## No Fallbacks or Backward Compatibility

- **NEVER add fallbacks, defaults, or backward compatibility unless explicitly requested**
- **Choose ONE implementation approach, not multiple options**
- **Let code fail fast with clear errors instead of silently falling back**
- **If a required config value is missing, throw an error — do NOT provide a default**

## Dangerous Patterns to Avoid

### Nullish coalescing with defaults

```typescript
// WRONG — masks missing config
const value = config.get('key') ?? 'default';
const items = result?.data ?? [];

// CORRECT — fail fast
const value = config.get('key');
if (!value) throw new Error('Missing config: key');
```

### Swallowed exceptions

**This is the most dangerous pattern — it hides real problems and makes debugging impossible.**

```typescript
// WRONG — silently ignores errors
try { await doThing(); } catch {}

// WRONG — returns default that masks failure
try {
  return await fetchData();
} catch {
  return [];  // Caller thinks operation succeeded
}

// WRONG — logs but continues as if nothing happened
try {
  await configureDatabase();
} catch (err) {
  console.error('DB config failed', { error: err });
  // Code continues but database is broken!
}

// CORRECT — re-throw with context
try {
  await doThing();
} catch (err) {
  throw new AppError('doThing failed', { cause: err });
}
```

### `any` types

```typescript
// WRONG — bypasses type system
const data: any = await response.json();
const value = foo as any;

// CORRECT — use unknown and narrow
const data: unknown = await response.json();
if (isValidResponse(data)) {
  // now data is typed
}
```

## Architecture Rules

**Routes are thin:** validate input, call query/connector, return response.

```typescript
// WRONG — business logic in route
app.get('/api/buckets', async (c) => {
  const buckets = await db.select().from(schema.buckets);
  const sorted = buckets.sort((a, b) => a.sortOrder - b.sortOrder);
  const withCounts = sorted.map(b => ({ ...b, threadCount: ... }));
  return c.json(withCounts);
});

// CORRECT — delegate to query function
app.get('/api/buckets', async (c) => {
  const buckets = await getBucketsWithThreads();
  return c.json(buckets);
});
```

**MCP tools and REST routes share code.** Both call the same query functions and Google connectors. Don't duplicate logic.

**Google connectors are thin wrappers.** They translate between our types and the googleapis SDK. No business logic.

## Async Rules

- All I/O is `async/await`
- No fire-and-forget promises (no missing `await`)
- Use `Promise.all()` for independent concurrent operations

## Security: Error Handling

**NEVER include internal error details in user-facing responses.**

```typescript
// WRONG — leaks internals
return c.json({ error: err.message }, 500);

// CORRECT — generic message, log details server-side
console.error('Failed to fetch threads', { error: err });
return c.json({ error: 'Failed to fetch threads' }, 500);
```

## Comments

- Prefer self-documenting code over comments
- If code needs a comment to be understood, consider refactoring first
- Never add decorative comments, section dividers, or redundant explanations
- No commented-out code — delete it (git has history)

## Logging

Use `console.error` and `console.warn` for server-side logging. Railway captures stdout/stderr natively.

```typescript
// CORRECT — structured context via second arg
console.error('Failed to send email', { threadId, error });
console.warn('Validation failed', { issues: err.issues });

// WRONG — console.log for debug noise
console.log('bucket created');
console.log(data);
```

Avoid `console.log` — reserve it for temporary debugging only (and remove before committing). Use `console.error` for errors, `console.warn` for warnings and general operational logging.
