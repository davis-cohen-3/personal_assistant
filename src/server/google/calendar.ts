import { type calendar_v3, google } from "googleapis";
import { getAuthClient } from "./auth.js";

export interface CalendarEventAttendee {
  email: string;
  displayName?: string;
  responseStatus: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location?: string;
  attendees: CalendarEventAttendee[];
  status: string;
  htmlLink: string;
  organizer?: { email: string; displayName?: string };
}

export interface ListEventsOptions {
  maxResults?: number;
  q?: string;
}

export interface CreateEventInput {
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  attendees?: string[];
  timeZone?: string;
}

export interface FreeBusyResult {
  [calendarId: string]: {
    busy: Array<{ start: string; end: string }>;
  };
}

export function parseEvent(data: calendar_v3.Schema$Event): CalendarEvent {
  const isAllDay = Boolean(data.start?.date && !data.start?.dateTime);
  const start = isAllDay ? (data.start?.date ?? "") : (data.start?.dateTime ?? "");
  const end = isAllDay ? (data.end?.date ?? "") : (data.end?.dateTime ?? "");

  const attendees: CalendarEventAttendee[] = (data.attendees ?? []).map((a) => ({
    email: a.email ?? "",
    displayName: a.displayName ?? undefined,
    responseStatus: a.responseStatus ?? "needsAction",
  }));

  return {
    id: data.id ?? "",
    summary: data.summary ?? "",
    description: data.description ?? undefined,
    start,
    end,
    isAllDay,
    location: data.location ?? undefined,
    attendees,
    status: data.status ?? "",
    htmlLink: data.htmlLink ?? "",
    organizer: data.organizer?.email
      ? {
          email: data.organizer.email,
          displayName: data.organizer.displayName ?? undefined,
        }
      : undefined,
  };
}

export async function listEvents(
  timeMin: string,
  timeMax: string,
  opts?: ListEventsOptions,
): Promise<CalendarEvent[]> {
  console.info("calendar.listEvents", {
    timeMin,
    timeMax,
    maxResults: opts?.maxResults,
    q: opts?.q,
  });
  const calendar = google.calendar({ version: "v3", auth: getAuthClient() });
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    ...(opts?.maxResults !== undefined ? { maxResults: opts.maxResults } : {}),
    ...(opts?.q !== undefined ? { q: opts.q } : {}),
  });
  const events = (res.data.items ?? []).map(parseEvent);
  console.info("calendar.listEvents result", { count: events.length });
  return events;
}

export async function getEvent(eventId: string): Promise<CalendarEvent> {
  console.info("calendar.getEvent", { eventId });
  const calendar = google.calendar({ version: "v3", auth: getAuthClient() });
  const res = await calendar.events.get({ calendarId: "primary", eventId });
  return parseEvent(res.data);
}

export async function createEvent(input: CreateEventInput): Promise<CalendarEvent> {
  console.info("calendar.createEvent", {
    summary: input.summary,
    start: input.start,
    end: input.end,
    attendees: input.attendees,
  });
  const calendar = google.calendar({ version: "v3", auth: getAuthClient() });

  const startField = input.timeZone
    ? { dateTime: input.start, timeZone: input.timeZone }
    : { dateTime: input.start };
  const endField = input.timeZone
    ? { dateTime: input.end, timeZone: input.timeZone }
    : { dateTime: input.end };

  const res = await calendar.events.insert({
    calendarId: "primary",
    sendUpdates: "all",
    requestBody: {
      summary: input.summary,
      ...(input.description ? { description: input.description } : {}),
      ...(input.location ? { location: input.location } : {}),
      start: startField,
      end: endField,
      ...(input.attendees ? { attendees: input.attendees.map((email) => ({ email })) } : {}),
    },
  });
  const event = parseEvent(res.data);
  console.info("calendar.createEvent complete", {
    eventId: event.id,
    summary: event.summary,
    start: event.start,
    end: event.end,
  });
  return event;
}

export async function updateEvent(
  eventId: string,
  patch: Partial<{
    summary: string;
    description: string;
    location: string;
    start: string;
    end: string;
    attendees: string[];
  }>,
): Promise<CalendarEvent> {
  console.info("calendar.updateEvent", {
    eventId,
    fields: Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined),
  });
  const calendar = google.calendar({ version: "v3", auth: getAuthClient() });
  const requestBody: calendar_v3.Schema$Event = {};
  if (patch.summary !== undefined) requestBody.summary = patch.summary;
  if (patch.description !== undefined) requestBody.description = patch.description;
  if (patch.location !== undefined) requestBody.location = patch.location;
  if (patch.start !== undefined) requestBody.start = { dateTime: patch.start };
  if (patch.end !== undefined) requestBody.end = { dateTime: patch.end };
  if (patch.attendees !== undefined)
    requestBody.attendees = patch.attendees.map((email) => ({ email }));

  const res = await calendar.events.patch({
    calendarId: "primary",
    eventId,
    sendUpdates: "all",
    requestBody,
  });
  const event = parseEvent(res.data);
  console.info("calendar.updateEvent complete", {
    eventId: event.id,
    summary: event.summary,
    start: event.start,
    end: event.end,
  });
  return event;
}

export async function deleteEvent(eventId: string): Promise<void> {
  console.info("calendar.deleteEvent", { eventId });
  const calendar = google.calendar({ version: "v3", auth: getAuthClient() });
  await calendar.events.delete({
    calendarId: "primary",
    eventId,
    sendUpdates: "all",
  });
  console.info("calendar.deleteEvent complete", { eventId });
}

export async function checkFreeBusy(
  timeMin: string,
  timeMax: string,
  calendarIds?: string[],
): Promise<FreeBusyResult> {
  console.info("calendar.checkFreeBusy", { timeMin, timeMax, calendarIds });
  const calendar = google.calendar({ version: "v3", auth: getAuthClient() });
  const ids = calendarIds ?? ["primary"];
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin,
      timeMax,
      items: ids.map((id) => ({ id })),
    },
  });

  const result: FreeBusyResult = {};
  for (const [calId, calData] of Object.entries(res.data.calendars ?? {})) {
    result[calId] = {
      busy: (calData.busy ?? []).map((b) => ({
        start: b.start ?? "",
        end: b.end ?? "",
      })),
    };
  }
  return result;
}
