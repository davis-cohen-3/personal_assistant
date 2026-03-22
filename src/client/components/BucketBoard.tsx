import { Spinner } from "@/components/ui/spinner";
import type { useBuckets } from "@/hooks/useBuckets";

interface Props {
  bucketsHook: ReturnType<typeof useBuckets>;
  onThreadClick: (threadId: string) => void;
}

export default function BucketBoard({ bucketsHook, onThreadClick }: Props) {
  const { buckets, loading, error } = bucketsHook;

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

  if (buckets.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No buckets yet. Ask the agent to set up email categories.
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="text-sm font-semibold mb-3">Email Buckets</h2>
      <div className="space-y-4">
        {buckets.map((bucket) => (
          <div key={bucket.id}>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              {bucket.name}
            </h3>
            <div className="space-y-1">
              {bucket.threads.map((thread) => (
                <button
                  type="button"
                  key={thread.id}
                  className="w-full text-left p-2 rounded-md border hover:bg-muted cursor-pointer text-sm"
                  onClick={() => onThreadClick(thread.gmail_thread_id)}
                >
                  <p className="font-medium truncate">{thread.subject ?? "(no subject)"}</p>
                  {thread.snippet && (
                    <p className="text-xs text-muted-foreground truncate">{thread.snippet}</p>
                  )}
                </button>
              ))}
              {bucket.threads.length === 0 && (
                <p className="text-xs text-muted-foreground pl-1">Empty</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
