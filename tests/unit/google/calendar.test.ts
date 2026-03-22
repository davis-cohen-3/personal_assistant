import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockEventsList,
  mockEventsGet,
  mockEventsInsert,
  mockEventsPatch,
  mockEventsDelete,
  mockFreebusyQuery,
} = vi.hoisted(() => ({
  mockEventsList: vi.fn(),
  mockEventsGet: vi.fn(),
  mockEventsInsert: vi.fn(),
  mockEventsPatch: vi.fn(),
  mockEventsDelete: vi.fn(),
  mockFreebusyQuery: vi.fn(),
}));

vi.mock("googleapis", () => ({
  google: {
    calendar: vi.fn(() => ({
      events: {
        list: mockEventsList,
        get: mockEventsGet,
        insert: mockEventsInsert,
        patch: mockEventsPatch,
        delete: mockEventsDelete,
      },
      freebusy: {
        query: mockFreebusyQuery,
      },
    })),
  },
}));

import {
  checkFreeBusy,
  createEvent,
  deleteEvent,
  getEvent,
  listEvents,
  parseEvent,
  updateEvent,
} from "../../../src/server/google/calendar.js";

const mockAuth = {} as never;

const makeTimedEvent = (overrides?: object) => ({
  id: "event1",
  summary: "Team Meeting",
  description: "Weekly sync",
  start: { dateTime: "2024-04-01T10:00:00Z", timeZone: "UTC" },
  end: { dateTime: "2024-04-01T11:00:00Z", timeZone: "UTC" },
  attendees: [
    { email: "alice@example.com", displayName: "Alice", responseStatus: "accepted" },
    { email: "bob@example.com", displayName: "Bob", responseStatus: "tentative" },
  ],
  status: "confirmed",
  htmlLink: "https://calendar.google.com/event?eid=abc",
  organizer: { email: "alice@example.com", displayName: "Alice" },
  location: "Conference Room A",
  ...overrides,
});

const makeAllDayEvent = () => ({
  id: "event2",
  summary: "Team Offsite",
  start: { date: "2024-04-15" },
  end: { date: "2024-04-16" },
  status: "confirmed",
  htmlLink: "https://calendar.google.com/event?eid=def",
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listEvents", () => {
  it("calls events.list with singleEvents and orderBy startTime", async () => {
    mockEventsList.mockResolvedValue({ data: { items: [makeTimedEvent()] } });

    await listEvents(mockAuth, "2024-04-01T00:00:00Z", "2024-04-07T23:59:59Z");

    expect(mockEventsList).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "primary",
        timeMin: "2024-04-01T00:00:00Z",
        timeMax: "2024-04-07T23:59:59Z",
        singleEvents: true,
        orderBy: "startTime",
      }),
    );
  });

  it("returns parsed events", async () => {
    mockEventsList.mockResolvedValue({ data: { items: [makeTimedEvent()] } });

    const result = await listEvents(mockAuth, "2024-04-01T00:00:00Z", "2024-04-07T23:59:59Z");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("event1");
    expect(result[0].summary).toBe("Team Meeting");
  });

  it("passes maxResults opt when provided", async () => {
    mockEventsList.mockResolvedValue({ data: { items: [] } });

    await listEvents(mockAuth, "2024-04-01T00:00:00Z", "2024-04-07T23:59:59Z", { maxResults: 50 });

    expect(mockEventsList).toHaveBeenCalledWith(
      expect.objectContaining({ maxResults: 50 }),
    );
  });

  it("passes q opt when provided", async () => {
    mockEventsList.mockResolvedValue({ data: { items: [] } });

    await listEvents(mockAuth, "2024-04-01T00:00:00Z", "2024-04-07T23:59:59Z", { q: "standup" });

    expect(mockEventsList).toHaveBeenCalledWith(
      expect.objectContaining({ q: "standup" }),
    );
  });

  it("returns empty array when no items", async () => {
    mockEventsList.mockResolvedValue({ data: {} });

    const result = await listEvents(mockAuth, "2024-04-01T00:00:00Z", "2024-04-07T23:59:59Z");

    expect(result).toEqual([]);
  });
});

describe("getEvent", () => {
  it("calls events.get with calendarId primary", async () => {
    mockEventsGet.mockResolvedValue({ data: makeTimedEvent() });

    await getEvent(mockAuth, "event1");

    expect(mockEventsGet).toHaveBeenCalledWith({
      calendarId: "primary",
      eventId: "event1",
    });
  });

  it("returns parsed event", async () => {
    mockEventsGet.mockResolvedValue({ data: makeTimedEvent() });

    const result = await getEvent(mockAuth, "event1");

    expect(result.id).toBe("event1");
    expect(result.isAllDay).toBe(false);
    expect(result.start).toBe("2024-04-01T10:00:00Z");
  });
});

describe("createEvent", () => {
  it("calls events.insert with sendUpdates all", async () => {
    mockEventsInsert.mockResolvedValue({ data: makeTimedEvent() });

    await createEvent(mockAuth, {
      summary: "New Meeting",
      start: "2024-04-10T09:00:00Z",
      end: "2024-04-10T10:00:00Z",
    });

    expect(mockEventsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "primary",
        sendUpdates: "all",
      }),
    );
  });

  it("passes event fields in requestBody", async () => {
    mockEventsInsert.mockResolvedValue({ data: makeTimedEvent() });

    await createEvent(mockAuth, {
      summary: "New Meeting",
      start: "2024-04-10T09:00:00Z",
      end: "2024-04-10T10:00:00Z",
      attendees: ["alice@example.com"],
    });

    expect(mockEventsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          summary: "New Meeting",
          attendees: [{ email: "alice@example.com" }],
        }),
      }),
    );
  });

  it("returns parsed event", async () => {
    mockEventsInsert.mockResolvedValue({ data: makeTimedEvent() });

    const result = await createEvent(mockAuth, {
      summary: "New Meeting",
      start: "2024-04-10T09:00:00Z",
      end: "2024-04-10T10:00:00Z",
    });

    expect(result.id).toBe("event1");
  });
});

describe("updateEvent", () => {
  it("calls events.patch with sendUpdates all", async () => {
    mockEventsPatch.mockResolvedValue({ data: makeTimedEvent({ summary: "Updated" }) });

    await updateEvent(mockAuth, "event1", { summary: "Updated" });

    expect(mockEventsPatch).toHaveBeenCalledWith({
      calendarId: "primary",
      eventId: "event1",
      sendUpdates: "all",
      requestBody: { summary: "Updated" },
    });
  });

  it("returns parsed updated event", async () => {
    mockEventsPatch.mockResolvedValue({ data: makeTimedEvent({ summary: "Updated" }) });

    const result = await updateEvent(mockAuth, "event1", { summary: "Updated" });

    expect(result.summary).toBe("Updated");
  });
});

describe("deleteEvent", () => {
  it("calls events.delete with sendUpdates all", async () => {
    mockEventsDelete.mockResolvedValue({ data: {} });

    await deleteEvent(mockAuth, "event1");

    expect(mockEventsDelete).toHaveBeenCalledWith({
      calendarId: "primary",
      eventId: "event1",
      sendUpdates: "all",
    });
  });
});

describe("checkFreeBusy", () => {
  it("defaults to primary calendar", async () => {
    mockFreebusyQuery.mockResolvedValue({
      data: { calendars: { primary: { busy: [] } } },
    });

    await checkFreeBusy(mockAuth, "2024-04-01T00:00:00Z", "2024-04-01T23:59:59Z");

    expect(mockFreebusyQuery).toHaveBeenCalledWith({
      requestBody: expect.objectContaining({
        items: [{ id: "primary" }],
      }),
    });
  });

  it("accepts custom calendar ids", async () => {
    mockFreebusyQuery.mockResolvedValue({
      data: {
        calendars: {
          "cal1@group.calendar.google.com": { busy: [] },
        },
      },
    });

    await checkFreeBusy(mockAuth, "2024-04-01T00:00:00Z", "2024-04-01T23:59:59Z", [
      "cal1@group.calendar.google.com",
    ]);

    expect(mockFreebusyQuery).toHaveBeenCalledWith({
      requestBody: expect.objectContaining({
        items: [{ id: "cal1@group.calendar.google.com" }],
      }),
    });
  });

  it("returns busy intervals per calendar", async () => {
    mockFreebusyQuery.mockResolvedValue({
      data: {
        calendars: {
          primary: {
            busy: [
              { start: "2024-04-01T10:00:00Z", end: "2024-04-01T11:00:00Z" },
            ],
          },
        },
      },
    });

    const result = await checkFreeBusy(
      mockAuth,
      "2024-04-01T00:00:00Z",
      "2024-04-01T23:59:59Z",
    );

    expect(result.primary.busy).toHaveLength(1);
    expect(result.primary.busy[0].start).toBe("2024-04-01T10:00:00Z");
  });
});

describe("parseEvent", () => {
  it("normalizes timed event: isAllDay false, start from dateTime", () => {
    const result = parseEvent(makeTimedEvent());

    expect(result.isAllDay).toBe(false);
    expect(result.start).toBe("2024-04-01T10:00:00Z");
    expect(result.end).toBe("2024-04-01T11:00:00Z");
  });

  it("normalizes all-day event: isAllDay true, start from date", () => {
    const result = parseEvent(makeAllDayEvent());

    expect(result.isAllDay).toBe(true);
    expect(result.start).toBe("2024-04-15");
    expect(result.end).toBe("2024-04-16");
  });

  it("extracts attendees list", () => {
    const result = parseEvent(makeTimedEvent());

    expect(result.attendees).toHaveLength(2);
    expect(result.attendees[0].email).toBe("alice@example.com");
    expect(result.attendees[0].responseStatus).toBe("accepted");
  });

  it("returns empty attendees array when none", () => {
    const result = parseEvent(makeTimedEvent({ attendees: undefined }));

    expect(result.attendees).toEqual([]);
  });
});
