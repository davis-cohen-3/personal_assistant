# Testing Guide

## Which Test Type?

| What you're testing | Type | Location | DB |
|---------------------|------|----------|----|
| Query functions | Integration | `tests/integration/db/` | Real Postgres |
| Google connectors | Unit (mocked) | `tests/unit/google/` | Mocked googleapis |
| MCP tool handlers | Unit (mocked) | `tests/unit/tools.test.ts` | Mocked |
| REST routes | Unit (mocked) | `tests/unit/routes.test.ts` | Mocked |
| Agent / streaming | Unit (mocked) | `tests/unit/agent.test.ts` | Mocked |
| Auth / crypto | Unit | `tests/unit/auth.test.ts`, `tests/unit/crypto.test.ts` | N/A |

**Rule of thumb:** If it touches the database, use integration tests with real DB. If it calls external APIs, mock them.

## Test Structure

Group by behavior. Use descriptive names.

```typescript
describe('getBuckets', () => {
  it('returns empty array when no buckets exist', async () => {
    const buckets = await getBuckets();

    expect(buckets).toEqual([]);
  });

  it('returns buckets ordered by sort_order', async () => {
    await createBucket({ name: 'B', sortOrder: 2, description: 'Second' });
    await createBucket({ name: 'A', sortOrder: 1, description: 'First' });

    const buckets = await getBuckets();

    expect(buckets[0].name).toBe('A');
    expect(buckets[1].name).toBe('B');
  });
});
```

## Route Tests

Mock queries and connectors. Test HTTP layer (status codes, validation, response shape).

```typescript
describe('GET /api/buckets', () => {
  it('returns 200 with buckets', async () => {
    const res = await app.request('/api/buckets', {
      headers: { Cookie: testSessionCookie },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns 401 without session', async () => {
    const res = await app.request('/api/buckets');

    expect(res.status).toBe(401);
  });
});
```

## Google Connector Tests (Mocked)

Mock the googleapis SDK. Test our wrapper logic.

```typescript
vi.mock('googleapis');

describe('listThreads', () => {
  it('passes query and maxResults to Gmail API', async () => {
    mockGmail.users.threads.list.mockResolvedValue({
      data: { threads: [{ id: '123' }] },
    });

    const result = await listThreads({ query: 'is:unread', maxResults: 10 });

    expect(mockGmail.users.threads.list).toHaveBeenCalledWith({
      userId: 'me',
      q: 'is:unread',
      maxResults: 10,
    });
    expect(result).toHaveLength(1);
  });
});
```

## Exception Testing

```typescript
it('throws NotFoundError for nonexistent bucket', async () => {
  await expect(updateBucket('nonexistent-id', { name: 'X' }))
    .rejects.toThrow(NotFoundError);
});

it('throws ValidationError for empty name', async () => {
  await expect(createBucket({ name: '', description: 'test', sortOrder: 1 }))
    .rejects.toThrow(ValidationError);
});
```

## Anti-Patterns

```typescript
// ❌ Fallback that hides failures
const bucket = await getBucket('invalid') ?? testBucket;

// ✅ Assert the exception
await expect(getBucket('invalid')).rejects.toThrow(NotFoundError);

// ❌ Mocking DB in integration tests
vi.mock('../db/queries');

// ✅ Integration tests use real DB
const result = await getBuckets();

// ❌ Testing implementation details
expect(db.select).toHaveBeenCalledWith(/* SQL */);

// ✅ Testing behavior
const buckets = await getBuckets();
expect(buckets[0].name).toBe('Important');
```

## Running Tests

```bash
pnpm test                                # All tests
pnpm test -- --grep "buckets"            # Pattern match
pnpm test -- tests/integration/db/       # Specific directory
```
