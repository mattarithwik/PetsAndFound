import { router } from 'expo-router';
import { useState } from 'react';

import { CaseCard } from '@/components/cards';
import { Button, Chips, Empty, ErrorNote, Hero, Loading, Muted, Notice, Screen } from '@/components/ui';
import { priorityRank } from '@/lib/format';
import { activeStatuses, useShelter, useShelterOps } from '@/lib/shelter';
import type { QueuedCase, RescueCase } from '@/lib/types';

type View = 'incoming' | 'ours' | 'closed';

const byPriority = <T extends RescueCase | QueuedCase>(rows: T[]) =>
  [...rows].sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || ('updatedAt' in b && 'updatedAt' in a ? b.updatedAt.localeCompare(a.updatedAt) : 0));

export default function Cases() {
  const { active, verified } = useShelter();
  const ops = useShelterOps();
  const [view, setView] = useState<View>('incoming');

  if (!verified)
    return (
      <Screen edges={['top']}>
        <Hero title="Cases" subtitle={active?.shelter?.name} />
        <Notice tone="warning" title="Verification required">
          Only verified shelter staff can review, accept and transfer rescue cases. Check your verification status in Settings.
        </Notice>
        <Button label="View verification in Settings" variant="outline" onPress={() => router.push('/settings')} />
      </Screen>
    );

  const ours = ops.data?.ours ?? [];
  const lists: Record<View, (RescueCase | QueuedCase)[]> = {
    incoming: byPriority(ops.data?.queue ?? []),
    ours: byPriority(ours.filter((c) => (activeStatuses as readonly string[]).includes(c.status))),
    closed: [...ours.filter((c) => c.status === 'resolved' || c.status === 'cancelled')].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
  const rows = lists[view];

  return (
    <Screen edges={['top']} onRefresh={ops.refresh}>
      <Hero title="Cases" subtitle={active?.shelter?.name} />
      <Chips
        value={view}
        onChange={setView}
        options={[
          { value: 'incoming', label: `Incoming (${lists.incoming.length})` },
          { value: 'ours', label: `Our cases (${lists.ours.length})` },
          { value: 'closed', label: 'Closed' },
        ]}
      />
      <Muted>
        {view === 'incoming'
          ? 'Unassigned intakes and lost-pet follow-ups, ordered by reported urgency.'
          : view === 'ours'
            ? 'Cases your shelter has taken responsibility for.'
            : 'Resolved and cancelled cases.'}
      </Muted>
      <ErrorNote error={ops.error} onRetry={ops.refresh} />
      {ops.loading && !ops.data ? <Loading /> : null}
      {ops.data && !rows.length ? <Empty icon="file-tray-outline" title={view === 'incoming' ? 'No incoming cases' : view === 'ours' ? 'No active cases' : 'No closed cases'} body={view === 'incoming' ? 'New unassigned reports will appear here.' : view === 'ours' ? 'Accept an incoming case to start coordinating care.' : 'Resolved and cancelled cases will appear here.'} /> : null}
      {rows.map((c) => (
        <CaseCard key={c.id} item={c} onPress={() => router.push(`/cases/${c.id}`)} />
      ))}
    </Screen>
  );
}
