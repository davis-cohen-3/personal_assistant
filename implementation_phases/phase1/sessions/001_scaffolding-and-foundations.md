# Session: Scaffolding and Foundations

**Date:** 2026-03-21
**Phase:** 1 — Scaffolding + Foundations

## Summary

Implemented all of Phase 1 (Tasks 1.1 and 1.2) from the implementation plan. Created the full project scaffolding with configs, placeholders, shared types, error handling, architecture linters, git hooks, and CI. All verification checks pass: install, lint, typecheck, tests, arch linters, and health check endpoint.

## Key Decisions

- **Biome 2.0 config migration**: Design docs used Biome 1.x schema (`organizeImports`, `files.ignore`). Biome 2.0 moved these to `assist.actions.source.organizeImports` and `files.includes`/`experimentalScannerIgnores`.
- **mimetext `^3.0.0`**: Design doc specified `^4.0.0` but latest published is `3.0.28`.
- **`console.error` only**: A pre-commit hook (`check_typescript_quality.py`) blocks `console.warn`/`console.log`/`console.info`/`console.debug` in production code. Only `console.error` is allowed, despite CLAUDE.md saying to use `console.error`/`console.warn`.
- **`AppError.userFacing` flag**: Added `userFacing: boolean` (defaults to `false`) to `AppError` per HIGH-4 review issue. The base design doc didn't include it, but the implementation plan specifies it.
- **Architecture linters with existence guards**: All three linters skip gracefully when target directories don't exist yet, so they pass during scaffolding before server code is fleshed out.
- **Placeholder test**: Added `tests/unit/placeholder.test.ts` so `pnpm test` exits 0 (vitest exits 1 with no test files).

## Code Changes

- Created: `package.json`
- Created: `tsconfig.json`, `tsconfig.server.json`
- Created: `vite.config.ts`, `vitest.config.ts`, `biome.json`, `drizzle.config.ts`
- Created: `docker-compose.yml`, `.env.example`, `.gitignore`
- Created: `src/server/index.ts` (Hono health check + shutdown)
- Created: `src/server/exceptions.ts` (AppError with userFacing flag)
- Created: `src/shared/types.ts` (ChatMessage, WS messages, Conversation types)
- Created: `src/client/index.html`, `main.tsx`, `App.tsx`, `globals.css`
- Created: `scripts/lint_module_boundaries.ts`, `lint_db_encapsulation.ts`, `lint_async_hygiene.ts`
- Created: `.husky/pre-commit`, `.github/workflows/ci.yml`
- Created: `tests/unit/placeholder.test.ts`
- Created: `implementation_phases/phase1/completion_report.md`
- Modified: `.claude/skills/save-history/SKILL.md` (updated to use implementation_phases path)

## Open Questions

- The `console.warn` hook restriction conflicts with CLAUDE.md guidance — should the hook be updated to allow `console.warn`/`console.error`, or should all logging use `console.error`?

## Next Steps

- [ ] Phase 2: Database Layer — schema, migrations, connection, query functions
- [ ] Task 2.1: Schema + connection + migrations (8 tables, Drizzle, Postgres 16)
- [ ] Task 2.2: Query functions + integration tests against real Postgres
