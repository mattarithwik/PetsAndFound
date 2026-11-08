import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import type { AgentResult, UploadedPhoto } from './types';

export type ChatRequest = { requestId: string; text: string; photos: ChatPhoto[]; previousRunId?: string };

export type ChatMessage =
  | { id: string; from: 'user'; text: string; photoUri?: string }
  | { id: string; from: 'agent'; text: string; result?: AgentResult; retry?: ChatRequest };

export type ChatPhoto = UploadedPhoto & { uri: string };

type ChatState = {
  messages: ChatMessage[];
  previousRunId?: string;
  photos: ChatPhoto[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setPreviousRunId(id?: string): void;
  setPhotos: React.Dispatch<React.SetStateAction<ChatPhoto[]>>;
  reset(): void;
};

const ChatContext = createContext<ChatState | null>(null);

/** Keeps the Pawtricia conversation alive while the user moves between tabs. */
export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [previousRunId, setPreviousRunId] = useState<string>();
  const [photos, setPhotos] = useState<ChatPhoto[]>([]);
  const value = useMemo(
    () => ({
      messages,
      previousRunId,
      photos,
      setMessages,
      setPreviousRunId,
      setPhotos,
      reset() {
        setMessages([]);
        setPreviousRunId(undefined);
        setPhotos([]);
      },
    }),
    [messages, previousRunId, photos],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const value = useContext(ChatContext);
  if (!value) throw new Error('useChat must be used inside ChatProvider');
  return value;
}
