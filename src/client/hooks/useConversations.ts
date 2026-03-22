import { useCallback, useEffect, useRef, useState } from "react";
import type { Conversation } from "../../shared/types.js";
import { fetchApi } from "../lib/fetchApi.js";

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchingRef = useRef(false);

  const refetch = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setError(null);
    try {
      const res = await fetchApi("/api/conversations");
      if (!res.ok) throw new Error(`Failed to fetch conversations: ${res.status}`);
      const data: Conversation[] = await res.json();
      setConversations(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch conversations");
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [refetch]);

  const createConversation = useCallback(async (): Promise<Conversation> => {
    const res = await fetchApi("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`Failed to create conversation: ${res.status}`);
    const conversation: Conversation = await res.json();
    await refetch();
    return conversation;
  }, [refetch]);

  const updateConversation = useCallback(
    async (id: string, updates: { title: string }) => {
      const res = await fetchApi(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(`Failed to update conversation: ${res.status}`);
      await refetch();
    },
    [refetch],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      const res = await fetchApi(`/api/conversations/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Failed to delete conversation: ${res.status}`);
      await refetch();
    },
    [refetch],
  );

  return {
    conversations,
    loading,
    error,
    refetch,
    createConversation,
    updateConversation,
    deleteConversation,
  };
}
