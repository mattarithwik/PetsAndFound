import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, { LinearTransition, ReduceMotion } from 'react-native-reanimated';

import { AlertCard } from '@/components/cards';
import { LocationPicker } from '@/components/location-picker';
import { Body, Button, Card, Chips, Empty, ErrorNote, Loading, Muted, Notice, Screen, SectionTitle, SourceLink, SourceTag, Strong, colors } from '@/components/ui';
import { agent, db } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useAction, useLive } from '@/lib/hooks';
import { feedback, MotionPressable } from '@/lib/motion';
import { usePlace } from '@/lib/place';
import { useSession } from '@/lib/session';
import { readJson, storage, writeJson } from '@/lib/storage';
import type { DisasterRecord, Guidance, Hazard, Pet, Sourced, WeatherAlert } from '@/lib/types';

const hazards: { value: Hazard; label: string }[] = [
  { value: 'tornado', label: 'Tornado' }, { value: 'flood', label: 'Flood' },
  { value: 'wildfire', label: 'Wildfire' }, { value: 'heat', label: 'Extreme heat' },
  { value: 'winter_storm', label: 'Winter storm' }, { value: 'earthquake', label: 'Earthquake' },
];
const kitItems = [
  'Collar with a current ID tag', 'Microchip registration and current contact details',
  'Recent photos of each pet from several angles', 'Food and drinking water for several days',
  'Medications and copies of veterinary records', 'Leash, harness and a carrier for each pet',
  'Litter or other waste supplies', 'Pet-friendly shelters, hotels and boarding contacts',
  'A backup caregiver who can help evacuate your pets',
];
const sections = [
  { value: 'warnings', label: 'Warnings' }, { value: 'guide', label: 'Field guide' }, { value: 'kit', label: 'Emergency kit' },
] as const;
type Section = (typeof sections)[number]['value'];
const kitKey = 'pawsafe.checklist';

function Kit({ owner }: { owner: string }) {
  const key = `${kitKey}.${owner}`;
  const [done, setDone] = useState<number[]>([]);
  const current = useRef<number[]>([]);
  const writes = useRef(Promise.resolve());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    (async () => {
      let saved = await readJson<number[] | null>(key, null);
      if (saved === null) {
        const previous = await readJson<number[] | null>(kitKey, null);
        if (Array.isArray(previous)) {
          await writeJson(key, previous);
          await storage.remove(kitKey);
          saved = previous;
        }
      }
      if (!alive) return;
      const values = Array.isArray(saved) ? [...new Set(saved.filter((i) => Number.isInteger(i) && i >= 0 && i < kitItems.length))] : [];
      current.current = values;
      setDone(values);
      setReady(true);
    })().catch(() => { if (alive) setError('Your saved checklist could not be loaded.'); });
    return () => { alive = false; };
  }, [key]);
  const toggle = (index: number) => {
    const selected = current.current;
    const next = selected.includes(index) ? selected.filter((item) => item !== index) : [...selected, index];
    current.current = next;
    setDone(next);
    writes.current = writes.current.then(async () => {
      await writeJson(key, next);
      setError('');
    }).catch(() => setError('Your latest checks could not be saved on this device.'));
  };
  return <>
    <SectionTitle>Emergency kit</SectionTitle>
    <Muted>{done.length} of {kitItems.length} ready · saved {Platform.OS === 'web' ? 'in this browser tab' : 'on this device'}</Muted>
    <View style={local.track}><Animated.View layout={LinearTransition.duration(220).reduceMotion(ReduceMotion.System)} style={[local.progress, { width: `${done.length / kitItems.length * 100}%` }]} /></View>
    <ErrorNote error={error} />
    <Card>{kitItems.map((item, index) => (
      <MotionPressable key={item} disabled={!ready} feedback="selection" onPress={() => toggle(index)} style={local.check} accessibilityRole="checkbox" accessibilityState={{ checked: done.includes(index) }}>
        <Ionicons name={done.includes(index) ? 'checkbox' : 'square-outline'} size={22} color={colors.navy} />
        <Body style={[{ flex: 1 }, done.includes(index) && local.checked]}>{item}</Body>
      </MotionPressable>
    ))}</Card>
  </>;
}

export default function Prepare() {
  const { token, profile } = useSession();
  const { place, setPlace } = usePlace();
  const [section, setSection] = useState<Section>('warnings');
  const [changePlace, setChangePlace] = useState(false);
  const [hazard, setHazard] = useState<Hazard>('tornado');
  const [petId, setPetId] = useState('');
  const alertAction = useAction();
  const alertLocation = useLive(() => db.read<{ latitude: number; longitude: number } | null>(token!, 'alert_location'), `alert-location:${profile?.id}`, 60000);
  const subscribed = !!place && !!alertLocation.data && Math.abs(place.latitude - alertLocation.data.latitude) < 0.0001 && Math.abs(place.longitude - alertLocation.data.longitude) < 0.0001;
  const pets = useLive(() => db.read<Pet[]>(token!, 'pets'), `prep-pets:${profile?.id}`, 0, ['my_pets']);
  const pet = pets.data?.find((p) => p.id === petId) ?? pets.data?.[0];
  const alerts = useLive(async () => place ? agent.get<Sourced<WeatherAlert>>(token!,
    `/v1/weather/alerts?latitude=${place.latitude.toFixed(4)}&longitude=${place.longitude.toFixed(4)}`) : undefined,
    `alerts:${place?.latitude},${place?.longitude}`, 120000);
  const guidance = useLive(async () => section === 'guide' ? agent.get<Guidance>(token!,
    `/v1/preparedness?hazard=${hazard}${pet ? `&species=${pet.species}` : ''}`) : undefined, `guidance:${section}:${hazard}:${pet?.species}`);
  const history = useLive(async () => section === 'guide' && place?.state ? agent.get<Sourced<DisasterRecord>>(token!,
    `/v1/disasters/history?state=${place.state}&since=${new Date(Date.now() - 5 * 365 * 86400000).toISOString()}`) : undefined, `history:${section}:${place?.state}`);
  const nwsDown = alerts.data?.sources.some((s) => s.status !== 'ok');
  const femaDown = history.data?.sources.some((s) => s.status !== 'ok');
  return (
    <Screen edges={['top']} bottomInset={128}>
      <View style={local.hero}>
        <View style={local.heroCopy}>
          <Text style={local.eyebrow}>PET PREPAREDNESS</Text>
          <Text accessibilityRole="header" style={local.heroTitle}>Your emergency plan</Text>
          <Text style={local.sub}>{place?.city || place?.state ? [place.city, place.state].filter(Boolean).join(', ') : 'Local warnings, safety guidance and supplies for your pets.'}</Text>
        </View>
        <Image source={require('../../../assets/daisy.png')} contentFit="cover" style={local.heroPhoto} />
      </View>
      <Chips options={[...sections]} value={section} onChange={setSection} />
      {section === 'warnings' ? <>
        <SectionTitle action={<SourceTag kind="official" />}>Active warnings</SectionTitle>
        <Card>
          {place && !changePlace ? <View style={local.location}>
            <Ionicons name="location-outline" color={colors.navy} size={21} />
            <Body style={{ flex: 1 }}>{place.label}</Body>
            <Button label="Change" variant="ghost" compact onPress={() => setChangePlace(true)} />
          </View> : <LocationPicker label="Choose an area for weather alerts" value={place} onChange={(value) => { setPlace(value); setChangePlace(false); }} />}
        </Card>
        {place ? <>
          <Button label={subscribed ? 'Stop alerts for this area' : 'Get alerts for this area'} variant="outline" loading={alertAction.busy === 'alerts'} onPress={() => alertAction.run('alerts', async () => {
            if (subscribed) await db.call(token!, 'remove_alert_location', {});
            else await db.call(token!, 'set_alert_location', { latitude: place.latitude, longitude: place.longitude });
            await alertLocation.refresh();
            feedback('success');
          })} />
          <Muted>When enabled, PawSafe checks official warnings for this area and adds new alerts to your notifications.</Muted>
          <ErrorNote error={alertAction.error ?? alertLocation.error} onRetry={alertLocation.refresh} />
        </> : null}
        {place && alerts.loading && !alerts.data ? <Loading label="Checking the National Weather Service…" /> : null}
        <ErrorNote error={alerts.error} onRetry={alerts.refresh} />
        {nwsDown ? <Notice tone="warning" title="Warning feed unavailable">Check the National Weather Service directly for current warnings.</Notice> : null}
        {alerts.data && !alerts.error && !nwsDown && !alerts.data.items.length ? <Card tone="success"><Strong>No active NWS warnings for this area.</Strong></Card> : null}
        {alerts.data?.items.filter((a) => !a.expiresAt || Date.parse(a.expiresAt) > Date.now()).map((a) => <AlertCard key={a.alertId} alert={a} />)}
        <SourceLink url="https://www.weather.gov/" label="Visit the National Weather Service" />
      </> : null}
      {section === 'guide' ? <>
        <SectionTitle action={<SourceTag kind="curated" />}>Hazard field guide</SectionTitle>
        {pets.data && pets.data.length > 1 ? <Chips label="Guidance for" options={pets.data.map((p) => ({ value: p.id, label: p.name }))} value={pet?.id} onChange={setPetId} /> : null}
        <Chips label="Choose a hazard" options={hazards} value={hazard} onChange={setHazard} />
        {guidance.loading && !guidance.data ? <Loading label="Loading safety guidance…" /> : null}
        <ErrorNote error={guidance.error} onRetry={guidance.refresh} />
        {guidance.data ? <Card>
          {pet ? <Strong>For {pet.name}</Strong> : null}
          {guidance.data.items.map((item) => <View key={item} style={local.check}><Ionicons name="checkmark-circle-outline" size={20} color={colors.navy} /><Body style={{ flex: 1 }}>{item}</Body></View>)}
          {guidance.data.sourceUrls.map((url) => <SourceLink key={url} url={url} />)}
        </Card> : null}
        {place?.state ? <>
          <SectionTitle action={<SourceTag kind="historical" />}>Disaster history · {place.state}</SectionTitle>
          <Muted>Federal declarations from the past five years.</Muted>
          <ErrorNote error={history.error} onRetry={history.refresh} />
          {femaDown ? <Notice tone="warning">OpenFEMA records are unavailable.</Notice> : null}
          {history.loading && !history.data ? <Loading label="Looking up FEMA records…" /> : null}
          {history.data && !femaDown && !history.data.items.length ? <Empty title="No declarations in this period" /> : null}
          {history.data?.items.slice(0, 8).map((d) => <Card key={d.id ?? `${d.disasterNumber}:${d.area}`}>
            <Strong>{d.title || d.incidentType || `Disaster ${d.disasterNumber}`}</Strong>
            <Muted>{[d.area, dateTime(d.declarationDate)].filter(Boolean).join(' · ')}</Muted>
            <SourceLink url={d.sourceUrl} label="View FEMA declaration" />
          </Card>)}
        </> : <Button label="Set area for disaster history" icon="location-outline" variant="outline" onPress={() => { setSection('warnings'); setChangePlace(true); }} />}
      </> : null}
      {section === 'kit' && profile ? <Kit key={profile.id} owner={profile.id} /> : null}
    </Screen>
  );
}
const local = StyleSheet.create({
  hero: { flexDirection: 'row', backgroundColor: '#D8EBFB', borderRadius: 22, overflow: 'hidden', minHeight: 166 },
  heroCopy: { flex: 1, justifyContent: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 22 },
  heroPhoto: { width: '31%', maxWidth: 190, height: '100%', position: 'relative' },
  eyebrow: { color: '#205B8B', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  heroTitle: { fontSize: 34, lineHeight: 37, fontFamily: Platform.select({ ios: 'Georgia', web: 'Georgia', default: 'serif' }), fontWeight: 'bold', color: '#112F46', letterSpacing: -0.7 },
  sub: { color: '#34516A', fontSize: 14, lineHeight: 20 },
  location: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  checked: { color: colors.muted, textDecorationLine: 'line-through' },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  progress: { height: '100%', backgroundColor: colors.navy },
});
