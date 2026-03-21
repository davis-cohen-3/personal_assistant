---
name: migrations
description: Database schema changes using Drizzle ORM. Handles schema.ts modifications and migration generation.
disable-model-invocation: true
---

# Migrations

Database schema changes with Drizzle.

## Process

1. **Modify schema** in `src/server/db/schema.ts`
2. **Generate migration:**
   ```bash
   npx drizzle-kit generate
   ```
3. **Review** the generated SQL in `src/server/db/migrations/`
4. **Run migration:**
   ```bash
   npx drizzle-kit migrate
   ```
5. **Update query functions** in `queries.ts` if needed
6. **Run tests** to verify

## Rules

- Schema in `schema.ts` is the source of truth — always modify it first
- One migration per feature/issue
- Review generated SQL before running
- Never edit generated migration files manually
- Test with a clean database after migration

## Common Patterns

### Add a new table

```typescript
export const newTable = pgTable('new_table', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

### Add a column

```typescript
// Add to existing table definition in schema.ts
newColumn: text('new_column'),  // nullable by default
newRequired: text('new_required').notNull().default('value'),
```

### Add a foreign key

```typescript
bucketId: uuid('bucket_id').references(() => buckets.id, { onDelete: 'cascade' }),
```
