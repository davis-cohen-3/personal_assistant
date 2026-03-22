export { getAuthClient, isGoogleConnected, loadTokens, persistTokens } from "./auth.js";
export type {
  CalendarEvent,
  CalendarEventAttendee,
  CreateEventInput,
  FreeBusyResult,
  ListEventsOptions,
} from "./calendar.js";
export {
  checkFreeBusy,
  createEvent,
  deleteEvent,
  getEvent,
  listEvents,
  parseEvent,
  updateEvent,
} from "./calendar.js";
export type { DriveFile, SearchFilesOptions } from "./drive.js";
export {
  getFileMetadata,
  listRecentFiles,
  readDocument,
  searchFiles,
  translateQuery,
} from "./drive.js";
export type {
  EmailAttachment,
  GmailLabel,
  GmailMessage,
  GmailThread,
  SendMessageOptions,
  ThreadSummary,
} from "./gmail.js";
export {
  archiveThread,
  createDraft,
  getMessage,
  getThread,
  listLabels,
  markAsRead,
  modifyLabels,
  replyToThread,
  searchThreads,
  sendMessage,
} from "./gmail.js";
