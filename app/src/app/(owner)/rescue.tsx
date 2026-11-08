import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ExternalCard, MatchCard, NotificationBell, ReportCard, ShelterCard, SummaryCard } from '@/components/cards';
import { PinMap } from '@/components/pin-map';
import { Button, Empty, ErrorNote, Hero, Loading, Muted, Notice, Screen, SectionTitle, SourceTag, colors } from '@/components/ui';
import { agent, db } from '@/lib/api';
import { useLive } from '@/lib/hooks';
import { distanceKm } from '@/lib/location';
import { usePlace } from '@/lib/place';
import { useSession } from '@/lib/session';
import type { ExternalReport, Match, NearbyShelter, Pet, Report, ReportSummary, Sourced } from '@/lib/types';

export default function Rescue() {
  const { token, profile, online } = useSession();
  const { place, locate, locating, error: placeError } = usePlace();
  const [discover, setDiscover] = useState(false);

  const mine = useLive(
    async () => {
      const [reports, matches, pets] = await Promise.all([
        db.read<Report[]>(token!, 'reports'),
        db.read<Match[]>(token!, 'matches'),
        db.read<Pet[]>(token!, 'pets'),
      ]);
      return { reports, matches, pets };
    },
    'mine',
    6000,
  );

  const nearby = useLive(
    async () => {
      if (!place) return [];
      const rows = await db.read<ReportSummary[]>(token!, 'public_reports');
      return rows
        .map((r) => ({ summary: r, distance: distanceKm(place, r) }))
        .filter((r) => r.distance <= 50)
        .sort((a, b) => a.distance - b.distance);
    },
    `nearby:${place?.latitude},${place?.longitude}`,
    15000,
  );

  const shelters = useLive(
    async () =>
      place
        ? agent.post<Sourced<NearbyShelter>>(token!, '/v1/ingestion/shelters/sync', {
            latitude: place.latitude,
            longitude: place.longitude,
            radiusKm: 30,
            limit: 8,
          })
        : undefined,
    `shelters:${place?.latitude},${place?.longitude}`,
  );

  const reports = mine.data?.reports ?? [];
  const ownIds = new Set(reports.map((r) => r.id));
  const open = reports.filter((r) => r.status === 'open');
  const petName = (r: Report) => mine.data?.pets.find((p) => p.id === r.petId)?.name;
  const matches = (mine.data?.matches ?? [])
    .filter((m) => m.status !== 'rejected' && (m.ownerId === profile?.id || m.finderId === profile?.id))
    .sort((a, b) => b.score - a.score);
  const others = (nearby.data ?? []).filter((r) => !ownIds.has(r.summary.id));
  const failedSources = shelters.data?.sources.filter((s) => s.status !== 'ok') ?? [];
  const species = mine.data?.pets[0]?.species ?? 'dog';

  const sightings = useLive(
    async () => {
      if (!discover || !place) return undefined;
      const city = place.city || place.label;
      const [social, animals] = await Promise.all([
        city
          ? agent.post<Sourced<ExternalReport>>(token!, '/v1/ingestion/bluesky/search', { city, species, limit: 6 })
          : Promise.resolve({ items: [] as ExternalReport[], sources: [] as Sourced<ExternalReport>['sources'] }),
        agent.post<Sourced<ExternalReport>>(token!, '/v1/ingestion/animals/search', {
          latitude: place.latitude,
          longitude: place.longitude,
          radiusKm: 30,
          species,
          limit: 8,
        }),
      ]);
      return { social, animals };
    },
    `sightings:${discover}:${place?.latitude},${place?.longitude}:${species}`,
  );

  const publicPins = others.slice(0, 12).map((r) => ({
    id: r.summary.id,
    latitude: r.summary.latitude,
    longitude: r.summary.longitude,
    title: `${r.summary.species} ${r.summary.type}`,
    tone: r.summary.type === 'lost' ? ('urgent' as const) : ('case' as const),
  }));
  const sightingFails = [
    ...(sightings.data?.social.sources.filter((s) => s.status !== 'ok') ?? []),
    ...(sightings.data?.animals.sources.filter((s) => s.status !== 'ok') ?? []),
  ];

  return (
    <Screen
      edges={['top']}
      bottomInset={156}
      onRefresh={() => Promise.all([mine.refresh(), nearby.refresh(), shelters.refresh(), discover ? sightings.refresh() : Promise.resolve()])}>
      <Hero title="We're here to help. ♡" subtitle={profile ? `Hi ${profile.name.split(' ')[0]}` : undefined} right={<NotificationBell />} />
      {!online ? <Notice tone="warning" title="Offline">Showing the last data we loaded. Changes will sync when you reconnect.</Notice> : null}

      <ActionCard title="Lost a pet" detail="Tell us what happened and we'll help bring them home." icon="🐶" onPress={() => router.push('/report/lost')} />
      <ActionCard title="Found a pet" detail="Share where you found them to help reunite them with their family." icon="🐾" onPress={() => router.push('/report/found')} />
      <ActionCard
        title="Need help right now?"
        detail="Ask Pawtricia for guidance with an injured or endangered animal."
        icon="🚨"
        emphasis
        onPress={() => router.push({ pathname: '/chat', params: { prompt: 'I found an injured animal and need help right now.' } })}
      />

      <SectionTitle action={<SourceTag kind="live" />}>Possible matches</SectionTitle>
      {mine.loading && !mine.data ? <Loading /> : null}
      <ErrorNote error={mine.error} onRetry={mine.refresh} />
      {mine.data && !matches.length ? (
        <Empty icon="images-outline" title="No possible matches yet" body="When the image matcher finds a similar animal, it appears here for you to review." />
      ) : null}
      {matches.slice(0, 5).map((m) => (
        <MatchCard key={m.id} match={m} />
      ))}

      <SectionTitle>Your reports</SectionTitle>
      {mine.data && !open.length ? <Muted>You have no open reports.</Muted> : null}
      {open.map((r) => (
        <ReportCard key={r.id} report={r} petName={petName(r)} />
      ))}
      {reports.length > open.length ? <Muted>{reports.length - open.length} closed or reunited report(s) in your history.</Muted> : null}

      <SectionTitle>Nearby cases</SectionTitle>
      {!place ? (
        <>
          <Muted>Share your location to see lost and found reports within 50 km.</Muted>
          <Button label="Use my location" icon="locate" variant="outline" onPress={locate} loading={locating} />
          <ErrorNote error={placeError} />
        </>
      ) : (
        <>
          <Muted>Near {place.label}. Public reports show only an approximate area (about 10 km), never an exact pin or private contact.</Muted>
          <ErrorNote error={nearby.error} onRetry={nearby.refresh} />
          {publicPins.length ? <PinMap center={place} pins={publicPins} /> : null}
          {nearby.data && !others.length ? <Empty title="No open reports nearby" /> : null}
          {others.slice(0, 6).map((r) => (
            <SummaryCard key={r.summary.id} summary={r.summary} distance={r.distance} />
          ))}

          <SectionTitle action={<SourceTag kind="external" />}>Public sightings</SectionTitle>
          <Muted>Search Bluesky posts and published shelter listings. Each result keeps its original source link; PawSafe does not invent matches from these.</Muted>
          {!discover ? (
            <Button label="Search public posts and shelter listings" icon="search" variant="outline" onPress={() => setDiscover(true)} />
          ) : (
            <>
              {sightings.loading && !sightings.data ? <Loading label="Searching public sources…" /> : null}
              <ErrorNote error={sightings.error} onRetry={sightings.refresh} />
              {sightingFails.length ? (
                <Notice tone="warning">{`Some sources didn't respond (${sightingFails.map((s) => s.source).join(', ')}). Showing whatever did.`}</Notice>
              ) : null}
              {sightings.data && !sightings.data.social.items.length && !sightings.data.animals.items.length ? (
                <Empty icon="globe-outline" title="No public listings found" body="This is a source result, not a guarantee that no animals are out there." />
              ) : null}
              {sightings.data?.social.items.map((item) => (
                <ExternalCard key={item.id} item={item} />
              ))}
              {sightings.data?.animals.items.map((item) => (
                <ExternalCard key={item.id} item={item} />
              ))}
              {sightings.data ? <Button label="Search again" icon="refresh" variant="ghost" compact onPress={sightings.refresh} /> : null}
            </>
          )}
        </>
      )}

      {place ? (
        <>
          <SectionTitle>Nearby shelters</SectionTitle>
          {shelters.loading && !shelters.data ? <Loading label="Searching shelter directories…" /> : null}
          <ErrorNote error={shelters.error} onRetry={shelters.refresh} />
          {failedSources.length ? (
            <Notice tone="warning">{`Some directories didn't respond (${failedSources.map((s) => s.source).join(', ')}). Results may be incomplete.`}</Notice>
          ) : null}
          {shelters.data?.items.length ? (
            <PinMap
              center={place}
              pins={shelters.data.items.map((s) => ({ id: s.id, latitude: s.latitude, longitude: s.longitude, title: s.name, tone: 'shelter' as const }))}
            />
          ) : null}
          {shelters.data && !shelters.data.items.length ? (
            <Empty icon="business-outline" title="No shelters found within 30 km" body="This means none were found in the connected directories, not that none exist." />
          ) : null}
          {shelters.data?.items.map((s) => (
            <ShelterCard key={s.id} shelter={s} />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

function ActionCard({ title, detail, icon, emphasis, onPress }: { title: string; detail: string; icon: string; emphasis?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [local.action, emphasis && local.emphasis, pressed && { opacity: 0.8 }]}>
      <Text style={local.emoji}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={local.actionTitle}>{title}</Text>
        <Text style={local.actionDetail}>{detail}</Text>
      </View>
    </Pressable>
  );
}

const local = StyleSheet.create({
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 18,
    shadowColor: '#0064BC',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  emphasis: { borderWidth: 2, borderColor: colors.sky },
  emoji: { fontSize: 30 },
  actionTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  actionDetail: { fontSize: 13, color: colors.muted, marginTop: 2, lineHeight: 18 },
});
