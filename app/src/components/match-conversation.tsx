import { useState } from 'react';
import { View } from 'react-native';

import { Body, Button, Card, ErrorNote, Field, Muted, SectionTitle } from '@/components/ui';
import { db } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useAction, useLive } from '@/lib/hooks';
import { uuid } from '@/lib/ids';
import { feedback } from '@/lib/motion';
import { useSession } from '@/lib/session';
import type { MatchMessage } from '@/lib/types';

export function MatchConversation({ matchId }: { matchId: string }) {
  const { token, profile } = useSession();
  const [body, setBody] = useState('');
  const { busy, error, run } = useAction();
  const messages = useLive(() => db.read<MatchMessage[]>(token!, 'match_messages', matchId), `match-messages:${matchId}`, 5000);
  return <View style={{ gap: 10 }}>
    <SectionTitle>Coordinate reunification</SectionTitle>
    <Muted>Only the confirmed match participants and handling shelter staff can read this thread. Verify identity in person before a handoff.</Muted>
    {messages.data ? [...messages.data].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((m) => <Card key={m.id}>
      <Muted>{m.senderId === profile?.id ? 'You' : 'Match partner'} · {dateTime(m.createdAt)}</Muted>
      <Body>{m.body}</Body>
    </Card>) : null}
    <Field label="Message" value={body} onChangeText={setBody} multiline maxLength={1000} placeholder="Agree on a safe verification and handoff" />
    <Button label="Send message" disabled={!body.trim()} loading={busy === 'send'} onPress={() => run('send', async () => {
      await db.call(token!, 'send_match_message', { id: `match-msg-${uuid()}`, matchId, body: body.trim() });
      setBody(''); await messages.refresh();
      feedback('success');
    })} />
    <ErrorNote error={error ?? messages.error} onRetry={messages.refresh} />
  </View>;
}
