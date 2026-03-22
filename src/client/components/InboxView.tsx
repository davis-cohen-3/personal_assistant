import { useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import type { BucketThread, useBuckets } from "@/hooks/useBuckets";
import type { BucketDraft } from "./GroupEmailsSetup";
import GroupEmailsSetup from "./GroupEmailsSetup";
import ThreadDetail from "./ThreadDetail";

interface Props {
  bucketsHook: ReturnType<typeof useBuckets>;
  onGroupEmails: (buckets: BucketDraft[]) => Promise<void>;
  isGrouping: boolean;
}

const THREADS_PER_BUCKET = 5;

const BUCKET_COLORS = [
  { dot: "bg-blue-400", border: "border-l-blue-400/70", badge: "bg-blue-400/15 text-blue-300" },
  { dot: "bg-amber-400", border: "border-l-amber-400/70", badge: "bg-amber-400/15 text-amber-300" },
  {
    dot: "bg-emerald-400",
    border: "border-l-emerald-400/70",
    badge: "bg-emerald-400/15 text-emerald-300",
  },
  { dot: "bg-rose-400", border: "border-l-rose-400/70", badge: "bg-rose-400/15 text-rose-300" },
  {
    dot: "bg-violet-400",
    border: "border-l-violet-400/70",
    badge: "bg-violet-400/15 text-violet-300",
  },
  { dot: "bg-cyan-400", border: "border-l-cyan-400/70", badge: "bg-cyan-400/15 text-cyan-300" },
  {
    dot: "bg-orange-400",
    border: "border-l-orange-400/70",
    badge: "bg-orange-400/15 text-orange-300",
  },
  { dot: "bg-pink-400", border: "border-l-pink-400/70", badge: "bg-pink-400/15 text-pink-300" },
];

function getBucketColor(index: number) {
  return BUCKET_COLORS[index % BUCKET_COLORS.length];
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: "short" });
  }

  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function senderDisplay(thread: BucketThread): string {
  if (thread.from_name) return thread.from_name;
  if (thread.from_email) return thread.from_email.split("@")[0];
  return "Unknown";
}

const EMPTY_CATEGORIES = [
  { name: "Important", desc: "Urgent, high-priority" },
  { name: "Can Wait", desc: "Non-urgent follow-ups" },
  { name: "Newsletter", desc: "Subscriptions & digests" },
  { name: "Auto-archive", desc: "Low-value notifications" },
];

export default function InboxView({ bucketsHook, onGroupEmails, isGrouping }: Props) {
  const { buckets, loading, error } = bucketsHook;
  const [expandedBuckets, setExpandedBuckets] = useState<Set<string>>(new Set());
  const [expandedThread, setExpandedThread] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  const toggleBucketExpand = (bucketId: string) => {
    setExpandedBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(bucketId)) {
        next.delete(bucketId);
      } else {
        next.add(bucketId);
      }
      return next;
    });
  };

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

  if (showSetup) {
    const initialBuckets =
      buckets.length > 0
        ? buckets.map((b) => ({ name: b.name, description: b.description }))
        : undefined;
    return (
      <GroupEmailsSetup
        initialBuckets={initialBuckets}
        onConfirm={async (draftBuckets) => {
          await onGroupEmails(draftBuckets);
          setShowSetup(false);
        }}
        onCancel={() => setShowSetup(false)}
      />
    );
  }

  if (buckets.length === 0) {
    return (
      <div className="px-8 py-16 max-w-lg mx-auto">
        <h2 className="text-lg font-semibold text-foreground mb-1">Organize your inbox</h2>
        <p className="text-sm text-muted-foreground mb-6">
          We'll sort your last 200 emails into categories using AI. You can customize these first.
        </p>

        <div className="grid grid-cols-2 gap-2.5 mb-8">
          {EMPTY_CATEGORIES.map((cat, i) => {
            const color = getBucketColor(i);
            return (
              <div
                key={cat.name}
                className={`rounded-lg border border-border bg-card px-3.5 py-3 border-l-2 ${color.border}`}
              >
                <p className="text-[13px] font-medium text-foreground">{cat.name}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{cat.desc}</p>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium transition-colors"
          onClick={() => setShowSetup(true)}
        >
          Customize & classify
        </button>
      </div>
    );
  }

  return (
    <div className="py-4">
      <div className="px-8 mb-4 flex items-center justify-end">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          onClick={() => setShowSetup(true)}
          disabled={isGrouping}
        >
          <svg
            aria-hidden="true"
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
            />
          </svg>
          Regroup
        </button>
      </div>
      {isGrouping && (
        <div className="mx-8 mb-4 flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/10 px-4 py-2.5 text-sm text-primary">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          Classifying your inbox...
        </div>
      )}
      {buckets.map((bucket, bucketIdx) => {
        const isExpanded = expandedBuckets.has(bucket.id);
        const visibleThreads = isExpanded
          ? bucket.threads
          : bucket.threads.slice(0, THREADS_PER_BUCKET);
        const hasMore = bucket.threads.length > THREADS_PER_BUCKET;
        const color = getBucketColor(bucketIdx);

        return (
          <section key={bucket.id} className={bucketIdx > 0 ? "mt-5" : ""}>
            {/* Bucket header */}
            <div className="flex items-center gap-2.5 px-8 mb-1">
              <span className={`w-2 h-2 rounded-full ${color.dot} shrink-0`} />
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {bucket.name}
              </h3>
              <span
                className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-semibold tabular-nums ${color.badge}`}
              >
                {bucket.threads.length}
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {bucket.threads.length === 0 ? (
              <p className="px-8 py-3 text-xs text-muted-foreground italic">No threads</p>
            ) : (
              <div>
                {visibleThreads.map((thread) => {
                  const isActive = expandedThread === thread.gmail_thread_id;
                  return (
                    <div key={thread.id}>
                      <button
                        type="button"
                        className={`w-full text-left pl-8 pr-6 py-2 transition-colors flex items-center gap-3 group ${
                          isActive ? "bg-accent" : "hover:bg-muted/60"
                        }`}
                        onClick={() => setExpandedThread(isActive ? null : thread.gmail_thread_id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="text-[13px] font-semibold text-foreground truncate shrink-0 max-w-[180px]">
                              {senderDisplay(thread)}
                            </span>
                            <span className="text-[13px] text-foreground/80 truncate">
                              {thread.subject ?? "(no subject)"}
                            </span>
                            {thread.snippet && (
                              <span className="text-[12px] text-muted-foreground truncate hidden sm:inline">
                                — {thread.snippet}
                              </span>
                            )}
                          </div>
                        </div>
                        {thread.last_message_at && (
                          <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                            {formatTime(thread.last_message_at)}
                          </span>
                        )}
                        <svg
                          aria-hidden="true"
                          className={`w-3.5 h-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:text-muted-foreground ${
                            isActive ? "rotate-180 text-muted-foreground" : ""
                          }`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {isActive && (
                        <div className="border-y border-border bg-accent/50">
                          <ThreadDetail
                            threadId={thread.gmail_thread_id}
                            onClose={() => setExpandedThread(null)}
                            onTrash={() => {
                              setExpandedThread(null);
                              bucketsHook.refetch();
                            }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}

                {hasMore && !isExpanded && (
                  <button
                    type="button"
                    className="w-full text-left px-8 py-2 text-[12px] font-medium text-primary/70 hover:text-primary transition-colors"
                    onClick={() => toggleBucketExpand(bucket.id)}
                  >
                    Show {bucket.threads.length - THREADS_PER_BUCKET} more
                  </button>
                )}
                {hasMore && isExpanded && (
                  <button
                    type="button"
                    className="w-full text-left px-8 py-2 text-[12px] font-medium text-primary/70 hover:text-primary transition-colors"
                    onClick={() => toggleBucketExpand(bucket.id)}
                  >
                    Show less
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
