// Chat message shape used by both frontend and backend
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  streaming?: boolean;
  tools?: string[];
}

// WebSocket messages: frontend → backend
export interface WsChatMessage {
  type: "chat";
  content: string;
}

// WebSocket messages: backend → frontend
export interface WsTextDelta {
  type: "text_delta";
  content: string;
}

export interface WsTextDone {
  type: "text_done";
  content: string;
}

export interface WsError {
  type: "error";
  message: string;
}

export interface WsConversationUpdated {
  type: "conversation_updated";
  conversationId: string;
  title: string;
}

export interface WsToolStatus {
  type: "tool_status";
  toolName: string;
  displayName: string;
}

export type WsServerMessage =
  | WsTextDelta
  | WsTextDone
  | WsError
  | WsConversationUpdated
  | WsToolStatus;

// Database record types
export interface User {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  sdk_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: ChatMessageRecord[];
}

export interface ChatMessageRecord {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}
