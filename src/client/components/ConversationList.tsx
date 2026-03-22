import { Button } from "@/components/ui/button";
import type { useConversations } from "@/hooks/useConversations";

interface Props {
  activeConversationId: string | null;
  onSelect: (id: string | null) => void;
  onNewChat: (id: string) => void;
  conversationsHook: ReturnType<typeof useConversations>;
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export default function ConversationList({
  activeConversationId,
  onSelect,
  onNewChat,
  conversationsHook,
}: Props) {
  const { conversations, createConversation, deleteConversation } = conversationsHook;

  const handleNewChat = async () => {
    const conversation = await createConversation();
    onNewChat(conversation.id);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteConversation(id);
    if (activeConversationId === id) {
      const remaining = conversations.filter((c) => c.id !== id);
      onSelect(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  return (
    <div className="w-64 border-r flex flex-col h-full shrink-0">
      <div className="p-3 border-b">
        <Button onClick={handleNewChat} className="w-full">
          New Chat
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {conversations.map((conv) => (
          <button
            type="button"
            key={conv.id}
            className={`group relative w-full text-left p-3 cursor-pointer hover:bg-muted ${
              conv.id === activeConversationId ? "bg-muted" : ""
            }`}
            onClick={() => onSelect(conv.id)}
          >
            <p className="text-sm font-medium truncate pr-6">{conv.title}</p>
            <p className="text-xs text-muted-foreground">{formatRelativeTime(conv.updated_at)}</p>
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1 rounded"
              onClick={(e) => handleDelete(e, conv.id)}
              aria-label="Delete conversation"
            >
              ×
            </button>
          </button>
        ))}
      </div>
      <div className="p-3 border-t">
        <a href="/auth/logout" className="text-xs text-muted-foreground hover:text-foreground">
          Sign out
        </a>
      </div>
    </div>
  );
}
