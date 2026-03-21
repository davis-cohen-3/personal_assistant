# Dev Tooling

## Overview

Biome for linting and formatting. Three custom architecture linters. Vitest for unit testing. Lint-staged + Husky for pre-commit hooks. GitHub Actions for CI on pull requests.

---

## Linting & Formatting: Biome

Single tool replacing ESLint + Prettier. Fast, zero-config defaults, TypeScript-native.

```bash
pnpm add -D @biomejs/biome
npx @biomejs/biome init
```

```jsonc
// biome.json
{
  "$schema": "https://biomejs.dev/schemas/2.0.x/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "files": {
    "ignore": ["dist/", "node_modules/", "*.gen.ts"]
  }
}
```

```jsonc
// package.json scripts
{
  "lint": "biome check src/",
  "lint:fix": "biome check --fix src/",
  "format": "biome format --write src/"
}
```

---

## Git Hooks: Husky + lint-staged

Runs Biome on staged files before every commit.

```bash
pnpm add -D husky lint-staged
npx husky init
```

```jsonc
// package.json
{
  "lint-staged": {
    "*.{ts,tsx,js,json}": ["biome check --fix --no-errors-on-unmatched"]
  }
}
```

```bash
# .husky/pre-commit
npx lint-staged
```

---

## Custom Architecture Linters

Three lightweight TypeScript scripts in `scripts/` that enforce architectural boundaries. Run via `pnpm run lint:arch`. Regex-based (no AST) — simple, fast, easy to maintain.

### 1. Module Boundaries (`scripts/lint_module_boundaries.ts`)

Enforces dependency direction between layers. Prevents architectural erosion.

**Rules:**
- `google/*` connectors must NOT import from `db/`, `routes.ts`, `agent.ts`, `tools.ts`, or `email.ts` — connectors are infrastructure, not application logic
- `db/*` must NOT import from `google/`, `routes.ts`, `agent.ts`, or `tools.ts` — the data layer is a leaf dependency
- `tools.ts` must only import from `db/queries` and `google/*` — not from `routes.ts` or `agent.ts`
- `routes.ts` must NOT import from `tools.ts` or `agent.ts` — routes and tools are peers that share queries and connectors

```typescript
// scripts/lint_module_boundaries.ts
import fs from 'fs';
import path from 'path';

const SRC = path.resolve('src/server');

interface Rule {
  /** Glob-like path prefix within src/server/ */
  files: string;
  /** Import paths that are forbidden in those files */
  forbiddenImports: string[];
  /** Human-readable reason */
  reason: string;
}

const RULES: Rule[] = [
  {
    files: 'google/',
    forbiddenImports: ['./db', '../db', './routes', '../routes', './agent', '../agent', './tools', '../tools', './email', '../email'],
    reason: 'Connectors are infrastructure — they must not import application logic or data layer',
  },
  {
    files: 'db/',
    forbiddenImports: ['./google', '../google', './routes', '../routes', './agent', '../agent', './tools', '../tools'],
    reason: 'Data layer must not import connectors, routes, or application logic',
  },
  {
    files: 'tools.ts',
    forbiddenImports: ['./routes', '../routes', './agent', '../agent'],
    reason: 'Tool handlers should only use db/queries and google/* connectors',
  },
  {
    files: 'routes.ts',
    forbiddenImports: ['./tools', '../tools', './agent', '../agent'],
    reason: 'Routes are peers with tools — neither should depend on the other',
  },
];

function lint(): number {
  let violations = 0;

  for (const rule of RULES) {
    const target = path.join(SRC, rule.files);
    const files = fs.statSync(target).isDirectory()
      ? fs.readdirSync(target, { recursive: true })
          .filter((f): f is string => typeof f === 'string' && f.endsWith('.ts'))
          .map(f => path.join(target, f))
      : [target];

    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        if (!line.match(/^\s*(import|from)\s/)) return;
        for (const forbidden of rule.forbiddenImports) {
          if (line.includes(forbidden)) {
            console.error(`${file}:${i + 1}: forbidden import "${forbidden}" — ${rule.reason}`);
            violations++;
          }
        }
      });
    }
  }

  return violations;
}

process.exit(lint() > 0 ? 1 : 0);
```

### 2. Queries Only in DB Layer (`scripts/lint_db_encapsulation.ts`)

All Drizzle query operations must live in `src/server/db/`. No raw `db.select()`, `db.insert()`, `db.update()`, `db.delete()` calls in routes, tools, or connectors.

```typescript
// scripts/lint_db_encapsulation.ts
import fs from 'fs';
import path from 'path';

const SRC = path.resolve('src/server');
const ALLOWED_DIR = path.join(SRC, 'db');

// Drizzle query patterns
const DB_PATTERNS = [
  /\bdb\.(select|insert|update|delete)\b/,
  /\bdb\.query\b/,
  /from\s*\(\s*schema\./,
];

function lint(): number {
  let violations = 0;

  const files = getAllTsFiles(SRC).filter(f => !f.startsWith(ALLOWED_DIR));

  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    lines.forEach((line, i) => {
      if (line.includes('// lint-ignore')) return;
      for (const pattern of DB_PATTERNS) {
        if (pattern.test(line)) {
          console.error(`${file}:${i + 1}: direct DB query outside db/ layer — use db/queries.ts instead`);
          violations++;
        }
      }
    });
  }

  return violations;
}

function getAllTsFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap(e =>
    e.isDirectory() ? getAllTsFiles(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []
  );
}

process.exit(lint() > 0 ? 1 : 0);
```

### 3. Async Hygiene (`scripts/lint_async_hygiene.ts`)

Catches blocking calls inside async functions — these freeze the Node.js event loop.

**Detects:**
- `fs.readFileSync`, `fs.writeFileSync`, `fs.existsSync` (use `fs.promises.*` instead)
- `child_process.execSync`, `child_process.spawnSync`
- `Atomics.wait`

```typescript
// scripts/lint_async_hygiene.ts
// Note: This script intentionally uses fs.readFileSync/readdirSync — it's a top-level
// CLI script, not async server code. The linter only scans src/server/, not scripts/.
import fs from 'fs';
import path from 'path';

const SRC = path.resolve('src/server');

const BLOCKING_CALLS = [
  { pattern: /\breadFileSync\b/, fix: 'fs.promises.readFile' },
  { pattern: /\bwriteFileSync\b/, fix: 'fs.promises.writeFile' },
  { pattern: /\bexistsSync\b/, fix: 'fs.promises.access' },
  { pattern: /\bmkdirSync\b/, fix: 'fs.promises.mkdir' },
  { pattern: /\bexecSync\b/, fix: 'child_process.exec (promisified)' },
  { pattern: /\bspawnSync\b/, fix: 'child_process.spawn' },
  { pattern: /\bAtomics\.wait\b/, fix: 'Atomics.waitAsync' },
];

function lint(): number {
  let violations = 0;

  for (const file of getAllTsFiles(SRC)) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, i) => {
      if (line.includes('// lint-ignore')) return;
      for (const { pattern, fix } of BLOCKING_CALLS) {
        if (pattern.test(line)) {
          console.error(`${file}:${i + 1}: blocking call in server code — use ${fix} instead`);
          violations++;
        }
      }
    });
  }

  return violations;
}

function getAllTsFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap(e =>
    e.isDirectory() ? getAllTsFiles(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []
  );
}

process.exit(lint() > 0 ? 1 : 0);
```

### Running Custom Linters

```jsonc
// package.json scripts
{
  "lint:arch": "tsx scripts/lint_module_boundaries.ts && tsx scripts/lint_db_encapsulation.ts && tsx scripts/lint_async_hygiene.ts"
}
```

All three run in CI alongside Biome and typecheck. Support `// lint-ignore` comments for intentional exceptions.

---

## Testing: Vitest

### Stack

| Package | Purpose |
|---|---|
| `vitest` | Test runner — shares Vite config, native TypeScript, fast |

```bash
pnpm add -D vitest
```

### Config

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
```

### What to Test

Unit tests cover pure logic with mocked dependencies. No real DB, no real Google APIs.

#### 1. Google Connector Parsing (`tests/unit/google/gmail.test.ts`)

The parsing/normalization functions that transform raw Google API responses into app-level types. These are pure functions — easy to test, high value.

```typescript
import { describe, it, expect } from 'vitest';
import { parseThread, parseMessage } from '../../../src/server/google/gmail';

describe('parseThread', () => {
  it('decodes base64url message bodies', () => {
    const raw = {
      id: 'thread_1',
      messages: [{
        id: 'msg_1',
        payload: {
          headers: [
            { name: 'From', value: 'dan@example.com' },
            { name: 'Subject', value: 'Hello' },
          ],
          body: { data: 'SGVsbG8gd29ybGQ' }, // "Hello world"
        },
      }],
    };
    const parsed = parseThread(raw);
    expect(parsed.messages[0].body).toBe('Hello world');
    expect(parsed.messages[0].from).toBe('dan@example.com');
  });

  it('handles multipart messages', () => {
    // ...
  });
});
```

```typescript
// tests/unit/google/calendar.test.ts
import { describe, it, expect } from 'vitest';
import { parseEvent } from '../../../src/server/google/calendar';

describe('parseEvent', () => {
  it('normalizes all-day events', () => {
    const raw = { id: 'evt_1', summary: 'Offsite', start: { date: '2026-03-21' }, end: { date: '2026-03-22' } };
    const parsed = parseEvent(raw);
    expect(parsed.allDay).toBe(true);
  });

  it('extracts attendee emails', () => {
    const raw = {
      id: 'evt_1',
      summary: 'Standup',
      start: { dateTime: '2026-03-21T09:00:00Z' },
      end: { dateTime: '2026-03-21T09:30:00Z' },
      attendees: [{ email: 'a@x.com' }, { email: 'b@x.com' }],
    };
    const parsed = parseEvent(raw);
    expect(parsed.attendees).toEqual(['a@x.com', 'b@x.com']);
  });
});
```

#### 2. MCP Tool Handlers (`tests/unit/tools.test.ts`)

Test parameter validation and mapping logic. Mock the DB query layer.

```typescript
import { describe, it, expect, vi } from 'vitest';
import * as queries from '../../src/server/db/queries';

vi.mock('../../src/server/db/queries');

describe('buckets handler', () => {
  it('routes list action to listBuckets', async () => {
    vi.mocked(queries.listBuckets).mockResolvedValue([]);
    const result = await handleBuckets({ action: 'list' });
    expect(queries.listBuckets).toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('routes create action with name and description', async () => {
    const mockBucket = { id: '1', name: 'Urgent', description: 'High priority' };
    vi.mocked(queries.createBucket).mockResolvedValue(mockBucket);

    const result = await handleBuckets({ action: 'create', name: 'Urgent', description: 'High priority' });
    expect(queries.createBucket).toHaveBeenCalledWith('Urgent', 'High priority');
    expect(result).toEqual(mockBucket);
  });
});

```

#### 3. REST Route Handlers (`tests/unit/routes.test.ts`)

Use Hono's built-in `app.request()` test client. Mock the DB and Google layers.

```typescript
import { describe, it, expect, vi } from 'vitest';
import * as queries from '../../src/server/db/queries';
import { app } from '../../src/server/index';

vi.mock('../../src/server/db/queries');

describe('GET /api/buckets', () => {
  it('returns buckets as JSON', async () => {
    vi.mocked(queries.listBucketsWithThreads).mockResolvedValue([
      { id: '1', name: 'Urgent', description: 'High priority', threads: [] },
    ]);

    const res = await app.request('/api/buckets');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('Urgent');
  });
});

describe('POST /api/buckets', () => {
  it('creates a bucket and returns it', async () => {
    const mockBucket = { id: '1', name: 'Urgent', description: 'High priority' };
    vi.mocked(queries.createBucket).mockResolvedValue(mockBucket);

    const res = await app.request('/api/buckets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Urgent', description: 'High priority' }),
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(mockBucket);
  });
});
```

**Auth bypass for tests:** Use a `createApp()` factory function that accepts an optional `skipAuth` parameter. The production entry point calls `createApp()` (auth enabled). Test files call `createApp({ skipAuth: true })` which skips `authMiddleware` registration. Do NOT use `NODE_ENV=test` to conditionally disable auth — a misconfigured env var in production would bypass auth entirely.

```typescript
// src/server/app.ts
export function createApp(opts?: { skipAuth?: boolean }) {
  const app = new Hono();
  // ... error handler, health check, public routes ...
  if (!opts?.skipAuth) {
    app.use('/api/*', authMiddleware);
    app.use('/ws', authMiddleware);
  }
  // ... register apiRoutes, ws route ...
  return app;
}

// src/server/index.ts (production)
const app = createApp();

// tests/unit/routes.test.ts
const app = createApp({ skipAuth: true });
```

### What NOT to Test

| Skip | Why |
|---|---|
| Agent/LLM behavior | Non-deterministic |
| React components | UI will churn in v1 |
| Google API calls | Google's responsibility; test our parsing of their responses |
| Auth flow (OAuth) | Requires real Google redirect |
| DB queries directly | Covered indirectly via tool/route tests; add DB tests later if needed |

---

## CI: GitHub Actions

Two parallel jobs: lint + typecheck, and unit tests.

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Lint
        run: pnpm run lint
      - name: Typecheck
        run: pnpm exec tsc --noEmit
      - name: Architecture checks
        run: pnpm run lint:arch

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Unit tests
        run: pnpm test
```

---

## Package Scripts (Updated)

```jsonc
// package.json scripts (additions)
{
  "lint": "biome check src/",
  "lint:fix": "biome check --fix src/",
  "lint:arch": "tsx scripts/lint_module_boundaries.ts && tsx scripts/lint_db_encapsulation.ts && tsx scripts/lint_async_hygiene.ts",
  "format": "biome format --write src/",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

---

## Directory Structure

```
scripts/
├── lint_module_boundaries.ts      ← Enforces dependency direction between layers
├── lint_db_encapsulation.ts       ← Ensures DB queries stay in db/ layer
└── lint_async_hygiene.ts          ← Catches blocking calls in server code

tests/
└── unit/
    ├── google/
    │   ├── gmail.test.ts          ← Response parsing tests
    │   └── calendar.test.ts       ← Event parsing tests
    ├── tools.test.ts              ← MCP tool handler tests (mocked DB)
    └── routes.test.ts             ← REST API tests (mocked DB + Google)
```
