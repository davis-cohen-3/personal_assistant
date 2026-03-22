import { useCallback, useEffect, useRef, useState } from "react";
import { fetchApi } from "../lib/fetchApi.js";

export interface CalendarEventAttendee {
  email: string;
  displayName?: string;
  responseStatus: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location?: string;
  description?: string;
  attendees?: CalendarEventAttendee[];
  htmlLink?: string;
}

const POLL_INTERVAL_MS = 5 * 60 * 1000;

function getWeekRange(): { timeMin: string; timeMax: string } {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
  // Find Monday: if today is Sunday (0), go back 6 days; otherwise go back (day - 1)
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 7);
  sunday.setHours(0, 0, 0, 0);

  return {
    timeMin: monday.toISOString(),
    timeMax: sunday.toISOString(),
  };
}

export function useCalendarEvents() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchingRef = useRef(false);

  const refetch = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setError(null);
    try {
      const { timeMin, timeMax } = getWeekRange();
      const params = new URLSearchParams({ timeMin, timeMax, maxResults: "25" });
      const res = await fetchApi(`/api/calendar/events?${params}`);
      if (!res.ok) throw new Error(`Failed to fetch events: ${res.status}`);
      const data: CalendarEvent[] = await res.json();
      setEvents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch events");
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    const id = setInterval(() => {
      refetch();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refetch]);

  return { events, loading, error, refetch };
}
