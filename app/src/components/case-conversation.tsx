import { useState } from 'react';
import { View } from 'react-native';

import { Body, Button, Card, Empty, ErrorNote, Field, Muted, SectionTitle } from '@/components/ui';
import { db } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useAction, useLive } from '@/lib/hooks';
import { uuid } from '@/lib/ids';
import { feedback } from '@/lib/motion';
import { useSession } from '@/lib/session';
import type { CaseMessage } from '@/lib/types';

export function CaseConversation({ caseId }: { caseId: string }) {
  const { token, profile } = useSession();
  const [body, setBody] = useState('');
  const { busy, error, run } = useAction();
  const messages = useLive(() => db.read<CaseMessage[]>(token!, 'case_messages', caseId), `messages:${caseId}`, 5000);
  return <View style={{ gap: 10 }}>
    <SectionTitle>Case conversation</SectionTitle>
    <Muted>Messages are visible to the reporter and staff at the shelter handling this case.</Muted>
    {messages.data && !messages.data.length ? <Empty title="No messages yet" /> : null}
    {messages.data ? [...messages.data].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((m) =>
      <Card key={m.id}>
        <Muted>{m.senderId === profile?.id ? 'You' : 'Case partner'} · {dateTime(m.createdAt)}</Muted>
        <Body>{m.body}</Body>
      </Card>) : null}
    <Field label="Message" value={body} onChangeText={setBody} multiline maxLength={1000} placeholder="Share an update or ask for details" />
    <Button label="Send update" disabled={!body.trim()} loading={busy === 'send'} onPress={() => run('send', async () => {
      await db.call(token!, 'send_case_message', { id: `msg-${uuid()}`, caseId, body: body.trim() });
      setBody('');
      await messages.refresh();
      feedback('success');
    })} />
    <ErrorNote error={error ?? messages.error} onRetry={messages.refresh} />
  </View>;
}
