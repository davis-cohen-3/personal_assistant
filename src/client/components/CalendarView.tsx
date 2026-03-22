import { Spinner } from "@/components/ui/spinner";
import type { useCalendarEvents } from "@/hooks/useCalendarEvents";

interface Props {
  calendarHook: ReturnType<typeof useCalendarEvents>;
  onEventClick: (eventId: string) => void;
}

function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function CalendarView({ calendarHook, onEventClick }: Props) {
  const { events, loading, error } = calendarHook;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return <div className="p-4 text-sm text-destructive">{error}</div>;
  }

  return (
    <div className="p-4">
      <h2 className="text-sm font-semibold mb-3">Today</h2>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No events today</p>
      ) : (
        <div className="space-y-1">
          {events.map((event) => (
            <button
              type="button"
              key={event.id}
              className="w-full text-left p-2 rounded-md border hover:bg-muted cursor-pointer text-sm"
              onClick={() => onEventClick(event.id)}
            >
              <p className="font-medium truncate">{event.summary}</p>
              <p className="text-xs text-muted-foreground">
                {formatEventTime(event.start)} – {formatEventTime(event.end)}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
