import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ExternalCard, MatchCard, NotificationBell, ReportCard, ShelterCard, SummaryCard } from '@/components/cards';
import { PinMap } from '@/components/pin-map';
import { LocationPicker } from '@/components/location-picker';
import {
  Button,
  Chips,
  Empty,
  ErrorNote,
  ListRow,
  Loading,
  Muted,
  Notice,
  Screen,
  SectionTitle,
  SourceTag,
  colors,
  type IconName,
} from '@/components/ui';
import { agent, db } from '@/lib/api';
import { useLive } from '@/lib/hooks';
import { distanceKm } from '@/lib/location';
import { usePlace } from '@/lib/place';
import { useSession } from '@/lib/session';
import type { ExternalReport, Match, NearbyShelter, Pet, Report, ReportSummary, Sourced, Species } from '@/lib/types';

export default function Rescue() {
  const { token, profile, online } = useSession();
  const { place, setPlace } = usePlace();
  const [discover, setDiscover] = useState(false);
  const [areaOpen, setAreaOpen] = useState(false);
  const [section, setSection] = useState<'reports' | 'nearby' | 'shelters'>('reports');
  const [history, setHistory] = useState(false);
  const [species, setSpecies] = useState<Species>('dog');

  const mine = useLive(
    async () => {
      const [reports, matches, pets] = await Promise.all([
        db.read<Report[]>(token!, 'reports'),
        db.read<Match[]>(token!, 'matches'),
        db.read<Pet[]>(token!, 'pets'),
      ]);
      return { reports, matches, pets };
    },
    `mine:${profile?.id}`,
    6000,
    ['my_reports', 'my_matches', 'my_pets'],
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
    ['report_summaries'],
  );

  const shelters = useLive(
    async () =>
      place && section === 'shelters'
        ? agent.post<Sourced<NearbyShelter>>(token!, '/v1/ingestion/shelters/sync', {
            latitude: place.latitude,
            longitude: place.longitude,
            radiusKm: 30,
            limit: 8,
          })
        : undefined,
    `shelters:${section}:${place?.latitude},${place?.longitude}`,
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

  const sightings = useLive(async () => {
    if (!discover || !place || section !== 'nearby') return undefined;
    const city = place.city;
    const [social, animals] = await Promise.allSettled([
      city
        ? agent.post<Sourced<ExternalReport>>(token!, '/v1/ingestion/bluesky/search', { city, species, limit: 6 })
        : Promise.resolve({
            items: [] as ExternalReport[],
            sources: [{ source: 'Bluesky (city required)', status: 'unavailable' as const }],
          }),
      agent.post<Sourced<ExternalReport>>(token!, '/v1/ingestion/animals/search', {
        latitude: place.latitude,
        longitude: place.longitude,
        radiusKm: 30,
        species,
        limit: 8,
      }),
    ]);
    const groups = [social, animals].map((result, index): Sourced<ExternalReport> =>
      result.status === 'fulfilled'
        ? result.value
        : { items: [], sources: [{ source: index === 0 ? 'Bluesky' : 'Shelter listings', status: 'unavailable' }] },
    );
    return { items: groups.flatMap((group) => group.items), sources: groups.flatMap((group) => group.sources) };
  }, `sightings:${section}:${discover}:${place?.latitude},${place?.longitude}:${species}`);

  const publicPins = others.slice(0, 12).map((r) => ({
    id: r.summary.id,
    latitude: r.summary.latitude,
    longitude: r.summary.longitude,
    title: `${r.summary.species} ${r.summary.type}`,
    tone: r.summary.type === 'lost' ? ('urgent' as const) : ('case' as const),
  }));
  const sightingFails = sightings.data?.sources.filter((source) => source.status !== 'ok') ?? [];

  return (
    <Screen
      edges={['top']}
      bottomInset={156}
      onRefresh={() =>
        Promise.all([mine.refresh(), nearby.refresh(), shelters.refresh(), discover ? sightings.refresh() : Promise.resolve()])
      }
    >
      <View style={local.hero}>
        <View style={local.headline}>
          <Text style={local.greeting}>{profile ? `Hello, ${profile.name.split(' ')[0]}` : 'Welcome'}</Text>
          <Text accessibilityRole="header" style={local.title}>
            Rescue center
          </Text>
          <Text style={local.heroDetail}>Report a lost or found pet and follow their search.</Text>
        </View>
        <Image source={require('@/assets/logo.png')} contentFit="contain" style={local.heroArt} />
        <View style={local.bell}>
          <NotificationBell />
        </View>
      </View>
      {!online ? (
        <Notice tone="warning" title="Offline">
          Reconnect to publish a report or check for updates.
        </Notice>
      ) : null}
      <View style={local.actions}>
        <ActionCard title="I lost a pet" detail="Start a search" icon="search" onPress={() => router.push('/report/lost')} />
        <ActionCard
          title="I found a pet"
          detail="Report a sighting"
          icon="paw-outline"
          onPress={() => router.push('/report/found')}
        />
      </View>
      <ListRow
        icon="medkit-outline"
        title="Injured animal?"
        detail="Record their condition for shelter staff."
        onPress={() => router.push({ pathname: '/report/found', params: { condition: 'injured' } })}
      />
      <Chips
        value={section}
        onChange={setSection}
        options={[
          { value: 'reports', label: 'My reports' },
          { value: 'nearby', label: 'Nearby cases' },
          { value: 'shelters', label: 'Shelters' },
        ]}
      />

      {section === 'reports' ? (
        <>
          <SectionTitle>Possible matches</SectionTitle>
          {mine.loading && !mine.data ? <Loading /> : null}
          <ErrorNote error={mine.error} onRetry={mine.refresh} />
          {mine.data && !matches.length ? (
            <Empty
              icon="images-outline"
              title="No possible matches yet"
              body="When the image matcher finds a similar animal, it appears here for you to review."
            />
          ) : null}
          {matches.map((m) => (
            <MatchCard key={m.id} match={m} />
          ))}

          <SectionTitle>Your reports</SectionTitle>
          {mine.data && !open.length ? <Muted>You have no open reports.</Muted> : null}
          {open.map((r) => (
            <ReportCard key={r.id} report={r} petName={petName(r)} />
          ))}
          {reports.length > open.length ? (
            <Button
              compact
              variant="ghost"
              label={history ? 'Hide report history' : `View report history (${reports.length - open.length})`}
              onPress={() => setHistory(!history)}
            />
          ) : null}
          {history &&
            reports.filter((r) => r.status !== 'open').map((r) => <ReportCard key={r.id} report={r} petName={petName(r)} />)}
        </>
      ) : null}

      {section !== 'reports' ? (
        <>
          <SectionTitle
            action={
              place ? (
                <Button
                  label={areaOpen ? 'Done' : 'Change area'}
                  compact
                  variant="ghost"
                  onPress={() => setAreaOpen(!areaOpen)}
                />
              ) : undefined
            }
          >
            {section === 'nearby' ? 'Nearby cases' : 'Nearby shelters'}
          </SectionTitle>
          {!place || areaOpen ? (
            <LocationPicker
              label="Search area"
              value={place}
              onChange={(next) => {
                setPlace(next);
                setAreaOpen(false);
              }}
            />
          ) : (
            <Muted>Near {place.label}</Muted>
          )}
        </>
      ) : null}
      {place && section === 'nearby' ? (
        <>
          <Muted>Open reports within 50 km. Pins show approximate locations.</Muted>
          <ErrorNote error={nearby.error} onRetry={nearby.refresh} />
          {nearby.loading ? <Loading label="Loading nearby cases…" /> : null}
          {publicPins.length ? (
            <PinMap center={place} pins={publicPins} onPress={(pin) => router.push(`/reports/${pin.id}`)} />
          ) : null}
          {nearby.data && !others.length ? <Empty title="No open reports nearby" /> : null}
          {others.map((r) => (
            <SummaryCard
              key={r.summary.id}
              summary={r.summary}
              distance={r.distance}
              onPress={() => router.push(`/reports/${r.summary.id}`)}
            />
          ))}

          <SectionTitle action={<SourceTag kind="external" />}>Public sightings</SectionTitle>
          <Chips
            label="Animal to search for"
            value={species}
            onChange={setSpecies}
            options={[
              { value: 'dog', label: 'Dog' },
              { value: 'cat', label: 'Cat' },
              { value: 'other', label: 'Other' },
            ]}
          />
          {!discover ? (
            <Button
              label="Search public posts and shelter listings"
              icon="search"
              variant="outline"
              onPress={() => setDiscover(true)}
            />
          ) : (
            <>
              {sightings.loading && !sightings.data ? <Loading label="Searching public sources…" /> : null}
              <ErrorNote error={sightings.error} onRetry={sightings.refresh} />
              {sightingFails.length ? (
                <Notice tone="warning">{`Some sources didn't respond (${sightingFails.map((s) => s.source).join(', ')}). Showing whatever did.`}</Notice>
              ) : null}
              {sightings.data?.sources.some((s) => s.status === 'ok') && !sightings.data.items.length ? (
                <Empty icon="globe-outline" title="No listings in the available sources" />
              ) : null}
              {sightings.data?.items.map((item) => (
                <ExternalCard key={item.id} item={item} />
              ))}
              {sightings.data ? (
                <Button label="Search again" icon="refresh" variant="ghost" compact onPress={sightings.refresh} />
              ) : null}
            </>
          )}
        </>
      ) : null}

      {place && section === 'shelters' ? (
        <>
          {shelters.loading && !shelters.data ? <Loading label="Searching shelter directories…" /> : null}
          <ErrorNote error={shelters.error} onRetry={shelters.refresh} />
          {failedSources.length ? (
            <Notice tone="warning">{`Some directories didn't respond (${failedSources.map((s) => s.source).join(', ')}). Results may be incomplete.`}</Notice>
          ) : null}
          {shelters.data?.items.length ? (
            <PinMap
              center={place}
              pins={shelters.data.items.map((s) => ({
                id: s.id,
                latitude: s.latitude,
                longitude: s.longitude,
                title: s.name,
                tone: 'shelter' as const,
              }))}
            />
          ) : null}
          {shelters.data && !shelters.data.items.length ? (
            <Empty
              icon="business-outline"
              title="No shelters found within 30 km"
              body="This means none were found in the connected directories, not that none exist."
            />
          ) : null}
          {shelters.data?.items.map((s) => (
            <ShelterCard key={s.id} shelter={s} />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

function ActionCard({ title, detail, icon, onPress }: { title: string; detail: string; icon: IconName; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [local.action, pressed && { opacity: 0.8 }]}>
      <View style={local.actionIcons}>
        <Ionicons name={icon} color={colors.navy} size={24} />
        <Ionicons name="arrow-forward" size={17} color={colors.navy} />
      </View>
      <View>
        <Text style={local.actionTitle}>{title}</Text>
        <Text style={local.actionDetail}>{detail}</Text>
      </View>
    </Pressable>
  );
}

const local = StyleSheet.create({
  hero: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    borderRadius: 24,
    padding: 23,
    paddingVertical: 30,
    minHeight: 190,
    backgroundColor: '#14598E',
  },
  headline: { flex: 1, zIndex: 1, gap: 7 },
  greeting: { color: '#D5EBFF', fontWeight: '700', fontSize: 14 },
  title: {
    color: 'white',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', web: 'Georgia, serif' }),
    fontWeight: '700',
    fontSize: 38,
    lineHeight: 44,
  },
  heroDetail: { color: '#E8F5FF', fontSize: 14, maxWidth: 330, lineHeight: 20 },
  heroArt: { width: '27%', maxWidth: 150, height: 112, marginTop: 24, marginLeft: 7 },
  bell: { position: 'absolute', top: 8, right: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  action: {
    flex: 1,
    minWidth: 130,
    gap: 15,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
  },
  actionIcons: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actionTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  actionDetail: { fontSize: 13, color: colors.muted, marginTop: 2, lineHeight: 18 },
});
