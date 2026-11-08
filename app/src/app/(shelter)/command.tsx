import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Chips, Empty, ErrorNote, Field, Hero, Loading, Muted, Notice, Screen, SectionTitle, Stat, Strong } from '@/components/ui';
import { db } from '@/lib/api';
import { priorityRank, timeAgo } from '@/lib/format';
import { useAction, useLive } from '@/lib/hooks';
import { uuid } from '@/lib/ids';
import { feedback } from '@/lib/motion';
import { useSession } from '@/lib/session';
import { useShelter } from '@/lib/shelter';
import type { Incident, IncidentBoard } from '@/lib/types';

const hazards = [
  { value: 'flood', label: 'Flood' }, { value: 'tornado', label: 'Tornado' },
  { value: 'wildfire', label: 'Wildfire' }, { value: 'winter_storm', label: 'Winter storm' },
  { value: 'earthquake', label: 'Earthquake' }, { value: 'heat', label: 'Heat' },
  { value: 'other', label: 'Other' },
];

export default function Command() {
  const { token } = useSession();
  const { active, verified } = useShelter();
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [hazard, setHazard] = useState('flood');
  const [radius, setRadius] = useState('50');
  const { busy, error, run } = useAction();
  const incidents = useLive(
    () => verified ? db.read<Incident[]>(token!, 'incidents') : Promise.resolve([]),
    `incidents:${verified}`, 5000,
  );
  const activeId = selected ?? incidents.data?.find((i) => i.status === 'active')?.id;
  const board = useLive(
    () => activeId ? db.read<IncidentBoard | null>(token!, 'incident_board', activeId) : Promise.resolve(null),
    `board:${activeId}`, 5000,
  );
  const rows = board.data?.cases ?? [];
  const unresolved = rows.filter((c) => c.status !== 'resolved' && c.status !== 'cancelled');
  const urgent = unresolved.filter((c) => c.priority !== 'normal');
  const urgentUnassigned = urgent.filter((c) => !c.shelterId);
  const noRecentUpdate = unresolved.filter((c) => Date.now() - Date.parse(c.updatedAt) >= 15 * 60_000);
  const reviewMinutes = rows.filter((c) => c.firstReviewedAt).map((c) =>
    Math.max(0, (Date.parse(c.firstReviewedAt) - Date.parse(c.createdAt)) / 60_000)).sort((a, b) => a - b);
  const medianReview = reviewMinutes.length ? reviewMinutes[Math.floor(reviewMinutes.length / 2)] : null;
  const duplicateCount = rows.filter((c) => c.possibleDuplicateOf).length;
  const create = () => run('create', async () => {
    const shelter = active?.shelter;
    if (!shelter) throw new Error('Your shelter needs a location to start an incident.');
    const radiusKm = Number(radius);
    if (!title.trim() || !Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 500) throw new Error('Enter a title and a radius from 1 to 500 km.');
    const id = `inc-${uuid()}`;
    await db.call(token!, 'create_incident', { id, title: title.trim(), hazard, latitude: shelter.latitude, longitude: shelter.longitude, radiusKm });
    setCreating(false);
    setSelected(id);
    await incidents.refresh();
    await board.refresh();
    feedback('success');
  });

  if (!verified) return <Screen edges={['top']}><Hero title="Incident command" /><Notice tone="warning">Verified shelter staff can coordinate incidents.</Notice></Screen>;
  return (
    <Screen edges={['top']} onRefresh={() => Promise.all([incidents.refresh(), board.refresh()])}>
      <Hero title="Incident command" subtitle="Keep every disaster case in view" />
      <Button label={creating ? 'Cancel new incident' : 'Start an incident'} icon="add-circle-outline" variant="outline" onPress={() => setCreating(!creating)} />
      {creating ? <Card>
        <Field label="Incident name" value={title} onChangeText={setTitle} placeholder="North side flooding" maxLength={160} />
        <Chips label="Hazard" value={hazard} onChange={setHazard} options={hazards} />
        <Field label="Coverage radius (km)" value={radius} onChangeText={setRadius} keyboardType="numeric" />
        <Muted>Centered on {active?.shelter?.name}. Existing and new nearby cases will be grouped automatically.</Muted>
        <Button label="Create command board" onPress={create} loading={busy === 'create'} />
      </Card> : null}
      <ErrorNote error={error ?? incidents.error ?? board.error} onRetry={() => { void incidents.refresh(); void board.refresh(); }} />
      {incidents.loading && !incidents.data ? <Loading /> : null}
      {incidents.data && !incidents.data.length ? <Empty title="No incidents yet" body="Start one to coordinate nearby pet reports during a disaster." /> : null}
      {incidents.data?.length ? <Chips label="Incident" value={activeId} onChange={setSelected} options={incidents.data.map((i) => ({ value: i.id, label: i.title }))} /> : null}
      {board.data ? <>
        <SectionTitle>{board.data.incident.title}</SectionTitle>
        <Muted>{board.data.incident.hazard.replace('_', ' ')} · {board.data.incident.radiusKm} km radius · {board.data.incident.status}</Muted>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Stat label="Open" value={unresolved.length} />
          <Stat label="First review median" value={medianReview === null ? '—' : `${medianReview.toFixed(1)}m`} tone="info" />
          <Stat label="Urgent unassigned" value={urgentUnassigned.length} tone={urgentUnassigned.length ? 'danger' : 'success'} />
          <Stat label="No update 15m+" value={noRecentUpdate.length} tone={noRecentUpdate.length ? 'danger' : 'success'} />
          <Stat label="Possible duplicates" value={duplicateCount} tone="info" />
          <Stat label="Resolved" value={rows.length - unresolved.length} tone="success" />
        </View>
        <Muted>First review measures report creation to first staff review or assignment ({reviewMinutes.length} reviewed). No update uses the case's last update.</Muted>
        <SectionTitle>Needs attention</SectionTitle>
        {!unresolved.length ? <Empty title="All cases are closed" /> : null}
        {[...unresolved].sort((a, b) =>
          Number(noRecentUpdate.includes(b)) - Number(noRecentUpdate.includes(a)) ||
          priorityRank[a.priority] - priorityRank[b.priority] || a.updatedAt.localeCompare(b.updatedAt),
        ).slice(0, 50).map((c) => <Card key={c.id}>
          <Strong>{c.priority.toUpperCase()} · {c.summary?.species ?? 'Animal'} {c.summary?.type ?? 'case'}</Strong>
          <Muted>{c.shelterId ? `Assigned to shelter · ${c.status}` : 'No shelter assigned'} · updated {timeAgo(c.updatedAt)}</Muted>
          {noRecentUpdate.includes(c) ? <Notice tone="danger">No case update for at least 15 minutes</Notice> : null}
          {c.possibleDuplicateOf ? <Notice tone="warning">Possible duplicate sighting of case {c.possibleDuplicateOf.slice(0, 12)}</Notice> : null}
          {c.plan ? <Muted>Plan {c.plan.status}: {c.plan.reason}</Muted> : <Muted>Response plan pending</Muted>}
          <Button label="Open case" compact onPress={() => router.push(`/cases/${c.id}`)} />
        </Card>)}
        {unresolved.length > 50 ? <Muted>Showing the first 50 of {unresolved.length} open cases. All cases count toward the metrics.</Muted> : null}
      </> : null}
    </Screen>
  );
}
