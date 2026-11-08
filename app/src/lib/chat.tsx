import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { useSession } from './session';
import type { AgentResult, UploadedPhoto } from './types';

type Context = {
  location?: { latitude: number; longitude: number };
  city?: string;
  reportId?: string;
  photos?: UploadedPhoto[];
};
export type ChatRequest = { requestId: string; text: string; context: Context; previousRunId?: string };
export type ChatPhoto = UploadedPhoto & { uri: string };
export type ChatMessage =
  | { id: string; from: 'user'; text: string; photoUri?: string }
  | { id: string; from: 'agent'; text: string; result?: AgentResult; retry?: ChatRequest; declined?: boolean };

function emptyConversation(owner?: string, generation = 0, reportId?: string) {
  return {
    owner,
    generation,
    messages: [] as ChatMessage[],
    photos: [] as ChatPhoto[],
    previousRunId: undefined as string | undefined,
    reportId,
    sending: false,
    uploading: false,
  };
}
type Conversation = ReturnType<typeof emptyConversation>;
type ChatState = Conversation & {
  update(patch: Partial<Conversation>): void;
  setMessages(change: (list: ChatMessage[]) => ChatMessage[]): void;
  reset(): void;
  openReport(id: string): void;
};
const ChatContext = createContext<ChatState | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const owner = useSession().profile?.id;
  const [chat, setChat] = useState(() => emptyConversation(owner));
  if (chat.owner !== owner) setChat(emptyConversation(owner, chat.generation + 1));
  const openReport = useCallback(
    (id: string) => {
      setChat((current) =>
        current.reportId === id ? current : emptyConversation(owner, current.generation + 1, id),
      );
    },
    [owner],
  );
  const value = useMemo<ChatState>(
    () => ({
      ...chat,
      openReport,
      update: (patch) =>
        setChat((current) =>
          current.owner === owner && current.generation === chat.generation
            ? { ...current, ...patch }
            : current,
        ),
      setMessages: (change) =>
        setChat((current) =>
          current.owner === owner && current.generation === chat.generation
            ? { ...current, messages: change(current.messages) }
            : current,
        ),
      reset: () => setChat((current) => emptyConversation(owner, current.generation + 1)),
    }),
    [chat, owner, openReport],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const value = useContext(ChatContext);
  if (!value) throw new Error('useChat must be used inside ChatProvider');
  return value;
}
