import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { fetchApi } from "@/lib/fetchApi";

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  attendees?: string[];
}

interface Props {
  eventId: string;
  onClose: () => void;
}

export default function EventDetail({ eventId, onClose }: Props) {
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editSummary, setEditSummary] = useState("");

  useEffect(() => {
    setLoading(true);
    fetchApi(`/api/calendar/events/${eventId}`)
      .then((r) => r.json())
      .then((data: CalendarEvent) => {
        setEvent(data);
        setEditSummary(data.summary);
      })
      .catch((err: unknown) => {
        console.error("Failed to load event", { eventId, error: err });
      })
      .finally(() => setLoading(false));
  }, [eventId]);

  const handleSave = async () => {
    if (!event) return;
    try {
      const res = await fetchApi(`/api/calendar/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: editSummary }),
      });
      if (!res.ok) throw new Error(`Failed to update event: ${res.status}`);
      const updated: CalendarEvent = await res.json();
      setEvent(updated);
      setEditing(false);
    } catch (err) {
      console.error("Failed to save event", { eventId, error: err });
    }
  };

  const handleDelete = async () => {
    if (!confirm("Cancel this event?")) return;
    try {
      await fetchApi(`/api/calendar/events/${eventId}`, { method: "DELETE" });
      onClose();
    } catch (err) {
      console.error("Failed to delete event", { eventId, error: err });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-lg flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold">Event Details</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>

        <div className="p-4 space-y-3">
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : event ? (
            <>
              {editing ? (
                <input
                  className="w-full rounded-md border px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-ring"
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                />
              ) : (
                <h3 className="text-lg font-semibold">{event.summary}</h3>
              )}
              <p className="text-sm text-muted-foreground">
                {new Date(event.start).toLocaleString()} –{" "}
                {new Date(event.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
              {event.location && <p className="text-sm">{event.location}</p>}
              {event.description && (
                <p className="text-sm text-muted-foreground">{event.description}</p>
              )}
              {event.attendees && event.attendees.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Attendees</p>
                  <div className="space-y-0.5">
                    {event.attendees.map((a) => (
                      <p key={a} className="text-sm">
                        {a}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        <div className="p-4 border-t flex gap-2">
          {editing ? (
            <>
              <Button size="sm" onClick={handleSave}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button size="sm" variant="destructive" onClick={handleDelete}>
                Delete
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
