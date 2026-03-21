---
name: debugging
description: Debugging patterns and troubleshooting. Use when investigating errors, test failures, or unexpected behavior. Also covers log analysis.
disable-model-invocation: true
---

# Debugging

STARTER_CHARACTER = 🔍

## First Step: Check Logs

**Always check logs first before investigating code.**

| Log File | Purpose | When to Check |
|----------|---------|---------------|
| `logs/server.log` | Dev server | Local development, UI testing |
| Browser console | Frontend | React component errors, network failures |

### Quick Log Commands

```bash
# Last 100 lines
tail -100 logs/server.log

# Search for errors
grep -i "error\|exception\|throw" logs/server.log | tail -50

# Watch logs in real-time
tail -f logs/server.log

# Find HTTP errors (4xx/5xx)
grep -E "\" [45][0-9]{2} " logs/server.log | tail -20

# Database errors
grep -i "drizzle\|database\|postgres\|connection" logs/server.log | tail -30

# Specific endpoint
grep "/api/buckets" logs/server.log | tail -20
```

## Tracing Through Layers

Errors propagate: Query/Connector → Route/Tool → Response

1. **Find the error in logs** — look for ERROR or stack traces
2. **Identify the layer** — which file/function failed?
3. **Check the call chain** — what called this function?

```
Route: GET /api/buckets
  → getBucketsWithThreads() (queries.ts)
    → ERROR: relation "buckets" does not exist
```

```
WebSocket: chat message
  → Agent SDK → bucket_manage tool (tools.ts)
    → createBucket() (queries.ts)
      → ERROR: duplicate key value
```

## Common Failure Modes

### Database Connection

```
Error: connect ECONNREFUSED
```
- Check Postgres is running (`docker-compose ps`)
- Check DATABASE_URL in .env
- Check connection pool initialization

### Missing Environment Variable

```
Error: Missing required env: ANTHROPIC_API_KEY
```
- Check .env file exists and variable is set
- Check Railway dashboard for production

### Authentication Errors

```
401 Unauthorized
```
- Check JWT cookie present and not expired
- Check ALLOWED_USERS includes the email
- Check Google token refresh (kv_store table)

### Google API Errors

```
Error: insufficient permissions (403)
```
- Check OAuth scopes in consent screen
- Check token hasn't been revoked
- Check Google API quotas

### Not Found

```
NotFoundError: Bucket abc123 not found
```
- Verify ID exists in database
- Check UUID format
- Check if migration was run

### WebSocket Issues

```
WebSocket connection closed unexpectedly
```
- Check agent.ts for unhandled errors
- Check reconnection logic in frontend
- Check Railway timeout settings

## Debugging Tests

```bash
# Run specific test with output
npm test -- --grep "test name" --verbose

# Check test logs after failure
tail -100 logs/test_server.log
```

## Quick Checks

| Symptom | Check |
|---------|-------|
| 500 error | logs/server.log for stack trace |
| 401 error | JWT cookie present? Expired? |
| Google API error | Token in kv_store? Scopes correct? |
| DB error | Postgres running? Migration run? |
| WebSocket disconnect | Agent error? Reconnection logic? |
| Frontend stale data | data_changed event firing? Refetch working? |
| Test failure | logs/test_server.log |

## Debugging Workflow

1. **Reproduce the issue**
2. **Check logs immediately**: `tail -50 logs/server.log`
3. **Search for the endpoint** that failed
4. **Find the stack trace** near that request
5. **Check the file:line** mentioned in trace
6. **Trace through layers**: Route/Tool → Query/Connector
