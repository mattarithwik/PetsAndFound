import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { AlertCard } from '@/components/cards';
import { Body, Button, Card, Chips, Empty, ErrorNote, Hero, ListRow, Loading, Muted, Notice, Screen, SectionTitle, SourceLink, SourceTag, colors } from '@/components/ui';
import { agent, db } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useLive } from '@/lib/hooks';
import { usePlace } from '@/lib/place';
import { useSession } from '@/lib/session';
import { readJson, writeJson } from '@/lib/storage';
import type { DisasterRecord, Guidance, Hazard, Pet, Sourced, WeatherAlert } from '@/lib/types';

const hazards: { value: Hazard; label: string }[] = [
  { value: 'tornado', label: 'Tornado' },
  { value: 'flood', label: 'Flood' },
  { value: 'wildfire', label: 'Wildfire' },
  { value: 'heat', label: 'Extreme heat' },
];

const checklist = [
  'Collar with current ID tag on every pet',
  'Microchip registered with up-to-date contact info',
  'Recent photos of each pet from several angles (add them in Profile)',
  '3–7 days of food and water per pet',
  'Medications and copies of vet records',
  'Leash, harness and a carrier for each pet',
  'Litter box and supplies (cats)',
  'List of pet-friendly shelters, hotels and boarding near you',
  'A friend or neighbor who can evacuate your pets if you can’t',
];

const CHECK_KEY = 'pawsafe.checklist';

export default function Prepare() {
  const { token } = useSession();
  const { place, locate, locating, error: placeError } = usePlace();
  const [hazard, setHazard] = useState<Hazard>('tornado');
  const [done, setDone] = useState<number[]>([]);

  useEffect(() => {
    readJson<number[]>(CHECK_KEY, []).then(setDone);
  }, []);
  const toggle = (index: number) => {
    const next = done.includes(index) ? done.filter((i) => i !== index) : [...done, index];
    setDone(next);
    writeJson(CHECK_KEY, next);
  };

  const pets = useLive(() => db.read<Pet[]>(token!, 'pets'), 'pets');
  const species = pets.data?.[0]?.species;

  const alerts = useLive(
    async () =>
      place
        ? agent.get<Sourced<WeatherAlert>>(token!, `/v1/weather/alerts?latitude=${place.latitude.toFixed(4)}&longitude=${place.longitude.toFixed(4)}`)
        : undefined,
    `alerts:${place?.latitude},${place?.longitude}`,
    120000,
  );
  const guidance = useLive(
    () => agent.get<Guidance>(token!, `/v1/preparedness?hazard=${hazard}${species ? `&species=${species}` : ''}`),
    `guidance:${hazard}:${species}`,
  );
  const history = useLive(
    async () =>
      place?.state
        ? agent.get<Sourced<DisasterRecord>>(token!, `/v1/disasters/history?state=${place.state}&since=${new Date(Date.now() - 5 * 365 * 86400000).toISOString()}`)
        : undefined,
    `fema:${place?.state}`,
  );

  const nwsDown = alerts.data?.sources.some((s) => s.status !== 'ok');
  const femaDown = history.data?.sources.some((s) => s.status !== 'ok');

  return (
    <Screen edges={['top']} bottomInset={156}>
      <Hero title="Prepare" subtitle="Official warnings, curated pet-safety guidance and your emergency checklist." />

      <SectionTitle action={<SourceTag kind="official" />}>Active warnings</SectionTitle>
      {!place ? (
        <>
          <Muted>Share your location to check National Weather Service alerts for your area.</Muted>
          <Button label="Use my location" icon="locate" variant="outline" onPress={locate} loading={locating} />
          <ErrorNote error={placeError} />
        </>
      ) : (
        <>
          <Muted>For {place.label}</Muted>
          {alerts.loading && !alerts.data ? <Loading label="Checking weather.gov…" /> : null}
          <ErrorNote error={alerts.error} onRetry={alerts.refresh} />
          {nwsDown ? <Notice tone="warning" title="NWS unavailable">We couldn't reach the National Weather Service. This does not mean there are no warnings — check local news or weather.gov.</Notice> : null}
          {alerts.data && !nwsDown && !alerts.data.items.length ? (
            <Card tone="success">
              <Text style={local.ok}>No active NWS warnings for this location right now.</Text>
            </Card>
          ) : null}
          {alerts.data?.items.map((a) => <AlertCard key={a.alertId} alert={a} />)}
        </>
      )}

      <SectionTitle action={<SourceTag kind="curated" />}>Hazard guidance</SectionTitle>
      <Chips options={hazards} value={hazard} onChange={setHazard} />
      <ErrorNote error={guidance.error} onRetry={guidance.refresh} />
      {guidance.data ? (
        <Card>
          {guidance.data.items.map((item) => (
            <ListRow key={item} icon="checkmark-circle-outline" title={item} />
          ))}
          <Muted>Sources</Muted>
          {guidance.data.sourceUrls.map((url) => (
            <SourceLink key={url} url={url} />
          ))}
        </Card>
      ) : null}

      <SectionTitle>Pet emergency kit</SectionTitle>
      <Muted>
        {done.length} of {checklist.length} ready · saved on this device
      </Muted>
      <Card>
        {checklist.map((item, index) => (
          <Pressable key={item} onPress={() => toggle(index)} style={local.check} accessibilityRole="checkbox" accessibilityState={{ checked: done.includes(index) }}>
            <Ionicons name={done.includes(index) ? 'checkbox' : 'square-outline'} size={22} color={colors.sky} />
            <Body style={done.includes(index) ? local.checked : undefined}>{item}</Body>
          </Pressable>
        ))}
      </Card>

      {place?.state ? (
        <>
          <SectionTitle action={<SourceTag kind="historical" />}>Recent disasters in {place.state}</SectionTitle>
          <Muted>Federal declarations from the last five years. Historical context only — not a current warning.</Muted>
          <ErrorNote error={history.error} onRetry={history.refresh} />
          {femaDown ? <Notice tone="warning">OpenFEMA is unavailable right now.</Notice> : null}
          {history.data && !femaDown && !history.data.items.length ? <Empty title="No recent declarations found" /> : null}
          {history.data?.items.slice(0, 8).map((d) => (
            <ListRow key={d.id ?? d.disasterNumber} icon="time-outline" title={d.title ?? d.incidentType ?? `Disaster ${d.disasterNumber}`} detail={`${d.incidentType ?? ''} · ${d.area ?? ''} · declared ${dateTime(d.declarationDate)}`} />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const local = StyleSheet.create({
  ok: { color: colors.success, fontWeight: '700' },
  check: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 7 },
  checked: { color: colors.muted, textDecorationLine: 'line-through' },
});
