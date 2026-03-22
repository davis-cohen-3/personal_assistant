import { useCallback, useEffect, useRef, useState } from "react";
import { fetchApi } from "../lib/fetchApi.js";

export interface BucketThread {
  id: string;
  gmail_thread_id: string;
  bucket_id: string;
  subject: string | null;
  snippet: string | null;
  from_name: string | null;
  from_email: string | null;
  last_message_at: string | null;
}

export interface BucketWithThreads {
  id: string;
  name: string;
  description: string;
  sort_order: number;
  threads: BucketThread[];
}

const POLL_INTERVAL_MS = 5 * 60 * 1000;

export function useBuckets() {
  const [buckets, setBuckets] = useState<BucketWithThreads[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchingRef = useRef(false);

  const refetch = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setError(null);
    try {
      const res = await fetchApi("/api/buckets");
      if (!res.ok) throw new Error(`Failed to fetch buckets: ${res.status}`);
      const data: BucketWithThreads[] = await res.json();
      setBuckets(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch buckets");
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    const id = setInterval(async () => {
      await fetchApi("/api/gmail/sync", { method: "POST" }).catch(() => {});
      await refetch();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refetch]);

  return { buckets, loading, error, refetch };
}
