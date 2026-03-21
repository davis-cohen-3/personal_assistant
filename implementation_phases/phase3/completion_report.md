# Phase 3 Completion Report — Auth & Encryption

**Status:** Complete
**Tests:** 30 passing (5 test files)
**Build:** `pnpm run build` passes (vite + tsc)

---

## What Was Built

### Task 3.1 — Token Encryption + Google OAuth Client

#### `src/server/crypto.ts`
AES-256-GCM encrypt/decrypt using Node `crypto`.

- ENCRYPTION_KEY read lazily per call (not at module load time) — startup validation handled by `index.ts`
- IV is 12 bytes (96-bit, recommended for GCM)
- Auth tag (16 bytes) is appended to ciphertext buffer before hex-encoding
- Stored format: `<hex_iv>:<hex_ciphertext>` where ciphertext includes the auth tag in the last 16 bytes
- Key parsed via `Buffer.from(keyHex, 'hex')` — expects 64-char hex string (32 bytes)

#### `src/server/google/auth.ts`
OAuth2 client singleton with encrypted token persistence.

- `getAuthClient()` — creates `OAuth2Client` singleton on first call, registers `tokens` refresh listener
- `persistTokens(tokens)` — encrypts `access_token` and `refresh_token` before calling `upsertGoogleTokens`. On refresh events (where `refresh_token` is absent), loads and decrypts existing refresh token from DB. Converts `expiry_date` epoch ms to `Date` explicitly (FEAS-011).
- `loadTokens()` — reads from DB, decrypts both token fields, sets credentials on the OAuth2Client. No-ops if no tokens exist (pre-first-login state).
- Token refresh listener calls `persistTokens` automatically on every auto-refresh

Uses `google.auth.OAuth2` from the `googleapis` package (not the transitive `google-auth-library` package, which is not directly available as a top-level dep).

#### `src/server/google/index.ts`
Re-exports `getAuthClient`, `loadTokens`, `persistTokens`.

#### `tests/unit/crypto.test.ts` — 4 tests
- Round-trip encrypt/decrypt for a simple string
- Round-trip for different payloads (empty string, 1000-char string, JSON, unicode)
- Same plaintext produces different ciphertexts (unique IVs)
- Ciphertext format is two colon-separated hex parts

#### `tests/unit/google/auth.test.ts` — 4 tests
Uses `vi.mock` to replace `crypto.ts` with spies and `db/queries.ts` with stubs.
- `persistTokens` calls `encrypt` on `access_token`
- `persistTokens` calls `encrypt` on `refresh_token`
- `loadTokens` calls `decrypt` on stored `access_token`
- `loadTokens` calls `decrypt` on stored `refresh_token`

---

### Task 3.2 — Auth Routes + Middleware

#### `src/server/auth.ts`
All auth routes and the `authMiddleware` exported from a single module.

**Routes (mounted at `/auth/*`):**

| Route | Behavior |
|---|---|
| `GET /auth/google` | Generates OAuth consent URL with `access_type: offline`, `prompt: consent`, all required scopes |
| `GET /auth/google/callback` | Exchanges code, checks allowlist, persists tokens, sets session cookie, redirects to `/` |
| `GET /auth/logout` | Clears session cookie via `maxAge: 0`, redirects to `/` |
| `GET /auth/status` | Returns `{ authenticated: false }` or `{ authenticated: true, csrfToken }` |

**Security decisions:**
- SEC-002: OAuth callback errors (e.g. `?error=access_denied`) redirect to `/?auth_error=oauth_failed` — raw Google error string is never reflected in the redirect
- Missing `code` param on callback also redirects to `/?auth_error=oauth_failed`
- Any exception during the callback (token exchange, userinfo fetch, DB write) is caught, logged server-side, and redirects to `/?auth_error=oauth_failed`
- Allowlist rejection returns `403` JSON (not a redirect)

**`authMiddleware`:**
- Reads `session` httpOnly cookie, verifies as HS256 JWT against `JWT_SECRET`
- Enforces `X-CSRF-Token` header on POST/PUT/PATCH/DELETE (HIGH-9: uses **`CSRF_SECRET`**, not `JWT_SECRET`)
- CSRF token is `HMAC-SHA256(session_jwt, CSRF_SECRET)` — deterministic per session, re-fetchable via `/auth/status`
- `GET` requests and WebSocket upgrades are exempt from CSRF check

**JWT signing:** `hono/jwt`'s `sign`/`verify` require an explicit `alg` parameter in this version — both use `"HS256"`.

#### Updated `src/server/index.ts`
- Validates all required env vars at startup (fail fast): `DATABASE_URL`, `JWT_SECRET`, `CSRF_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `ALLOWED_USERS`, `ANTHROPIC_API_KEY`, `ENCRYPTION_KEY`
- Mounts `googleAuthRoutes` at `/auth/*` (public — before auth middleware)
- Applies `authMiddleware` to `/api/*`
- Calls `loadTokens()` at startup to restore persisted Google credentials
- Central error handler uses `AppError.userFacing` flag — only exposes message to client when `userFacing: true`, otherwise returns generic "Internal server error"

#### `tests/unit/auth.test.ts` — 11 tests
Uses `vi.hoisted` to set env vars before module evaluation, `vi.mock` for `google/auth.ts` and `googleapis`.

| Test | What it covers |
|---|---|
| No session cookie | authMiddleware → 401 |
| Invalid session cookie | authMiddleware → 401 |
| Valid session + GET | authMiddleware allows, no CSRF check |
| Valid session + POST, no CSRF header | authMiddleware → 403 |
| Valid session + POST, wrong CSRF | authMiddleware → 403 |
| Valid session + POST, correct CSRF | authMiddleware passes |
| Callback with non-allowlisted email | → 403 JSON |
| Callback with OAuth error param | → 302 to `/?auth_error=oauth_failed` |
| `/auth/status` with no session | `{ authenticated: false }` |
| `/auth/status` with valid session | `{ authenticated: true, csrfToken: <64-char hex> }` |
| `/auth/logout` | Sets `session=` with `Max-Age=0` |

---

## Issues Addressed

| Issue | Resolution |
|---|---|
| HIGH-9: Separate CSRF_SECRET | `authMiddleware` and `/auth/status` use `CSRF_SECRET` for HMAC, not `JWT_SECRET` |
| SEC-002: OAuth error reflection | Callback never reflects raw Google error; always redirects to `/?auth_error=oauth_failed` |
| FEAS-011: expiry_date epoch ms | `persistTokens` does `new Date(tokens.expiry_date)` explicitly before DB write |

---

## Notable Implementation Details

**`google-auth-library` not directly installable:** The `googleapis` package includes `google-auth-library` as a transitive dependency but it's not a top-level package. `OAuth2Client` is accessed via `google.auth.OAuth2` from `googleapis`.

**`hono/jwt` requires explicit `alg`:** `verify(token, secret)` throws `JwtAlgorithmRequired` unless `"HS256"` is passed as the third argument. Both `sign` and `verify` specify `"HS256"` explicitly.

**Token refresh handling:** The googleapis `tokens` event fires on every access token refresh but does not include `refresh_token`. `persistTokens` handles this by loading and decrypting the existing refresh token from the DB when the new token omits it.

**`ContentfulStatusCode` cast in index.ts:** Hono's `c.json` second parameter is typed as `ContentfulStatusCode` (a union of valid HTTP status codes), not `number`. `AppError.status` is typed as `number`, requiring a cast via `err.status as ContentfulStatusCode`.
