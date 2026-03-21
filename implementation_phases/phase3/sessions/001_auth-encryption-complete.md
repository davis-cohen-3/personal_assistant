# Session: Auth & Encryption Complete

**Date:** 2026-03-21
**Phase:** 3 — Auth & Encryption

## Summary

Implemented all of Phase 3 in a single session. Task 3.1 built AES-256-GCM token encryption (`crypto.ts`) and the Google OAuth2 client singleton with encrypted token persistence (`google/auth.ts`, `google/index.ts`). Task 3.2 built all auth routes and middleware (`auth.ts`) and wired them into the server entry point (`index.ts`). All 30 tests pass, build passes.

## Key Decisions

- **Lazy env var reads in crypto.ts**: ENCRYPTION_KEY is read in function bodies rather than at module load time, making unit tests simpler (no vi.hoisted needed). Startup validation is handled by index.ts REQUIRED_ENV check.
- **CSRF uses CSRF_SECRET, not JWT_SECRET**: Spec (HIGH-9) explicitly requires separate secrets. The design doc used JWT_SECRET for both, but the implementation plan overrides this.
- **SEC-002 OAuth error handling**: Callback always redirects to `/?auth_error=oauth_failed` — never reflects raw Google error string. Non-allowlisted users get 403 JSON (not a redirect).
- **Auth tag in ciphertext**: AES-256-GCM auth tag (16 bytes) is appended to encrypted bytes before hex-encoding. Format is `<hex_iv>:<hex_encrypted+authtag>` — stays within the spec's two-part format.
- **hono/jwt requires explicit alg**: `sign`/`verify` require `"HS256"` as third argument — omitting it throws `JwtAlgorithmRequired`. Both production code and tests specify it.
- **google-auth-library not top-level**: `OAuth2Client` is accessed via `google.auth.OAuth2` from `googleapis` (not directly from `google-auth-library`, which is a transitive dep not directly installable).
- **persistTokens handles refresh events**: googleapis `tokens` event fires without `refresh_token` on auto-refresh. `persistTokens` loads and decrypts the existing refresh token from DB when the new token omits it.
- **ContentfulStatusCode cast**: Hono's `c.json` second arg is typed as `ContentfulStatusCode`, not `number`. `AppError.status: number` requires a cast.

## Code Changes

- Created: `src/server/crypto.ts`
- Created: `src/server/google/auth.ts`
- Created: `src/server/google/index.ts`
- Modified: `src/server/auth.ts` (new file, fully created)
- Modified: `src/server/index.ts` (expanded from Phase 1 minimal placeholder)
- Created: `tests/unit/crypto.test.ts`
- Created: `tests/unit/google/auth.test.ts`
- Created: `tests/unit/auth.test.ts`
- Created: `implementation_phases/phase3/completion_report.md`

## Open Questions

- None — phase is fully complete

## Next Steps

- [ ] Phase 4: SDK Spike — verify Agent SDK streaming behavior, resume semantics, session_id message type, model ID format
- [ ] Phase 4 is a throwaway script (`scripts/sdk_spike.ts`), not production code — findings inform Phase 8 (WebSocket handler)
- [ ] After Phase 4, phases 5 (connectors) can run as 3 parallel subagents
