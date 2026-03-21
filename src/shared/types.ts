// Chat message shape used by both frontend and backend
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  text: string;
  streaming?: boolean;
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

export type WsServerMessage = WsTextDelta | WsTextDone | WsError | WsConversationUpdated;

// Database record types
export interface Conversation {
  id: string;
  title: string;
  sdkSessionId: string | null;
  createdAt: string;
  updatedAt: string;
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
