import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { MatchCard } from '@/components/cards';
import { CaseConversation } from '@/components/case-conversation';
import { CaseOperationsPanel } from '@/components/case-operations';
import { RemotePhoto } from '@/components/photos';
import { PinMap } from '@/components/pin-map';
import { Badge, Body, Button, Card, Chips, ErrorNote, Field, KeyValue, Loading, Muted, Notice, Row, Screen, SectionTitle, Title } from '@/components/ui';
import { agent, db } from '@/lib/api';
import { capitalize, caseStatusLabel, conditions, dateTime, km, priorityTone, speciesLabel, timeAgo } from '@/lib/format';
import { useAction, useLive } from '@/lib/hooks';
import { distanceKm } from '@/lib/location';
import { shareText } from '@/lib/share';
import { useSession } from '@/lib/session';
import { useShelter } from '@/lib/shelter';
import type { CaseDetail, Match, ResponsePlan, Shelter, StaffMember } from '@/lib/types';

type Closing = 'resolve' | 'cancel' | 'transfer';

export default function CaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, profile } = useSession();
  const { active, verified, manager } = useShelter();
  const shelterId = active?.shelterId;
  const { busy, error, setError, run } = useAction();
  const [closing, setClosing] = useState<Closing>();
  const [outcome, setOutcome] = useState('');
  const [target, setTarget] = useState<string>();
  const [assignee, setAssignee] = useState<string>();

  const data = useLive(
    async () => {
      const [rescue, matches, staff] = await Promise.all([
        db.read<CaseDetail | null>(token!, 'case', id),
        db.read<Match[]>(token!, 'matches'),
        shelterId ? db.read<StaffMember[]>(token!, 'shelter_staff', shelterId).catch(() => []) : Promise.resolve([]),
      ]);
      return { rescue, staff, matches: rescue ? matches.filter((m) => m.lostReportId === rescue.reportId || m.candidateId === rescue.reportId) : [] };
    },
    `${id}:${shelterId}`,
    5000,
    ['my_cases', 'my_available_cases', 'my_matches', 'my_report_photos', 'report_summaries'],
  );
  const shelters = useLive(
    async () => (closing === 'transfer' ? (await db.read<Shelter[]>(token!, 'shelters')).filter((s) => s.operatorVerified && s.id !== shelterId) : []),
    `transfer:${closing}:${shelterId}`,
  );
  const plan = useLive(() => db.read<ResponsePlan | null>(token!, 'response_plan', id), `plan:${id}`, 5000);

  if (data.loading && data.data === undefined)
    return (
      <>
        <Stack.Screen options={{ title: 'Rescue case' }} />
        <Loading />
      </>
    );
  const c = data.data?.rescue;
  if (!c)
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Rescue case' }} />
        <ErrorNote error={data.error ?? 'This case is unavailable. It may have been accepted by another shelter.'} onRetry={data.refresh} />
      </Screen>
    );

  const report = c.report;
  const where = report ?? c.summary;
  const ours = !!shelterId && c.shelterId === shelterId;
  const queued = !c.shelterId && c.status === 'open';
  const closed = c.status === 'resolved' || c.status === 'cancelled';
  const canManage = verified && ours && !closed && (c.assigneeId === profile?.id || manager);
  const canAccept = verified && (queued || (ours && (c.status === 'open' || c.status === 'under_review')));
  const assigneeName = c.assigneeId ? (c.assigneeId === profile?.id ? 'You' : data.data?.staff.find((s) => s.userId === c.assigneeId)?.name || 'A teammate') : 'Unassigned';
  const colleagues = (data.data?.staff ?? []).filter((s) => s.userId !== profile?.id);

  const act = (name: string, reducer: string, payload: object) =>
    run(name, async () => {
      await db.call(token!, reducer, { caseId: c.id, ...payload });
      setClosing(undefined);
      setOutcome('');
      await data.refresh();
    });

  const finish = () => {
    if (closing === 'transfer') {
      if (!target) return setError('Choose a verified shelter to transfer to.');
      return act('closing', 'transfer_rescue_case', { shelterId: target });
    }
    if (!outcome.trim()) return setError('Describe the outcome for the reporter and your records.');
    return closing === 'resolve'
      ? act('closing', 'resolve_rescue_case', { outcome: outcome.trim() })
      : act('closing', 'update_case_status', { status: 'cancelled', outcome: outcome.trim() });
  };

  const transferOptions = [...(shelters.data ?? [])]
    .map((s) => ({ s, d: where ? distanceKm(where, s) : 0 }))
    .sort((a, b) => a.d - b.d);

  return (
    <Screen onRefresh={data.refresh}>
      <Stack.Screen options={{ title: 'Rescue case' }} />
      <Row>
        <Badge label={`${capitalize(c.priority)} priority`} tone={priorityTone[c.priority]} />
        <Badge label={queued ? 'Unassigned' : caseStatusLabel[c.status]} tone={closed ? 'neutral' : 'info'} />
      </Row>
      <Title>{where ? `${speciesLabel(where.species)} ${where.type === 'lost' ? 'reported lost' : 'found'}` : 'Rescue case'}</Title>
      {c.priority !== 'normal' ? (
        <Notice tone={c.priority === 'critical' ? 'danger' : 'warning'} title="Why this is prioritized">
          {`The reporter described the animal as "${conditions.find((x) => x.value === c.reason)?.label ?? c.reason}". Priority is set by rule from the reported condition; verify on site before acting.`}
        </Notice>
      ) : null}

      {c.photos.length ? (
        <View style={local.photos}>
          {c.photos.map((p) => (
            <RemotePhoto key={p.id} photoId={p.id} style={local.photo} />
          ))}
        </View>
      ) : null}

      <Card>
        {where ? <KeyValue label="Observed" value={`${dateTime(where.observedAt)} (${timeAgo(where.observedAt)})`} /> : null}
        {report?.generalLocation ? <KeyValue label="Area" value={report.generalLocation} /> : null}
        {report ? <KeyValue label="Animal" value={[speciesLabel(report.species), report.breed, report.colors.join(', ')].filter(Boolean).join(' · ')} /> : null}
        {c.reason ? <KeyValue label="Condition" value={conditions.find((x) => x.value === c.reason)?.label ?? c.reason} /> : null}
        <KeyValue label="Assigned to" value={assigneeName} />
        <KeyValue label="Updated" value={timeAgo(c.updatedAt)} />
        {c.outcome ? <KeyValue label="Outcome" value={c.outcome} /> : null}
        {report?.description ? <Body>{report.description}</Body> : null}
        {!report ? <Muted>Full report details and the exact location become visible once your shelter accepts this case.</Muted> : null}
      </Card>
      {c.assessment ? <Card tone="info">
        <SectionTitle>Camera observations</SectionTitle>
        <Body>{c.assessment.environment}</Body>
        {c.assessment.visibleConcerns.map((item, index) => <Muted key={index}>• {item}</Muted>)}
        <Muted>{c.assessment.uncertainty}</Muted>
        <Muted>Visual observations only. Verify the animal and conditions on site.</Muted>
      </Card> : null}

      <CaseOperationsPanel caseId={c.id} />
      {verified ? <>
        <SectionTitle>Response plan</SectionTitle>
        {plan.data ? <Card tone="info">
          <Badge label={plan.data.status} tone={plan.data.status === 'accepted' ? 'success' : 'warning'} />
          <Body>{plan.data.reason}</Body>
          {plan.data.suggestedShelterId ? <KeyValue label="Suggested shelter" value={plan.data.evidence.candidates.find((s) => s.id === plan.data?.suggestedShelterId)?.name ?? plan.data.suggestedShelterId} /> : null}
          {plan.data.steps.map((step, index) => <Muted key={index}>{index + 1}. {step}</Muted>)}
          <Muted>Generated {timeAgo(plan.data.generatedAt)}. Review the recorded tool results above.</Muted>
          {plan.data.status === 'proposed' ? <View style={{ gap: 8 }}>
            <Button label="Mark plan reviewed" variant="outline" onPress={() => run('review-plan', async () => { await db.call(token!, 'review_response_plan', { caseId: c.id, status: 'accepted' }); await plan.refresh(); })} loading={busy === 'review-plan'} />
            <Button label="Decline plan" variant="ghost" onPress={() => run('decline-plan', async () => { await db.call(token!, 'review_response_plan', { caseId: c.id, status: 'declined' }); await plan.refresh(); })} loading={busy === 'decline-plan'} />
          </View> : null}
          <Muted>Staff must confirm availability and use the case actions below to assign or transfer.</Muted>
        </Card> : <Muted>Planning has not completed for this case.</Muted>}
        {!closed ? <Button label="Refresh response plan" variant="ghost" compact loading={busy === 'plan'} onPress={() => run('plan', async () => { await agent.post(token!, '/v1/response/plan', { caseId: c.id }); await plan.refresh(); })} /> : null}
      </> : null}

      {where ? (
        <>
          <PinMap center={where} pins={[{ id: c.id, latitude: where.latitude, longitude: where.longitude, title: report ? 'Reported location' : 'Approximate area', tone: c.priority === 'normal' ? 'case' : 'urgent' }]} />
          {report ? (
            <Button
              label="Directions"
              icon="navigate-outline"
              variant="ghost"
              compact
              onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${report.latitude},${report.longitude}`)}
            />
          ) : null}
        </>
      ) : null}
      {verified && ours && report && c.priority !== 'normal' ? <Button
        label="Share responder handoff"
        icon="share-outline"
        variant="outline"
        loading={busy === 'handoff'}
        onPress={() => run('handoff', async () => {
          await shareText(`PawSafe case ${c.id}\nReported condition: ${c.reason}\nAnimal: ${report.species}\nObserved: ${report.observedAt}\nLocation: ${report.latitude}, ${report.longitude}\nStatus: ${c.status}\nVerify on site and coordinate through the assigned shelter.`);
        })}
      /> : null}

      {!verified ? <Notice tone="warning">Only verified shelter staff can act on cases.</Notice> : null}

      {canAccept ? (
        <>
          <SectionTitle>Accept responsibility</SectionTitle>
          {manager && colleagues.length ? (
            <Chips
              label="Assign to"
              value={assignee ?? profile?.id}
              onChange={setAssignee}
              options={[{ value: profile!.id, label: 'Me' }, ...colleagues.map((s) => ({ value: s.userId, label: s.name || s.userId.slice(0, 8) }))]}
            />
          ) : null}
          <Button
            label={queued ? 'Accept case for our shelter' : 'Accept and assign'}
            icon="hand-left-outline"
            onPress={() => act('assign', 'assign_rescue_case', { shelterId, ...(assignee && assignee !== profile?.id ? { assigneeId: assignee } : {}) })}
            loading={busy === 'assign'}
          />
          {ours && c.status === 'open' ? (
            <Button label="Mark under review" variant="outline" onPress={() => act('review', 'update_case_status', { status: 'under_review' })} loading={busy === 'review'} />
          ) : null}
        </>
      ) : null}

      {canManage && !canAccept ? (
        <>
          <SectionTitle>Update case</SectionTitle>
          {c.status === 'assigned' ? (
            <Button label="Start work (in progress)" icon="play-outline" onPress={() => act('progress', 'update_case_status', { status: 'in_progress' })} loading={busy === 'progress'} />
          ) : null}
          <Chips<Closing>
            value={closing}
            onChange={(v) => setClosing(closing === v ? undefined : v)}
            options={[
              { value: 'resolve', label: 'Resolve' },
              { value: 'transfer', label: 'Transfer' },
              { value: 'cancel', label: 'Cancel' },
            ]}
          />
          {closing === 'transfer' ? (
            <>
              {shelters.loading ? <Loading label="Finding verified shelters…" /> : null}
              <ErrorNote error={shelters.error} onRetry={shelters.refresh} />
              {shelters.data && !transferOptions.length ? <Muted>No other verified shelters are registered yet.</Muted> : null}
              <Chips value={target} onChange={setTarget} options={transferOptions.map(({ s, d }) => ({ value: s.id, label: where ? `${s.name} · ${km(d)}` : s.name }))} />
              <Muted>Transferring hands the case to that shelter's queue. Contact them first to confirm they can take it.</Muted>
            </>
          ) : null}
          {closing === 'resolve' || closing === 'cancel' ? (
            <Field
              label={closing === 'resolve' ? 'Outcome' : 'Reason for cancelling'}
              value={outcome}
              onChangeText={setOutcome}
              multiline
              maxLength={1000}
              placeholder={closing === 'resolve' ? 'Taken in, vet checked, microchip scanned…' : 'Animal not found at location, duplicate report…'}
            />
          ) : null}
          {closing ? (
            <Button
              label={closing === 'resolve' ? 'Resolve case' : closing === 'transfer' ? 'Transfer case' : 'Cancel case'}
              variant={closing === 'cancel' ? 'danger' : 'primary'}
              onPress={finish}
              loading={busy === 'closing'}
            />
          ) : null}
        </>
      ) : null}
      {ours && !closed && !canManage && !canAccept ? <Muted>Only the assigned staff member or a manager can update this case.</Muted> : null}
      <ErrorNote error={error} />

      <SectionTitle>Possible matches</SectionTitle>
      {!data.data?.matches.length ? <Muted>No lost-pet matches for this animal yet.</Muted> : null}
      {data.data?.matches.map((m) => (
        <MatchCard key={m.id} match={m} />
      ))}
      {c.shelterId ? <CaseConversation caseId={c.id} /> : null}
    </Screen>
  );
}

const local = StyleSheet.create({
  photos: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  photo: { width: '31%', flexGrow: 1 },
});
