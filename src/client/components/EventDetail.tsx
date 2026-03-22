import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { fetchApi } from "@/lib/fetchApi";

interface CalendarEventAttendee {
  email: string;
  displayName?: string;
  responseStatus: string;
}

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  attendees?: CalendarEventAttendee[];
  htmlLink?: string;
}

interface Props {
  eventId: string;
  onClose: () => void;
}

function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as Element;
    const children = Array.from(el.childNodes).map(walk).join("");
    if (el.tagName === "A") {
      const href = el.getAttribute("href");
      if (href) return `\n${href}\n`;
    }
    if (el.tagName === "BR" || el.tagName === "P" || el.tagName === "DIV") {
      return `${children}\n`;
    }
    return children;
  };
  return walk(doc.body)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const URL_REGEX = /https?:\/\/[^\s]+/g;

function renderWithLinks(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null = URL_REGEX.exec(text);
  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const url = match[0];
    parts.push(
      <a
        key={match.index}
        href={url}
        className="text-primary underline hover:text-primary/80"
        target="_blank"
        rel="noopener noreferrer"
      >
        {url.length > 60 ? `${url.slice(0, 57)}...` : url}
      </a>,
    );
    lastIndex = match.index + url.length;
    match = URL_REGEX.exec(text);
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

export default function EventDetail({ eventId, onClose }: Props) {
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchApi(`/api/calendar/events/${encodeURIComponent(eventId)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load event: ${r.status}`);
        return r.json();
      })
      .then((data: CalendarEvent) => {
        setEvent(data);
      })
      .catch((err: unknown) => {
        console.error("Failed to load event", { eventId, error: err });
        setError(err instanceof Error ? err.message : "Failed to load event");
      })
      .finally(() => setLoading(false));
  }, [eventId]);

  return (
    <div className="px-6 py-4">
      {loading ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : error ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-destructive">{error}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      ) : event ? (
        <>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold truncate pr-4 text-foreground">{event.summary}</h4>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs shrink-0 text-muted-foreground hover:text-foreground"
              onClick={onClose}
            >
              Close
            </Button>
          </div>

          <div className="space-y-2 text-xs">
            <p className="text-muted-foreground">
              {new Date(event.start).toLocaleString()} &ndash;{" "}
              {new Date(event.end).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
            {event.location && <p className="text-foreground/80">{event.location}</p>}
            {event.description && (
              <p className="text-muted-foreground whitespace-pre-line">
                {renderWithLinks(sanitizeHtml(event.description))}
              </p>
            )}
            {event.attendees && event.attendees.length > 0 && (
              <div>
                <p className="font-medium text-muted-foreground mb-0.5">Attendees</p>
                <div className="space-y-0.5">
                  {event.attendees.map((a) => (
                    <p key={a.email} className="text-foreground/80">
                      {a.displayName ?? a.email}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
