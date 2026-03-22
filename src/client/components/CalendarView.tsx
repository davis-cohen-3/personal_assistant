import { useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import type { CalendarEvent, useCalendarEvents } from "@/hooks/useCalendarEvents";
import EventDetail from "./EventDetail";

interface Props {
  calendarHook: ReturnType<typeof useCalendarEvents>;
}

function getWeekDays(): Date[] {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);

  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }
  return days;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

function isPast(date: Date): boolean {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return date < now;
}

function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function groupEventsByDay(events: CalendarEvent[], days: Date[]): Map<string, CalendarEvent[]> {
  const grouped = new Map<string, CalendarEvent[]>();
  for (const day of days) {
    grouped.set(day.toDateString(), []);
  }
  for (const event of events) {
    const eventDate = new Date(event.start);
    const key = new Date(
      eventDate.getFullYear(),
      eventDate.getMonth(),
      eventDate.getDate(),
    ).toDateString();
    const existing = grouped.get(key);
    if (existing) {
      existing.push(event);
    }
  }
  return grouped;
}

export default function CalendarView({ calendarHook }: Props) {
  const { events, loading, error } = calendarHook;
  const [activeEvent, setActiveEvent] = useState<string | null>(null);
  const weekDays = getWeekDays();
  const grouped = groupEventsByDay(events, weekDays);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return <div className="px-8 py-6 text-sm text-destructive">{error}</div>;
  }

  return (
    <div className="py-4">
      {weekDays.map((day, dayIdx) => {
        const dayKey = day.toDateString();
        const dayEvents = grouped.get(dayKey) ?? [];
        const today = isToday(day);
        const past = isPast(day) && !today;

        return (
          <section key={dayKey} className={dayIdx > 0 ? "mt-2" : ""}>
            {/* Day header */}
            <div className={`flex items-center gap-3 px-8 py-2 ${today ? "bg-primary/10" : ""}`}>
              {today && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
              <h3
                className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${
                  today ? "text-primary" : past ? "text-muted-foreground" : "text-foreground/80"
                }`}
              >
                {day.toLocaleDateString([], { weekday: "long" })}
              </h3>
              <span
                className={`text-[11px] tabular-nums ${
                  today
                    ? "text-primary/80 font-medium"
                    : past
                      ? "text-muted-foreground/70"
                      : "text-muted-foreground"
                }`}
              >
                {day.toLocaleDateString([], { month: "short", day: "numeric" })}
              </span>
              <div className="flex-1 h-px bg-border" />
              {dayEvents.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-muted text-[10px] font-semibold text-muted-foreground tabular-nums">
                  {dayEvents.length}
                </span>
              )}
            </div>

            {dayEvents.length === 0 ? (
              <p
                className={`px-8 py-2 text-[12px] italic ${past ? "text-muted-foreground/70" : "text-muted-foreground"}`}
              >
                No events
              </p>
            ) : (
              <div>
                {dayEvents.map((event) => (
                  <div key={event.id}>
                    <button
                      type="button"
                      className={`w-full text-left px-8 py-3 transition-colors flex items-center gap-4 group ${
                        activeEvent === event.id ? "bg-accent" : "hover:bg-muted/60"
                      }`}
                      onClick={() => setActiveEvent(activeEvent === event.id ? null : event.id)}
                    >
                      <div className="w-[72px] shrink-0">
                        <span
                          className={`text-[12px] tabular-nums font-medium ${past ? "text-muted-foreground" : "text-foreground/70"}`}
                        >
                          {formatEventTime(event.start)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-[13px] font-medium truncate ${past ? "text-foreground/70" : "text-foreground"}`}
                        >
                          {event.summary}
                        </p>
                        {event.location && (
                          <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                            {event.location}
                          </p>
                        )}
                      </div>
                      <span
                        className={`text-[11px] shrink-0 tabular-nums ${past ? "text-muted-foreground/70" : "text-muted-foreground"}`}
                      >
                        {formatEventTime(event.end)}
                      </span>
                    </button>

                    {activeEvent === event.id && (
                      <div className="border-y border-border bg-accent/50">
                        <EventDetail eventId={event.id} onClose={() => setActiveEvent(null)} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
