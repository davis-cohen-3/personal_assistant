import { useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import type { BucketThread, useBuckets } from "@/hooks/useBuckets";
import ThreadDetail from "./ThreadDetail";

interface Props {
  bucketsHook: ReturnType<typeof useBuckets>;
}

const THREADS_PER_BUCKET = 5;

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

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

export default function InboxView({ bucketsHook }: Props) {
  const { buckets, loading, error } = bucketsHook;
  const [expandedBuckets, setExpandedBuckets] = useState<Set<string>>(new Set());
  const [expandedThread, setExpandedThread] = useState<string | null>(null);

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

  if (buckets.length === 0) {
    return (
      <div className="px-8 py-20 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted mb-4">
          <svg
            aria-hidden="true"
            className="w-6 h-6 text-muted-foreground"
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
        </div>
        <p className="text-muted-foreground text-sm font-medium">No buckets yet</p>
        <p className="text-muted-foreground text-xs mt-1">
          Ask the agent to set up email categories.
        </p>
      </div>
    );
  }

  return (
    <div className="py-4">
      {buckets.map((bucket, bucketIdx) => {
        const isExpanded = expandedBuckets.has(bucket.id);
        const visibleThreads = isExpanded
          ? bucket.threads
          : bucket.threads.slice(0, THREADS_PER_BUCKET);
        const hasMore = bucket.threads.length > THREADS_PER_BUCKET;

        return (
          <section key={bucket.id} className={bucketIdx > 0 ? "mt-6" : ""}>
            {/* Bucket header */}
            <div className="flex items-center gap-3 px-8 mb-1">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {bucket.name}
              </h3>
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-muted text-[10px] font-semibold text-muted-foreground tabular-nums">
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
                        className={`w-full text-left px-8 py-3 transition-colors flex items-start gap-4 group ${
                          isActive ? "bg-accent" : "hover:bg-muted/60"
                        }`}
                        onClick={() => setExpandedThread(isActive ? null : thread.gmail_thread_id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 mb-0.5">
                            <span className="text-[13px] font-semibold text-foreground truncate">
                              {senderDisplay(thread)}
                            </span>
                            {thread.last_message_at && (
                              <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                                {formatTime(thread.last_message_at)}
                              </span>
                            )}
                          </div>
                          <p className="text-[13px] text-foreground/90 truncate leading-snug">
                            {thread.subject ?? "(no subject)"}
                          </p>
                          {thread.snippet && (
                            <p className="text-[12px] text-muted-foreground truncate mt-0.5 leading-snug">
                              {thread.snippet}
                            </p>
                          )}
                        </div>
                        <svg
                          aria-hidden="true"
                          className={`w-4 h-4 shrink-0 text-muted-foreground/50 mt-0.5 transition-transform group-hover:text-muted-foreground ${
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
                    className="w-full text-left px-8 py-2.5 text-[12px] font-medium text-primary/70 hover:text-primary transition-colors"
                    onClick={() => toggleBucketExpand(bucket.id)}
                  >
                    Show {bucket.threads.length - THREADS_PER_BUCKET} more
                  </button>
                )}
                {hasMore && isExpanded && (
                  <button
                    type="button"
                    className="w-full text-left px-8 py-2.5 text-[12px] font-medium text-primary/70 hover:text-primary transition-colors"
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
