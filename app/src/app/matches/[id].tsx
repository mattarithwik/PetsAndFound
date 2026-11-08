import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';

import { RemotePhoto } from '@/components/photos';
import { Badge, Button, Card, ErrorNote, KeyValue, Loading, Muted, Notice, Row, Screen, SectionTitle, SourceLink, SourceTag, Strong, Title } from '@/components/ui';
import { db } from '@/lib/api';
import { similarity, timeAgo } from '@/lib/format';
import { useAction, useLive } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { Match } from '@/lib/types';

const componentLabels: Record<string, string> = {
  visual: 'Photo similarity',
  geographic: 'Distance',
  attributes: 'Breed and colors',
  time: 'Timing',
};

export default function MatchDetail() {
  const { id: raw } = useLocalSearchParams<{ id: string }>();
  const id = raw;
  const { token, profile, access } = useSession();
  const { busy, error, run } = useAction();
  const match = useLive(async () => (await db.read<Match[]>(token!, 'matches')).find((m) => m.id === id) ?? null, id, 8000, ['my_matches']);

  if (match.loading && match.data === undefined)
    return (
      <>
        <Stack.Screen options={{ title: 'Possible match' }} />
        <Loading />
      </>
    );
  const m = match.data;
  if (!m)
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Possible match' }} />
        <ErrorNote error={match.error ?? 'This match is no longer available.'} onRetry={match.refresh} />
      </Screen>
    );

  const isFinder = m.finderId === profile?.id;
  const canReview = m.status === 'pending' && !isFinder && (m.ownerId === profile?.id || !!access?.staff.length);
  const components = Object.entries(m.evidence.components ?? {}).filter(([, v]) => typeof v === 'number') as [string, number][];

  const review = (status: 'confirmed' | 'rejected') =>
    run(status, async () => {
      await db.call(token!, 'review_match', { matchId: m.id, status });
      await match.refresh();
    });

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Possible match' }} />
      <Row>
        <Badge label={m.status === 'pending' ? 'Possible match' : m.status === 'confirmed' ? 'Confirmed' : 'Not a match'} tone={m.status === 'confirmed' ? 'success' : m.status === 'rejected' ? 'neutral' : 'warning'} />
        <SourceTag kind={m.candidateType === 'external' ? 'external' : 'live'} />
      </Row>
      <Title>Similarity score {similarity(m.score) ?? '—'}/100</Title>
      <View style={local.pair}>
        <View style={local.side}>
          <RemotePhoto photoId={m.evidence.matchingPhotoId} style={local.photo} />
          <Muted>Registered pet</Muted>
        </View>
        <View style={local.side}>
          <RemotePhoto photoId={m.evidence.candidatePhotoId} style={local.photo} />
          <Muted>{m.candidateType === 'external' ? 'Public listing' : 'Found report'}</Muted>
        </View>
      </View>

      <Card>
        <Strong>Why this was suggested</Strong>
        {components.map(([k, v]) => (
          <KeyValue key={k} label={componentLabels[k] ?? k} value={`${Math.round(v * 100)}%`} />
        ))}
        {m.evidence.model ? <KeyValue label="Model" value={m.evidence.model} /> : null}
        <KeyValue label="Updated" value={timeAgo(m.updatedAt)} />
        {m.evidence.sourceUrl ? <SourceLink url={m.evidence.sourceUrl} label="View original listing" /> : null}
      </Card>

      <Notice tone="warning" title="A score is not proof">
        Visual similarity can't confirm identity. Compare markings, collar and microchip, and meet in a safe public place or at a shelter before handing over an animal.
      </Notice>
      {m.handlingShelter ? <Card>
        <Muted>Verified shelter handling this case</Muted>
        <Strong>{m.handlingShelter.name}</Strong>
        {m.handlingShelter.phone ? <Button label={'Call ' + m.handlingShelter.phone} icon="call-outline" variant="outline" onPress={() => Linking.openURL('tel:' + m.handlingShelter!.phone)} /> : null}
        {m.handlingShelter.website && /^https?:\/\//i.test(m.handlingShelter.website) ? <SourceLink label="Shelter website" url={m.handlingShelter.website} /> : null}
      </Card> : null}

      {canReview ? (
        <>
          <SectionTitle>Is this the same animal?</SectionTitle>
          <Button label="Yes, confirm match" icon="checkmark-circle" onPress={() => review('confirmed')} loading={busy === 'confirmed'} />
          <Button label="No, not a match" variant="outline" onPress={() => review('rejected')} loading={busy === 'rejected'} />
        </>
      ) : null}
      {isFinder && m.status === 'pending' ? <Muted>The pet's owner or the shelter handling this case will review this match.</Muted> : null}
      {m.status === 'confirmed' && m.ownerId === profile?.id ? (
        <Button label="Open lost report" variant="outline" onPress={() => router.push(`/reports/${m.lostReportId}`)} />
      ) : null}
      <ErrorNote error={error} />
    </Screen>
  );
}

const local = StyleSheet.create({
  pair: { flexDirection: 'row', gap: 12 },
  side: { flex: 1, gap: 6, alignItems: 'center' },
  photo: { width: '100%' },
});
