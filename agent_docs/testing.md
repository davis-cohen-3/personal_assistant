# Testing Guide

## Which Test Type?

| What you're testing | Type | Location | DB |
|---------------------|------|----------|----|
| Query functions | Integration | `tests/integration/db/` | Real Postgres |
| Tenant isolation | Integration | `tests/integration/db/` | Real Postgres |
| Google connectors | Unit (mocked) | `tests/unit/google/` | Mocked googleapis |
| MCP tool handlers | Unit (mocked) | `tests/unit/tools.test.ts` | Mocked |
| REST routes | Unit (mocked) | `tests/unit/routes.test.ts` | Mocked |
| Agent / streaming | Unit (mocked) | `tests/unit/agent.test.ts` | Mocked |
| Auth / crypto | Unit | `tests/unit/auth.test.ts`, `tests/unit/crypto.test.ts` | N/A |

**Rule of thumb:** If it touches the database, use integration tests with real DB. If it calls external APIs, mock them.

## Test Runner

Vitest with globals enabled. Config in `vitest.config.ts`:

```typescript
{
  globals: true,           // describe/it/expect available globally
  environment: 'node',
  include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
  setupFiles: ['tests/setup.ts'],
  fileParallelism: false,  // sequential execution
}
```

## Integration Tests (DB Queries)

Use real Postgres. Create a test user in `beforeEach`, clean up with `cleanDatabase()`.

```typescript
import { db, pool } from '../../../src/server/db/index.js';
import { upsertUser, createBucket, listBuckets } from '../../../src/server/db/queries.js';

let testUserId: string;

beforeEach(async () => {
  await cleanDatabase();
  const user = await upsertUser('test@example.com', 'Test User');
  testUserId = user.id;
});

afterAll(async () => {
  await pool.end();
});

describe('listBuckets', () => {
  it('returns empty array when no buckets exist', async () => {
    const buckets = await listBuckets(testUserId);
    expect(buckets).toEqual([]);
  });

  it('returns buckets ordered by sort_order', async () => {
    await createBucket(testUserId, 'B', 'Second');
    await createBucket(testUserId, 'A', 'First');

    const buckets = await listBuckets(testUserId);
    expect(buckets[0].name).toBe('A');
    expect(buckets[1].name).toBe('B');
  });
});
```

## Route Tests (Mocked)

Mock all dependencies. Create a test app with middleware that injects `userId`.

```typescript
const { mockEmailSearch } = vi.hoisted(() => ({ mockEmailSearch: vi.fn() }));

vi.mock('../../src/server/email.js', () => ({
  search: mockEmailSearch,
}));

function createTestApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', TEST_USER_ID);
    await next();
  });
  app.route('/api', apiRoutes);
  return app;
}

describe('GET /api/gmail/threads', () => {
  it('returns 200 with threads array', async () => {
    mockEmailSearch.mockResolvedValue([{ id: 't1' }]);

    const res = await app.request('/api/gmail/threads');

    expect(res.status).toBe(200);
    expect(mockEmailSearch).toHaveBeenCalledWith(TEST_USER_ID, 'is:inbox', 25);
  });
});
```

## MCP Tool Handler Tests (Mocked)

Call `handlers.toolName(userId, params)` directly. Check `.content[0].text` (JSON string) and `.isError`.

```typescript
describe('buckets tool', () => {
  it('calls queries.listBuckets() and returns JSON', async () => {
    mockListBuckets.mockResolvedValue([{ id: 'b1', name: 'Inbox' }]);

    const result = await handlers.buckets(TEST_USER_ID, { action: 'list' });

    expect(mockListBuckets).toHaveBeenCalledWith(TEST_USER_ID);
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: 'b1', name: 'Inbox' }]);
  });

  it('returns error dict when missing params', async () => {
    const result = await handlers.buckets(TEST_USER_ID, { action: 'assign' });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toMatch(/assignments is required/);
  });
});
```

## Google Connector Tests (Mocked)

Mock the googleapis SDK deeply. Connectors take `OAuth2Client`, not `userId`.

```typescript
const mockMessagesGet = vi.fn();
vi.mock('googleapis', () => ({
  google: {
    gmail: vi.fn(() => ({
      users: {
        messages: { get: mockMessagesGet },
      },
    })),
  },
}));

const mockAuth = {} as never;

describe('getMessage', () => {
  it('returns parsed message', async () => {
    mockMessagesGet.mockResolvedValue({ data: { id: 'msg-1', payload: { ... } } });

    const msg = await getMessage(mockAuth, 'msg-1');

    expect(msg.id).toBe('msg-1');
  });
});
```

## Exception Testing

```typescript
it('throws AppError for nonexistent bucket', async () => {
  await expect(updateBucket(testUserId, 'nonexistent-id', { name: 'X' }))
    .rejects.toBeInstanceOf(AppError);
});
```

## Anti-Patterns

```typescript
// ❌ Fallback that hides failures
const bucket = await getBucketTemplate('invalid') ?? testBucket;

// ✅ Assert the exception
await expect(updateBucket(userId, 'invalid', {})).rejects.toBeInstanceOf(AppError);

// ❌ Mocking DB in integration tests
vi.mock('../db/queries');

// ✅ Integration tests use real DB
const result = await listBuckets(testUserId);

// ❌ Testing implementation details
expect(db.select).toHaveBeenCalledWith(/* SQL */);

// ✅ Testing behavior
const buckets = await listBuckets(testUserId);
expect(buckets[0].name).toBe('Important');

// ❌ Forgetting userId
await createBucket('My Bucket', 'desc');

// ✅ Always pass userId first
await createBucket(testUserId, 'My Bucket', 'desc');
```

## Running Tests

```bash
pnpm test                                # All tests
pnpm test -- --grep "buckets"            # Pattern match
pnpm test -- tests/integration/db/       # Specific directory
pnpm test:watch                          # Watch mode
pnpm test:coverage                       # With coverage
```
