import { router, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AlertCard, CaseCard, MatchCard, NotificationBell } from '@/components/cards';
import { PinMap } from '@/components/pin-map';
import { Button, Card, Chips, Empty, ErrorNote, Hero, Loading, Muted, Notice, Screen, SectionTitle, SourceTag, Stat } from '@/components/ui';
import { agent } from '@/lib/api';
import { priorityRank, timeAgo, verificationLabel } from '@/lib/format';
import { useLive } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { activeStatuses, useShelter, useShelterOps } from '@/lib/shelter';
import type { Sourced, WeatherAlert } from '@/lib/types';

export default function Dashboard() {
  const { token, profile, online, setRole } = useSession();
  const { memberships, active, verified, setActiveShelter } = useShelter();
  const ops = useShelterOps();
  const shelter = ops.data?.shelter ?? active?.shelter ?? null;

  const alerts = useLive(
    async () =>
      shelter
        ? agent.get<Sourced<WeatherAlert>>(token!, `/v1/weather/alerts?latitude=${shelter.latitude.toFixed(4)}&longitude=${shelter.longitude.toFixed(4)}`)
        : undefined,
    `shelter-alerts:${shelter?.id}`,
    120000,
  );

  if (!memberships.length)
    return (
      <Screen edges={['top']} bottomInset={120}>
        <Hero title="Dashboard" subtitle={profile?.name} right={<NotificationBell />} />
        <Empty icon="business-outline" title="Connect your organization" body="Register your shelter or rescue, claim an existing directory listing, or join a team with your staff ID." />
        <Button label="Set up organization" icon="add-circle-outline" onPress={() => router.push('/shelter-onboarding')} />
        <Button label="Switch to pet owner view" variant="ghost" onPress={() => setRole('owner').then(() => router.replace('/rescue'))} />
      </Screen>
    );

  const ours = (ops.data?.ours ?? []).filter((c) => (activeStatuses as readonly string[]).includes(c.status));
  const queue = [...(ops.data?.queue ?? [])].sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
  const urgent = [...ours, ...queue].filter((c) => c.priority !== 'normal').length;
  const recent = [...(ops.data?.ours ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
  const unavailableWeather = alerts.data?.sources.some((s) => s.status === 'unavailable');
  const fresh = !!shelter?.capacityUpdatedAt && Date.now() - Date.parse(shelter.capacityUpdatedAt) < 24 * 3600000;
  const capacityKnown = verified && typeof shelter?.totalCapacity === 'number' && typeof shelter?.currentOccupancy === 'number';
  const pins = queue
    .filter((c) => c.report)
    .map((c) => ({ id: c.id, latitude: c.report!.latitude, longitude: c.report!.longitude, title: `${c.priority} · ${c.report!.species}`, tone: c.priority === 'normal' ? ('case' as const) : ('urgent' as const) }));

  return (
    <Screen edges={['top']} bottomInset={120} onRefresh={() => Promise.all([ops.refresh(), alerts.refresh()])}>
      <Hero title={shelter?.name ?? 'Dashboard'} subtitle={active ? verificationLabel[active.verification] : undefined} right={<NotificationBell />} />
      {!online ? <Notice tone="warning" title="Offline">Showing the last data we loaded.</Notice> : null}
      {memberships.length > 1 ? (
        <Chips label="Organization" value={active?.shelterId} onChange={setActiveShelter} options={memberships.map((m) => ({ value: m.shelterId, label: m.shelter?.name ?? m.shelterId }))} />
      ) : null}

      {!verified ? (
        <Notice tone={active?.verification === 'rejected' ? 'danger' : 'warning'} title={active?.verification === 'pending_review' ? 'Verification in review' : 'Not verified yet'}>
          {active?.verification === 'pending_review'
            ? 'An independent reviewer is checking your evidence. You can accept cases and publish capacity once verified.'
            : active?.verification === 'rejected'
              ? 'Verification was rejected. Submit updated evidence from Settings.'
              : !active?.role
                ? 'Your claim is waiting on review. Once approved you become this listing’s manager.'
                : 'Submit verification evidence from Settings to accept cases and publish capacity.'}
        </Notice>
      ) : null}

      <ErrorNote error={ops.error} onRetry={ops.refresh} />
      {ops.loading && !ops.data ? <Loading /> : null}

      <SectionTitle action={<SourceTag kind="live" />}>Capacity</SectionTitle>
      {capacityKnown ? (
        <>
          <View style={local.stats}>
            <Stat label="Occupied" value={`${shelter!.currentOccupancy}/${shelter!.totalCapacity}`} />
            <Stat label="Available" value={Math.max(0, shelter!.totalCapacity! - shelter!.currentOccupancy!)} tone="success" />
            <Stat label="Intake" value={shelter!.acceptingAnimals ? 'Open' : 'Paused'} tone={shelter!.acceptingAnimals ? 'success' : 'warning'} />
          </View>
          <Muted>Updated {timeAgo(shelter!.capacityUpdatedAt)}{fresh ? '' : ' — outdated, the public sees capacity as unknown until you update it.'}</Muted>
        </>
      ) : (
        <Card>
          <Muted>Publish your capacity so people know whether you have space.</Muted>
        </Card>
      )}
      {verified ? <Button label="Update capacity" icon="create-outline" variant="outline" compact onPress={() => router.push('/settings')} /> : null}
      {verified ? <Button label="Manage animals and supplies" icon="paw-outline" onPress={() => router.push('/registry' as Href)} /> : null}

      {verified && ops.data ? (
        <>
          <View style={local.stats}>
            <Stat label="Incoming" value={queue.length} />
            <Stat label="Our open cases" value={ours.length} />
            <Stat label="Urgent" value={urgent} tone={urgent ? 'danger' : 'info'} />
          </View>

          <SectionTitle action={<Button label="All cases" compact variant="ghost" onPress={() => router.push('/cases')} />}>Incoming reports</SectionTitle>
          {!queue.length ? <Empty icon="checkmark-done-outline" title="No unassigned cases" body="Incoming found animals and lost-pet follow-ups appear here." /> : null}
          {pins.length ? <PinMap pins={pins} center={shelter ?? undefined} onPress={(pin) => router.push(`/cases/${pin.id}`)} /> : null}
          {queue.slice(0, 4).map((c) => (
            <CaseCard key={c.id} item={c} onPress={() => router.push(`/cases/${c.id}`)} />
          ))}

          <SectionTitle>Recent case activity</SectionTitle>
          {recent.length ? recent.map((c) => <CaseCard key={c.id} item={c} onPress={() => router.push(`/cases/${c.id}`)} />) : <Muted>Your team's accepted and transferred cases appear here.</Muted>}

          <SectionTitle>Match requests</SectionTitle>
          {!ops.data?.matches.length ? <Muted>No possible matches waiting on your cases.</Muted> : null}
          {ops.data?.matches.slice(0, 4).map((m) => (
            <MatchCard key={m.id} match={m} />
          ))}
        </>
      ) : null}

      {shelter ? (
        <>
          <SectionTitle action={<SourceTag kind="official" />}>Local weather alerts</SectionTitle>
          <ErrorNote error={alerts.error} onRetry={alerts.refresh} />
          {alerts.loading ? <Loading label="Checking NWS alerts…" /> : null}
          {unavailableWeather ? <Notice tone="warning">NWS alerts are unavailable for this location. Check weather.gov for current conditions.</Notice> : null}
          {alerts.data && !unavailableWeather && !alerts.data.items.length ? <Muted>No active NWS warnings for your shelter's location.</Muted> : null}
          {alerts.data?.items.map((a) => (
            <AlertCard key={a.alertId} alert={a} />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const local = StyleSheet.create({
  stats: { flexDirection: 'row', gap: 10 },
});
