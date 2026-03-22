import { useCallback, useEffect, useRef, useState } from "react";
import CalendarView from "./components/CalendarView";
import ChatPanel from "./components/ChatPanel";
import InboxView from "./components/InboxView";
import { useBuckets } from "./hooks/useBuckets";
import { useCalendarEvents } from "./hooks/useCalendarEvents";
import { useConversations } from "./hooks/useConversations";
import { fetchApi, setCsrfToken } from "./lib/fetchApi";

type Tab = "inbox" | "calendar";

function UserMenu({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initial = email ? email[0].toUpperCase() : "?";

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold hover:bg-primary/80 transition-colors"
        onClick={() => setOpen(!open)}
        aria-label="User menu"
      >
        {initial}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-popover text-popover-foreground border border-border rounded-lg shadow-lg z-50 w-56 py-1">
          {email && (
            <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border truncate">
              {email}
            </div>
          )}
          <a
            href="/auth/logout"
            className="block px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Sign out
          </a>
        </div>
      )}
    </div>
  );
}

function AuthenticatedApp({ userEmail }: { userEmail: string | null }) {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("inbox");
  const [isGrouping, setIsGrouping] = useState(false);
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);

  const bucketsHook = useBuckets();
  const calendarHook = useCalendarEvents();
  const conversationsHook = useConversations();

  const activeTabRef = useRef<Tab>(activeTab);
  activeTabRef.current = activeTab;

  const handleAgentDone = useCallback(
    (toolNames: string[]) => {
      conversationsHook.refetch();
      setIsGrouping(false);
      if (toolNames.length === 0) return;
      if (activeTabRef.current === "inbox") {
        bucketsHook.refetch();
      } else {
        calendarHook.refetch();
      }
    },
    [bucketsHook.refetch, calendarHook.refetch, conversationsHook.refetch],
  );

  const handleGroupEmails = useCallback(
    async (bucketDefs: Array<{ name: string; description: string }>) => {
      // Delete existing buckets (agent will reclassify all threads)
      await Promise.all(
        bucketsHook.buckets.map((b) => fetchApi(`/api/buckets/${b.id}`, { method: "DELETE" })),
      );

      // Create new buckets
      for (const bucket of bucketDefs) {
        const description = bucket.description || `Emails related to ${bucket.name.toLowerCase()}`;
        const res = await fetchApi("/api/buckets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: bucket.name, description }),
        });
        if (!res.ok) {
          throw new Error(`Failed to create bucket "${bucket.name}"`);
        }
      }

      await bucketsHook.refetch();

      let convId = activeConversationId;
      if (!convId) {
        const conv = await conversationsHook.createConversation();
        convId = conv.id;
        setActiveConversationId(convId);
      }

      setIsGrouping(true);
      setQueuedMessage(
        "I've set up my email categories. Sync my last 200 email threads and classify every one into the existing buckets. Process all batches until none remain. Proceed immediately without asking for confirmation.",
      );
    },
    [activeConversationId, bucketsHook, conversationsHook.createConversation],
  );

  const handleTabSwitch = useCallback((tab: Tab) => {
    setActiveTab(tab);
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Full-width header */}
      <header className="border-b border-border bg-card px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={`relative px-4 py-3.5 text-sm font-medium transition-colors ${
              activeTab === "inbox"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => handleTabSwitch("inbox")}
          >
            <span className="flex items-center gap-2">
              <svg
                aria-hidden="true"
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859M12 3v8.25m0 0l-3-3m3 3l3-3"
                />
              </svg>
              Inbox
            </span>
            {activeTab === "inbox" && (
              <span className="absolute bottom-0 left-4 right-4 h-0.5 bg-primary rounded-full" />
            )}
          </button>
          <button
            type="button"
            className={`relative px-4 py-3.5 text-sm font-medium transition-colors ${
              activeTab === "calendar"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => handleTabSwitch("calendar")}
          >
            <span className="flex items-center gap-2">
              <svg
                aria-hidden="true"
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
                />
              </svg>
              Calendar
            </span>
            {activeTab === "calendar" && (
              <span className="absolute bottom-0 left-4 right-4 h-0.5 bg-primary rounded-full" />
            )}
          </button>
        </div>

        <UserMenu email={userEmail} />
      </header>

      {/* Body: dashboard + chat side by side */}
      <div className="flex flex-1 overflow-hidden">
        {/* Dashboard content */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {activeTab === "inbox" ? (
            <InboxView
              bucketsHook={bucketsHook}
              onGroupEmails={handleGroupEmails}
              isGrouping={isGrouping}
            />
          ) : (
            <CalendarView calendarHook={calendarHook} />
          )}
        </div>

        {/* Chat panel */}
        <ChatPanel
          conversationId={activeConversationId}
          onSelectConversation={setActiveConversationId}
          onNewChat={setActiveConversationId}
          onAgentDone={handleAgentDone}
          onTitleUpdate={() => conversationsHook.refetch()}
          conversationsHook={conversationsHook}
          disabled={isGrouping}
          queuedMessage={queuedMessage}
          onQueuedMessageSent={() => setQueuedMessage(null)}
        />
      </div>
    </div>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    fetch("/auth/status")
      .then((r) => r.json())
      .then(
        ({
          authenticated: isAuth,
          csrfToken,
          googleConnected: isGoogleConnected,
          email,
        }: {
          authenticated: boolean;
          csrfToken: string;
          googleConnected: boolean;
          email?: string;
        }) => {
          if (isAuth) {
            setCsrfToken(csrfToken);
            setAuthenticated(true);
            setGoogleConnected(isGoogleConnected);
            setUserEmail(email ?? null);
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
        <span>Loading\u2026</span>
      </div>
    );
  }

  if (!authenticated || !googleConnected) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Personal Assistant
          </h1>
          <p className="text-muted-foreground text-sm mt-2 mb-8">
            {authenticated
              ? "Reconnect your Google account to continue."
              : "AI-powered inbox triage, calendar management, and more."}
          </p>

          {!authenticated && (
            <div className="flex justify-center gap-6 mb-8">
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-10 h-10 rounded-lg bg-blue-400/10 flex items-center justify-center">
                  <svg
                    aria-hidden="true"
                    className="w-5 h-5 text-blue-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
                    />
                  </svg>
                </div>
                <span className="text-[11px] text-muted-foreground font-medium">Inbox</span>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-10 h-10 rounded-lg bg-emerald-400/10 flex items-center justify-center">
                  <svg
                    aria-hidden="true"
                    className="w-5 h-5 text-emerald-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
                    />
                  </svg>
                </div>
                <span className="text-[11px] text-muted-foreground font-medium">Calendar</span>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-10 h-10 rounded-lg bg-violet-400/10 flex items-center justify-center">
                  <svg
                    aria-hidden="true"
                    className="w-5 h-5 text-violet-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
                    />
                  </svg>
                </div>
                <span className="text-[11px] text-muted-foreground font-medium">Chat</span>
              </div>
            </div>
          )}

          <a
            href="/auth/google"
            className="inline-flex items-center gap-2.5 px-6 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium transition-colors"
          >
            <svg aria-hidden="true" className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            {authenticated ? "Reconnect Google" : "Sign in with Google"}
          </a>
        </div>
      </div>
    );
  }

  return <AuthenticatedApp userEmail={userEmail} />;
}
