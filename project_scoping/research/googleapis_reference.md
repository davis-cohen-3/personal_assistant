# Google APIs Reference (`googleapis` npm package)

> Covers OAuth2, Gmail, Calendar, and Drive APIs as used by the personal assistant agent.
> All examples use TypeScript with the monolith `googleapis` package.

---

## 1. Setup & Initialization

```bash
pnpm add googleapis mimetext
```

```typescript
import { google } from 'googleapis';
import { createMimeMessage } from 'mimetext';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
const drive = google.drive({ version: 'v3', auth: oauth2Client });
```

---

## 2. OAuth2 — Token Management

### Generate Auth URL

```typescript
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',   // Required to get refresh_token
  prompt: 'consent',         // Force consent to guarantee refresh_token
  scope: [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/drive.readonly',
  ]
});
```

**Critical:** `refresh_token` is only returned on first consent. Always pass `access_type: 'offline'` and `prompt: 'consent'`.

### Exchange Code for Tokens

```typescript
const { tokens } = await oauth2Client.getToken(authCode);
// tokens: { access_token, refresh_token, expiry_date, token_type, scope }
oauth2Client.setCredentials(tokens);
```

### Token Refresh Listener

```typescript
oauth2Client.on('tokens', (tokens) => {
  // Fires on first auth AND every automatic refresh
  // Persist to google_tokens table (encrypted)
  if (tokens.refresh_token) {
    await persistRefreshToken(userId, encrypt(tokens.refresh_token));
  }
  await persistAccessToken(userId, encrypt(tokens.access_token), tokens.expiry_date);
});
```

### Restore Credentials from DB

```typescript
const storedTokens = await getTokensFromDb(userId);
oauth2Client.setCredentials({
  refresh_token: decrypt(storedTokens.refresh_token)
});
// Next API call auto-refreshes access_token using refresh_token
```

The library handles token refresh automatically — when an access_token expires, the next API call triggers a refresh using the refresh_token, which fires the `tokens` event.

---

## 3. Gmail API (v1)

### Response Types

```typescript
interface Message {
  id: string;
  threadId: string;
  labelIds: string[];        // INBOX, UNREAD, STARRED, IMPORTANT, SENT, DRAFT, SPAM, TRASH
  snippet: string;           // Preview text
  internalDate: string;      // Epoch ms
  payload: MessagePart;      // MIME structure (with format='full')
  sizeEstimate?: number;
}

interface MessagePart {
  partId?: string;
  mimeType: string;          // 'text/plain', 'text/html', 'multipart/mixed', etc.
  headers?: Array<{ name: string; value: string }>;
  body?: { size?: number; data?: string };  // data is base64url encoded
  parts?: MessagePart[];     // Child parts for multipart messages
  filename?: string;         // For attachments
}
```

### messages.list — Returns IDs Only

```typescript
const response = await gmail.users.messages.list({
  userId: 'me',
  q: 'is:unread in:inbox',    // Gmail search syntax
  maxResults: 100,              // Default 100, max 500
  labelIds: ['INBOX'],
  pageToken: nextPageToken,
});

// response.data.messages = [{ id, threadId }, ...]
// response.data.nextPageToken — for pagination
// response.data.resultSizeEstimate
```

Must call `messages.get` separately for full content.

### messages.get — Full Message

```typescript
const message = await gmail.users.messages.get({
  userId: 'me',
  id: messageId,
  format: 'full'   // 'minimal' | 'full' | 'raw'
});
// message.data = Message with payload tree
```

### Decoding Message Body

Gmail uses RFC 4648 base64url encoding:

```typescript
function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}
```

### Walking payload.parts Tree

Messages can be deeply nested multipart. Walk recursively:

```typescript
function findPart(payload: MessagePart, mimeType: string): MessagePart | undefined {
  if (payload.mimeType === mimeType && payload.body?.data) {
    return payload;
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const found = findPart(part, mimeType);
      if (found) return found;
    }
  }
  return undefined;
}

// Extract text body
const textPart = findPart(message.data.payload, 'text/plain');
if (textPart?.body?.data) {
  const body = decodeBase64Url(textPart.body.data);
}
```

### threads.list / threads.get

```typescript
// List threads
const threads = await gmail.users.threads.list({
  userId: 'me',
  q: 'from:alice@example.com',
  maxResults: 25,
  pageToken: nextPageToken,
});
// threads.data.threads = [{ id, snippet, historyId }, ...]

// Get full thread with all messages
const thread = await gmail.users.threads.get({
  userId: 'me',
  id: threadId,
  format: 'full'
});
// thread.data.messages = [Message, Message, ...] in thread order
```

### messages.send — RFC 2822 via mimetext

```typescript
import { createMimeMessage } from 'mimetext';

const msg = createMimeMessage();
msg.setSender({ name: 'Davis', addr: 'davis@example.com' });
msg.setRecipient('recipient@example.com');
msg.setSubject('Hello');
msg.addMessage({ contentType: 'text/plain', data: 'Message body' });

const raw = msg.asRaw();  // Returns base64url-encoded RFC 2822 string

await gmail.users.messages.send({
  userId: 'me',
  requestBody: { raw }
});
```

### Reply to Thread

Set `threadId` + threading headers:

```typescript
const msg = createMimeMessage();
msg.setSender({ name: 'Davis', addr: 'davis@example.com' });
msg.setRecipient('recipient@example.com');
msg.setSubject('Re: Original Subject');
msg.setHeader('In-Reply-To', '<original-message-id@mail.gmail.com>');
msg.setHeader('References', '<original-message-id@mail.gmail.com>');
msg.addMessage({ contentType: 'text/plain', data: 'Reply body' });

await gmail.users.messages.send({
  userId: 'me',
  requestBody: {
    raw: msg.asRaw(),
    threadId: originalThreadId  // Groups into same thread
  }
});
```

### drafts.create

```typescript
const msg = createMimeMessage();
// ... build message ...

await gmail.users.drafts.create({
  userId: 'me',
  requestBody: {
    message: { raw: msg.asRaw(), threadId: optionalThreadId }
  }
});
```

### messages.modify — Labels

```typescript
// Mark as read
await gmail.users.messages.modify({
  userId: 'me',
  id: messageId,
  requestBody: { removeLabelIds: ['UNREAD'] }
});

// Archive thread (remove from inbox)
await gmail.users.threads.modify({
  userId: 'me',
  id: threadId,
  requestBody: { removeLabelIds: ['INBOX'] }
});
```

### Gmail Search Syntax

```
from:alice@example.com          # From sender
to:bob@example.com              # To recipient
subject:"quarterly report"      # Subject contains
has:attachment                   # Has attachment
is:unread                        # Unread
is:starred                       # Starred
label:important                  # Has label
-label:promotions                # NOT label
after:2025/01/01                 # Date range
before:2025/03/21
size:>1M                         # Size filter
newer_than:7d                    # Relative date
```

Operators are implicit AND. Use `OR` for disjunction: `from:alice OR from:bob`.

---

## 4. Calendar API (v3)

### Event Resource

```typescript
interface Event {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  organizer?: { email: string; displayName?: string; self?: boolean };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus: 'accepted' | 'declined' | 'tentative' | 'needsAction';
  }>;
  status: 'confirmed' | 'tentative' | 'cancelled';
  htmlLink: string;
  location?: string;
  recurringEventId?: string;  // Parent ID if this is a recurring instance
}
```

### events.list

```typescript
const events = await calendar.events.list({
  calendarId: 'primary',
  timeMin: new Date().toISOString(),
  timeMax: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  singleEvents: true,       // Expand recurring events into instances
  orderBy: 'startTime',     // REQUIRES singleEvents: true
  maxResults: 100,
  q: 'standup',             // Free-text search
});
// events.data.items = [Event, ...]
```

**Critical gotcha:** `orderBy: 'startTime'` REQUIRES `singleEvents: true`. Without it, the API returns an error. Always set both.

### events.get

```typescript
const event = await calendar.events.get({
  calendarId: 'primary',
  eventId: eventId,
});
// event.data = Event resource
```

### events.insert

```typescript
const event = await calendar.events.insert({
  calendarId: 'primary',
  sendUpdates: 'all',  // Notify attendees
  requestBody: {
    summary: 'Team meeting',
    description: 'Quarterly sync',
    start: { dateTime: '2025-04-01T10:00:00', timeZone: 'America/New_York' },
    end: { dateTime: '2025-04-01T11:00:00', timeZone: 'America/New_York' },
    attendees: [{ email: 'attendee@example.com' }],
    location: 'Conference Room A',
  }
});
```

### events.patch — Partial Update

```typescript
await calendar.events.patch({
  calendarId: 'primary',
  eventId: eventId,
  sendUpdates: 'all',
  requestBody: { summary: 'Updated meeting name' }
});
```

Prefer `patch` over `update` — safer, only sends changed fields.

### events.delete

```typescript
await calendar.events.delete({
  calendarId: 'primary',
  eventId: eventId,
  sendUpdates: 'all',
});
```

### freebusy.query

```typescript
const freebusy = await calendar.freebusy.query({
  requestBody: {
    timeMin: new Date().toISOString(),
    timeMax: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    items: [{ id: 'primary' }]
  }
});
// freebusy.data.calendars['primary'].busy = [{ start, end }, ...]
```

---

## 5. Drive API (v3)

### File Resource

```typescript
interface File {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime: string;
  modifiedTime: string;
  parents?: string[];
  owners?: Array<{ emailAddress: string; displayName?: string }>;
  shared: boolean;
  webViewLink: string;
}
```

### files.list — Search

```typescript
const files = await drive.files.list({
  q: "name contains 'budget' and trashed = false",
  spaces: 'drive',
  pageSize: 100,
  orderBy: 'modifiedTime desc',
  fields: 'files(id,name,mimeType,modifiedTime,webViewLink)',
  pageToken: nextPageToken,
});
// files.data.files = [File, ...]
```

### Drive Search DSL — DIFFERENT from Gmail!

```typescript
// String matching
"name contains 'budget'"                          // Name contains
"name = 'Q4 Report'"                              // Exact name
"fullText contains 'quarterly'"                   // Full-text search

// MIME type
"mimeType = 'application/vnd.google-apps.document'"   // Google Doc
"mimeType = 'application/vnd.google-apps.spreadsheet'" // Google Sheet
"mimeType = 'application/vnd.google-apps.folder'"      // Folder

// Dates
"modifiedTime > '2025-01-01T00:00:00'"

// Location
"'folder-id' in parents"

// Ownership / sharing
"'user@example.com' in owners"
"sharedWithMe = true"

// Status
"trashed = false"

// Boolean
"name contains 'budget' and mimeType = 'application/vnd.google-apps.spreadsheet'"
"name contains 'report' or name contains 'summary'"
```

**Key difference from Gmail:** Drive uses `name contains 'x'` not `subject:x`. Operators are `=`, `!=`, `contains`, `not ... contains`. Fields use camelCase.

### files.list — Recent Files

```typescript
const recent = await drive.files.list({
  orderBy: 'viewedByMeTime desc',
  pageSize: 20,
  fields: 'files(id,name,mimeType,modifiedTime,webViewLink)',
  q: 'trashed = false',
});
```

### files.get — Metadata

```typescript
const file = await drive.files.get({
  fileId: fileId,
  fields: 'id,name,mimeType,size,modifiedTime,webViewLink',
});
```

### files.export — Read Google Docs as Plain Text

```typescript
const doc = await drive.files.export({
  fileId: fileId,
  mimeType: 'text/plain',
});
// doc.data = string (plain text content)
```

Export MIME types:
- `text/plain` — plain text (v1 default)
- `application/pdf` — PDF
- `text/csv` — CSV (for Sheets)
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document` — DOCX

10MB export limit.

---

## 6. Error Handling

### GaxiosError

`googleapis` throws `GaxiosError` from the `gaxios` package:

```typescript
import { GaxiosError } from 'gaxios';

try {
  await gmail.users.messages.list({ userId: 'me' });
} catch (err) {
  if (err instanceof GaxiosError) {
    // err.status — HTTP status code
    // err.response?.data — response body
    // err.response?.data?.error?.errors — array of error details
    // err.response?.data?.error?.errors?.[0]?.reason — e.g., 'userRateLimitExceeded'
  }
}
```

### Common Status Codes

| Status | Meaning | Action |
|---|---|---|
| `401` | Token expired or revoked | Trigger re-auth flow |
| `403` | Scope missing or quota exceeded | Check scopes; check `error.errors[0].reason` |
| `404` | Resource not found | Message/event deleted |
| `429` | Rate limited | Exponential backoff |

### Rate Limit Detection

```typescript
if (err.status === 429 || err.status === 403) {
  const reason = err.response?.data?.error?.errors?.[0]?.reason;
  if (reason === 'userRateLimitExceeded' || reason === 'rateLimitExceeded') {
    // Exponential backoff
  }
}
```

---

## 7. Concurrency & Batch Reads

`messages.list` returns only IDs. Fetching N messages requires N `messages.get` calls. Use `Promise.all` with concurrency limit:

```typescript
import pLimit from 'p-limit';

const limit = pLimit(5); // Max 5 concurrent requests

const messageIds = listResponse.data.messages.map(m => m.id);
const messages = await Promise.all(
  messageIds.map(id =>
    limit(() => gmail.users.messages.get({ userId: 'me', id, format: 'full' }))
  )
);
```

### Pagination Helper

```typescript
async function* paginateThreads(query: string) {
  let pageToken: string | undefined;
  do {
    const response = await gmail.users.threads.list({
      userId: 'me',
      q: query,
      maxResults: 100,
      pageToken,
    });
    if (response.data.threads) {
      yield* response.data.threads;
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);
}
```

---

## 8. Rate Limits (Single User)

| API | Limit | Notes |
|---|---|---|
| Gmail | 15,000 quota units/min per user | `messages.list` = 5 units, `messages.get` = 5 units, `messages.send` = 100 units |
| Calendar | 12,000 queries/60s | Generous for single user |
| Drive | 12,000 queries/100s | Per user |

Not a v1 concern for a single-user app with normal usage patterns.

---

## Sources

- [googleapis - npm](https://www.npmjs.com/package/googleapis)
- [google-api-nodejs-client - GitHub](https://github.com/googleapis/google-api-nodejs-client)
- [Using OAuth 2.0 — Google Identity](https://developers.google.com/identity/protocols/oauth2)
- [Gmail API Reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages)
- [Calendar API Reference](https://developers.google.com/workspace/calendar/api/v3/reference/events)
- [Drive API — Search Files](https://developers.google.com/workspace/drive/api/guides/search-files)
- [MIMEText — GitHub](https://github.com/muratgozel/MIMEText)
