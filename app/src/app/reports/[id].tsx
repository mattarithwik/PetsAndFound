import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { MatchCard } from '@/components/cards';
import { RemotePhoto } from '@/components/photos';
import { PinMap } from '@/components/pin-map';
import { Badge, Body, Button, Card, Empty, ErrorNote, KeyValue, Loading, Muted, Notice, Row, Screen, SectionTitle, SourceTag, Title } from '@/components/ui';
import { agent, db } from '@/lib/api';
import { caseStatusLabel, conditions, dateTime, speciesLabel, timeAgo } from '@/lib/format';
import { useAction, useLive } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { CaseDetail, Match, Pet, Photo, Report, ReportSummary } from '@/lib/types';

export default function ReportDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, profile } = useSession();
  const { busy, error, run } = useAction();
  const [confirming, setConfirming] = useState<'closed' | 'reunited'>();
  const data = useLive(
    async () => {
      const report = await db.read<Report | null>(token!, 'report', id);
      if (!report) {
        const summary = await db.read<ReportSummary | null>(token!, 'public_report', id);
        return summary ? { summary } as const : null;
      }
      const [photos, matches, rescue, pet] = await Promise.all([
        db.read<Photo[]>(token!, 'report_photos', id),
        db.read<Match[]>(token!, 'matches'),
        db.read<CaseDetail | null>(token!, 'case', id),
        report.petId ? db.read<Pet | null>(token!, 'pet', report.petId) : Promise.resolve(null),
      ]);
      return {
        report,
        photos,
        rescue,
        pet,
        matches: matches.filter((m) => m.lostReportId === id || m.candidateId === id).sort((a, b) => b.score - a.score),
      };
    },
    id,
    5000,
    ['my_reports', 'my_cases', 'my_matches', 'my_report_photos', 'my_pet_photos', 'report_summaries'],
  );
  const search = useAction();

  if (data.loading && data.data === undefined)
    return (
      <>
        <Stack.Screen options={{ title: 'Report' }} />
        <Loading />
      </>
    );
  if (!data.data)
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Report' }} />
        <ErrorNote error={data.error ?? 'This report is unavailable.'} onRetry={data.refresh} />
      </Screen>
    );
  if (data.data.summary) {
    const s = data.data.summary;
    return (
      <Screen onRefresh={data.refresh}>
        <Stack.Screen options={{ title: 'Nearby report' }} />
        <Badge label="Public report" />
        <Title>{speciesLabel(s.species)} {s.type === 'lost' ? 'missing' : 'found'}</Title>
        <KeyValue label="Observed" value={dateTime(s.observedAt)} />
        <Muted>The map shows the approximate area where someone reported this animal.</Muted>
        <PinMap center={s} pins={[{ ...s, title: 'Approximate sighting area', tone: 'case' }]} />
        <Button label={s.type === 'lost' ? 'Report a found animal' : 'Report my missing pet'} onPress={() => router.push(s.type === 'lost' ? '/report/found' : '/report/lost')} />
      </Screen>
    );
  }
  const { report, photos, matches, rescue, pet } = data.data;
  const mine = report.creatorId === profile?.id;
  const confirmed = matches.some((m) => m.status === 'confirmed');
  const isOpen = report.status === 'open';

  const setStatus = (status: 'closed' | 'reunited') =>
    run(status, async () => {
      await db.call(token!, 'update_report', { reportId: report.id, status });
      setConfirming(undefined);
      await data.refresh();
    });

  const runSearch = () =>
    search.run('search', async () => {
      const result = await agent.post<{ items: Match[]; coverage: 'partial' | 'complete' }>(token!, '/v1/matching/search', { reportId: report.id });
      await data.refresh();
      if (result.coverage === 'partial') throw new Error('Some photos or sources could not be compared right now. Results may be incomplete; the worker will retry.');
    });

  return (
    <Screen>
      <Stack.Screen options={{ title: pet?.name ?? 'Report' }} />
      <Row>
        <Badge label={report.type === 'lost' ? 'Lost' : 'Found'} tone={report.type === 'lost' ? 'warning' : 'success'} />
        <Badge label={report.status} tone={report.status === 'reunited' ? 'success' : report.status === 'open' ? 'info' : 'neutral'} />
        <SourceTag kind="live" />
      </Row>
      <Title>{pet?.name ?? `${speciesLabel(report.species)} ${report.type === 'lost' ? 'missing' : 'found'}`}</Title>
      <Card>
        <KeyValue label={report.type === 'lost' ? 'Last seen' : 'Found'} value={`${dateTime(report.observedAt)} (${timeAgo(report.observedAt)})`} />
        <KeyValue label="Area" value={report.generalLocation || `${report.latitude.toFixed(3)}, ${report.longitude.toFixed(3)}`} />
        <KeyValue label="Animal" value={[speciesLabel(report.species), report.breed, report.colors.join(', ')].filter(Boolean).join(' · ')} />
        {report.condition ? <KeyValue label="Condition" value={conditions.find((c) => c.value === report.condition)?.label ?? report.condition} /> : null}
        {report.description ? <Body>{report.description}</Body> : null}
      </Card>

      {photos.length ? (
        <View style={local.photos}>
          {photos.map((p) => (
            <RemotePhoto key={p.id} photoId={p.id} style={local.photo} />
          ))}
        </View>
      ) : null}

      {rescue ? (
        <Card tone="info">
          <Muted>Rescue case</Muted>
          <Row>
            <Badge label={caseStatusLabel[rescue.status]} />
            <Badge label={`${rescue.priority} priority`} tone={rescue.priority === 'critical' ? 'danger' : rescue.priority === 'urgent' ? 'warning' : 'neutral'} />
          </Row>
          <Muted>{rescue.shelterId ? 'A verified shelter is handling this case.' : 'Waiting for a verified shelter to accept.'} Updated {timeAgo(rescue.updatedAt)}.</Muted>
          {rescue.outcome ? <Body>Outcome: {rescue.outcome}</Body> : null}
        </Card>
      ) : null}
      {isOpen && mine && !rescue && report.type === 'lost' ? (
        <Button label="Request shelter follow-up" icon="business-outline" variant="outline" loading={busy === 'case'} onPress={() =>
          run('case', async () => {
            await db.call(token!, 'create_rescue_case', { reportId: report.id });
            await data.refresh();
          })} />
      ) : null}

      <SectionTitle>Possible matches</SectionTitle>
      <Muted>
        Ranked by visual similarity (DINOv2), distance, timing and description. A score is not proof of identity — always confirm in person or by microchip.
      </Muted>
      {!matches.length ? <Empty icon="images-outline" title="No candidates yet" body="The matching worker checks new found reports, shelter listings and permitted public posts automatically." /> : null}
      {matches.map((m) => (
        <MatchCard key={m.id} match={m} />
      ))}
      {isOpen && mine ? <Button label="Search for matches now" icon="search" variant="outline" onPress={runSearch} loading={search.busy === 'search'} /> : null}
      {search.error ? <Notice tone="warning">{search.error}</Notice> : null}

      {isOpen && mine ? (
        <>
          <SectionTitle>Next steps</SectionTitle>
          <Button
            label="Ask Pawtricia to search shelters and social posts"
            icon="chatbubbles-outline"
            variant="ghost"
            onPress={() =>
              router.push({
                pathname: '/chat',
                params: {
                  reportId: report.id,
                  prompt: report.type === 'lost' ? `Check nearby shelters and social media for ${pet?.name ?? 'my pet'}.` : 'Help me find the owner of the animal I found.',
                },
              })
            }
          />
          {report.type === 'lost' ? (
            <Button label="We're reunited!" icon="heart" onPress={() => setConfirming('reunited')} disabled={!confirmed} />
          ) : null}
          {report.type === 'lost' && !confirmed ? <Muted>Confirm a match first to mark your pet as reunited.</Muted> : null}
          <Button label="Close report" variant="outline" onPress={() => setConfirming('closed')} />
          {confirming ? <Card>
            <Body>{confirming === 'reunited' ? 'Mark your pet as home and end this search?' : 'Close this report and remove it from nearby searches?'}</Body>
            <Button label={confirming === 'reunited' ? 'Confirm reunion' : 'Confirm closure'} onPress={() => setStatus(confirming)} loading={busy === confirming} />
            <Button label="Keep report open" variant="ghost" onPress={() => setConfirming(undefined)} disabled={!!busy} />
          </Card> : null}
        </>
      ) : null}
      <ErrorNote error={error} />
    </Screen>
  );
}

const local = StyleSheet.create({
  photos: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  photo: { width: '31%', flexGrow: 1 },
});
