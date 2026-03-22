import { useState } from "react";
import { Button } from "@/components/ui/button";

export interface BucketDraft {
  name: string;
  description: string;
}

const DEFAULT_BUCKETS: BucketDraft[] = [
  {
    name: "Important",
    description: "Urgent or high-priority emails requiring immediate attention",
  },
  { name: "Can Wait", description: "Non-urgent emails that can be addressed later" },
  { name: "Newsletter", description: "Subscriptions, digests, and regular email publications" },
  { name: "Auto-archive", description: "Low-value notifications and automated emails" },
];

interface Props {
  onConfirm: (buckets: BucketDraft[]) => Promise<void>;
  onCancel: () => void;
  initialBuckets?: BucketDraft[];
}

export default function GroupEmailsSetup({ onConfirm, onCancel, initialBuckets }: Props) {
  const [buckets, setBuckets] = useState<BucketDraft[]>(initialBuckets ?? DEFAULT_BUCKETS);
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateName = (index: number, name: string) => {
    setBuckets((prev) => prev.map((b, i) => (i === index ? { ...b, name } : b)));
  };

  const removeBucket = (index: number) => {
    setBuckets((prev) => prev.filter((_, i) => i !== index));
  };

  const addBucket = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setBuckets((prev) => [
      ...prev,
      { name: trimmed, description: `Emails related to ${trimmed.toLowerCase()}` },
    ]);
    setNewName("");
  };

  const validBuckets = buckets.filter((b) => b.name.trim().length > 0);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(validBuckets);
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : "Failed to create categories");
    }
  };

  return (
    <div className="px-8 py-10 max-w-md mx-auto">
      <h2 className="text-lg font-semibold text-foreground mb-1">Group your emails</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Edit the categories below, then we'll classify your inbox.
      </p>

      <div className="space-y-2 mb-4">
        {buckets.map((bucket, i) => (
          <div key={`bucket-${bucket.name}-${i}`} className="flex items-center gap-2 group">
            <input
              type="text"
              value={bucket.name}
              onChange={(e) => updateName(i, e.target.value)}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              disabled={submitting}
            />
            <button
              type="button"
              onClick={() => removeBucket(i)}
              disabled={submitting}
              className="p-1.5 rounded text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
              aria-label="Remove"
            >
              <svg
                aria-hidden="true"
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mb-8">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addBucket();
            }
          }}
          className="flex-1 rounded-lg border border-dashed border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
          placeholder="Add a category..."
          disabled={submitting}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={addBucket}
          disabled={submitting || !newName.trim()}
        >
          Add
        </Button>
      </div>

      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      <div className="flex gap-3">
        <Button onClick={handleSubmit} disabled={submitting || validBuckets.length === 0}>
          {submitting ? "Setting up..." : "Group emails"}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
