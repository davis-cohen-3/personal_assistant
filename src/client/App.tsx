import { useCallback, useEffect, useRef, useState } from "react";
import CalendarView from "./components/CalendarView";
import ChatPanel from "./components/ChatPanel";
import InboxView from "./components/InboxView";
import { useBuckets } from "./hooks/useBuckets";
import { useCalendarEvents } from "./hooks/useCalendarEvents";
import { useConversations } from "./hooks/useConversations";
import { setCsrfToken } from "./lib/fetchApi";

type Tab = "inbox" | "calendar";

function UserMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
        className="w-8 h-8 rounded-full bg-secondary text-muted-foreground flex items-center justify-center text-sm font-semibold hover:bg-accent hover:text-foreground transition-colors"
        onClick={() => setOpen(!open)}
        aria-label="User menu"
      >
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
            d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-popover text-popover-foreground border border-border rounded-lg shadow-lg z-50 w-40 py-1">
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

function AuthenticatedApp() {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("inbox");

  const bucketsHook = useBuckets();
  const calendarHook = useCalendarEvents();
  const conversationsHook = useConversations();

  const activeTabRef = useRef<Tab>(activeTab);
  activeTabRef.current = activeTab;

  const handleAgentDone = useCallback(
    (toolNames: string[]) => {
      conversationsHook.refetch();
      if (toolNames.length === 0) return;
      if (activeTabRef.current === "inbox") {
        bucketsHook.refetch();
      } else {
        calendarHook.refetch();
      }
    },
    [bucketsHook.refetch, calendarHook.refetch, conversationsHook.refetch],
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

        <UserMenu />
      </header>

      {/* Body: dashboard + chat side by side */}
      <div className="flex flex-1 overflow-hidden">
        {/* Dashboard content */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {activeTab === "inbox" ? (
            <InboxView bucketsHook={bucketsHook} />
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
        />
      </div>
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
        <span>Loading\u2026</span>
      </div>
    );
  }

  if (!authenticated || !googleConnected) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center space-y-6">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Personal Assistant
          </h1>
          <p className="text-muted-foreground text-sm">
            {authenticated
              ? "Reconnect your Google account to continue."
              : "Sign in to get started."}
          </p>
          <a
            href="/auth/google"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium transition-colors"
          >
            Sign in with Google
          </a>
        </div>
      </div>
    );
  }

  return <AuthenticatedApp />;
}
