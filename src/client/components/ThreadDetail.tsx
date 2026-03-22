import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { fetchApi } from "@/lib/fetchApi";

interface Message {
  gmail_message_id: string;
  from: string;
  date: string;
  body_text: string;
}

interface Thread {
  id: string;
  subject: string;
  messages: Message[];
}

interface Props {
  threadId: string;
  onClose: () => void;
  onArchive: () => void;
}

export default function ThreadDetail({ threadId, onClose, onArchive }: Props) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [replySent, setReplySent] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchThread = useCallback(
    async (markRead: boolean) => {
      setLoading(true);
      try {
        const r = await fetchApi(`/api/gmail/threads/${threadId}`);
        const data: Thread = await r.json();
        setThread(data);
        // Scroll to bottom after React renders the new messages
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
        if (markRead) {
          const latest = data.messages[data.messages.length - 1];
          if (latest) {
            fetchApi(`/api/gmail/messages/${latest.gmail_message_id}/read`, {
              method: "POST",
            }).catch((err: unknown) => {
              console.error("Failed to mark message as read", { error: err });
            });
          }
        }
      } catch (err) {
        console.error("Failed to load thread", { threadId, error: err });
      } finally {
        setLoading(false);
      }
    },
    [threadId],
  );

  useEffect(() => {
    fetchThread(true);
  }, [fetchThread]);

  const handleReply = async () => {
    if (!thread || !replyBody.trim()) return;
    const lastMessage = thread.messages[thread.messages.length - 1];
    setSending(true);
    try {
      await fetchApi(`/api/gmail/threads/${threadId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: replyBody, messageId: lastMessage.gmail_message_id }),
      });
      setReplyBody("");
      setReplySent(true);
      setTimeout(() => setReplySent(false), 3000);
      await fetchThread(false);
    } catch (err) {
      console.error("Failed to send reply", { error: err });
    } finally {
      setSending(false);
    }
  };

  const handleArchive = async () => {
    try {
      await fetchApi(`/api/gmail/threads/${threadId}/archive`, { method: "POST" });
      onArchive();
    } catch (err) {
      console.error("Failed to archive thread", { threadId, error: err });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold truncate">{thread?.subject ?? "Loading…"}</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleArchive}>
              Archive
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              ✕
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : (
            <>
              {thread?.messages.map((msg) => (
                <div key={msg.gmail_message_id} className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{msg.from}</span>
                    <span>{new Date(msg.date).toLocaleString()}</span>
                  </div>
                  {/* Plain text only — never dangerouslySetInnerHTML for email content */}
                  <pre className="text-sm whitespace-pre-wrap font-sans">{msg.body_text}</pre>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        <div className="p-4 border-t space-y-2">
          {replySent && <div className="text-sm text-green-600 font-medium">Reply sent</div>}
          <textarea
            className="w-full rounded-md border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            rows={3}
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Write a reply…"
          />
          <Button onClick={handleReply} disabled={sending || !replyBody.trim()} size="sm">
            {sending ? "Sending…" : "Reply"}
          </Button>
        </div>
      </div>
    </div>
  );
}
