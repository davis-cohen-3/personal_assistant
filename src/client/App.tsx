import { useCallback, useEffect, useState } from "react";
import BucketBoard from "./components/BucketBoard";
import CalendarView from "./components/CalendarView";
import Chat from "./components/Chat";
import ConversationList from "./components/ConversationList";
import EventDetail from "./components/EventDetail";
import ThreadDetail from "./components/ThreadDetail";
import { useBuckets } from "./hooks/useBuckets";
import { useCalendarEvents } from "./hooks/useCalendarEvents";
import { useConversations } from "./hooks/useConversations";
import { setCsrfToken } from "./lib/fetchApi";

function AuthenticatedApp() {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [activeEvent, setActiveEvent] = useState<string | null>(null);

  const bucketsHook = useBuckets();
  const calendarHook = useCalendarEvents();
  const conversationsHook = useConversations();

  const handleAgentDone = useCallback(() => {
    bucketsHook.refetch();
    calendarHook.refetch();
    conversationsHook.refetch();
  }, [bucketsHook.refetch, calendarHook.refetch, conversationsHook.refetch]);

  return (
    <div className="flex h-screen overflow-hidden">
      <ConversationList
        activeConversationId={activeConversationId}
        onSelect={setActiveConversationId}
        onNewChat={setActiveConversationId}
        conversationsHook={conversationsHook}
      />

      <Chat
        conversationId={activeConversationId}
        onAgentDone={handleAgentDone}
        onTitleUpdate={() => conversationsHook.refetch()}
      />

      <div className="w-80 border-l overflow-y-auto shrink-0">
        <BucketBoard bucketsHook={bucketsHook} onThreadClick={setActiveThread} />
        <CalendarView calendarHook={calendarHook} onEventClick={setActiveEvent} />
      </div>

      {activeThread && (
        <ThreadDetail
          threadId={activeThread}
          onClose={() => setActiveThread(null)}
          onArchive={() => {
            setActiveThread(null);
            bucketsHook.refetch();
          }}
        />
      )}
      {activeEvent && <EventDetail eventId={activeEvent} onClose={() => setActiveEvent(null)} />}
    </div>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);

  useEffect(() => {
    fetch("/auth/status")
      .then((r) => r.json())
      .then(
        ({
          authenticated: isAuth,
          csrfToken,
          googleConnected: isGoogleConnected,
        }: {
          authenticated: boolean;
          csrfToken: string;
          googleConnected?: boolean;
        }) => {
          if (isAuth) {
            setCsrfToken(csrfToken);
            setAuthenticated(true);
            setGoogleConnected(isGoogleConnected ?? false);
          } else {
            setAuthenticated(false);
          }
        },
      )
      .catch((err: unknown) => {
        console.error("Failed to check auth status", { error: err });
        setAuthenticated(false);
      });
  }, []);

  if (authenticated === null) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        <span>Loading…</span>
      </div>
    );
  }

  if (!authenticated || !googleConnected) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center space-y-6">
          <h1 className="text-2xl font-semibold">Personal Assistant</h1>
          <p className="text-muted-foreground text-sm">
            {authenticated
              ? "Reconnect your Google account to continue."
              : "Sign in to get started."}
          </p>
          <a
            href="/auth/google"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium"
          >
            Sign in with Google
          </a>
        </div>
      </div>
    );
  }

  return <AuthenticatedApp />;
}
