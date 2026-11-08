import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import {
  Body,
  Button,
  Card,
  ErrorNote,
  Muted,
  Row,
  Screen,
  SectionTitle,
  SourceLink,
  Stat,
  Strong,
  colors,
} from '@/components/ui';
import { agent, ApiError, db } from '@/lib/api';
import {
  animals,
  companions,
  hazards,
  replay,
  sceneArt,
  type ActiveDrill,
  type Animal,
  type DrillHazard,
  type DrillRecord,
} from '@/lib/drills';
import { capitalize } from '@/lib/format';
import { useAction, useLive } from '@/lib/hooks';
import { uuid } from '@/lib/ids';
import { useSession } from '@/lib/session';
import { readJson, writeJson } from '@/lib/storage';

const midnight = '#172345';

function Banner({ title, caption, animal = 'dog' }: { title: string; caption: string; animal?: Animal }) {
  return (
    <View style={s.banner}>
      <View style={s.bannerWords}>
        <Text style={s.kicker}>PRACTICE ARCADE</Text>
        <Text accessibilityRole="header" style={s.bannerTitle}>
          {title}
        </Text>
        <Text style={s.bannerCaption}>{caption}</Text>
      </View>
      <View style={s.portrait}>
        <Image source={companions[animal].image} style={s.heroPet} contentFit="contain" />
        <View style={s.ground} />
      </View>
    </View>
  );
}

export function DrillRoom({ deviceOnly = false }: { deviceOnly?: boolean }) {
  const { token, profile } = useSession();
  const { width } = useWindowDimensions();
  const [selected, setSelected] = useState<DrillHazard>();
  const [run, setRun] = useState<ActiveDrill>();
  const [localRun, setLocalRun] = useState<DrillRecord>();
  const [explanation, setExplanation] = useState<string>();
  const [wantsLocal, setWantsLocal] = useState(false);
  const [startingAnimal, setStartingAnimal] = useState<Animal>();
  const requestId = useRef<string>('');
  const { busy, error, setError, run: perform } = useAction();
  const accountToken = deviceOnly ? undefined : token;
  const storageKey = 'pawsafe.drills.' + (deviceOnly ? 'guest' : (profile?.id ?? 'guest'));

  const library = useLive(
    () => (accountToken ? agent.get<{ id: DrillHazard }[]>(accountToken, '/v1/scenarios') : Promise.resolve([])),
    'drills.catalog.' + storageKey,
  );
  const localHistory = useLive(() => readJson<DrillRecord[]>(storageKey, []), storageKey);
  const accountHistory = useLive(
    () => (accountToken ? db.read<DrillRecord[]>(accountToken, 'simulation_runs') : Promise.resolve([])),
    'drills.history.' + storageKey,
  );
  const canSaveOnline = !!accountToken && !wantsLocal && !!library.data?.some((item) => item.id === selected);

  const pick = (scenario: DrillHazard) => {
    setSelected(scenario);
    setWantsLocal(false);
    setStartingAnimal(undefined);
    setError(undefined);
    requestId.current = uuid();
  };

  const saveLocal = async (record: DrillRecord) => {
    const existing = await readJson<DrillRecord[]>(storageKey, []);
    const recent = [record, ...existing.filter((item) => item.id !== record.id)].slice(0, 6);
    const next = replay(record);
    await writeJson(storageKey, recent);
    await localHistory.refresh();
    setLocalRun(record);
    setRun(next);
  };

  const start = (animal: Animal) =>
    perform('start', async () => {
      if (!selected) return;
      // Retrying a dropped response uses the same ID unless the player changes companion.
      if (startingAnimal && startingAnimal !== animal) requestId.current = uuid();
      setStartingAnimal(animal);
      setExplanation(undefined);
      if (canSaveOnline) {
        const result = await agent.post<ActiveDrill>(accountToken!, '/v1/simulations', {
          id: requestId.current,
          scenarioId: selected,
          animal,
        });
        setLocalRun(undefined);
        setRun(result);
        return;
      }
      await saveLocal({
        id: requestId.current,
        scenarioId: selected,
        state: { animal, choices: [], edition: 2 },
      });
    });

  const resume = (record: DrillRecord, local: boolean) =>
    perform('resume', async () => {
      const next = local
        ? replay(record)
        : await agent.get<ActiveDrill>(accountToken!, '/v1/simulations/' + record.id);
      setLocalRun(local ? record : undefined);
      setSelected(record.scenarioId);
      setExplanation(undefined);
      setRun(next);
    });

  const choose = (choiceId: string) =>
    perform(choiceId, async () => {
      if (!run) return;
      if (localRun) {
        await saveLocal({
          ...localRun,
          state: { ...localRun.state, choices: [...localRun.state.choices, choiceId] },
        });
        return;
      }
      const path = '/v1/simulations/' + run.id;
      try {
        setRun(
          await agent.post<ActiveDrill>(accountToken!, path + '/choices', { choiceId, revision: run.revision }),
        );
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) setRun(await agent.get<ActiveDrill>(accountToken!, path));
        throw e;
      }
    });

  const leave = () => {
    setSelected(undefined);
    setRun(undefined);
    setLocalRun(undefined);
    setError(undefined);
    setExplanation(undefined);
    if (accountToken) void accountHistory.refresh();
  };

  const explain = () =>
    perform('feedback', async () => {
      if (!run) return;
      const result = await agent.post<{ feedback: string }>(
        accountToken!,
        '/v1/simulations/' + run.id + '/feedback',
        {},
      );
      setExplanation(result.feedback);
    });

  const past = [
    ...(localHistory.data ?? []).map((record) => ({ record, local: true })),
    ...(accountHistory.data ?? [])
      .slice()
      .reverse()
      .map((record) => ({ record, local: false })),
  ];

  const animal = run?.animal ?? 'dog';
  const scene = selected ? sceneArt[selected] : undefined;
  const tileWidth = width >= 700 ? '31%' : '47%';
  const screenKey = run ? run.id + (run.scene?.id ?? 'complete') : (selected ?? 'menu');

  return (
    <Screen
      key={screenKey}
      edges={deviceOnly ? [] : ['top']}
      bottomInset={deviceOnly ? 40 : 120}
      contentStyle={s.content}
    >
      {!selected ? (
        <>
          <Banner
            title="Rescue drills"
            caption="Choose a fictional situation and practice getting a pet to safety."
          />
          <SectionTitle>Choose a situation</SectionTitle>
          <View style={s.grid}>
            {hazards.map((hazard) => (
              <Pressable
                key={hazard}
                accessibilityRole="button"
                onPress={() => pick(hazard)}
                accessibilityLabel={sceneArt[hazard].title}
                style={({ pressed }) => [s.tile, { width: tileWidth }, pressed && s.pressed]}
              >
                <Image source={sceneArt[hazard].image} style={s.tileScene} contentFit="cover" />
                <View style={s.tileFooter}>
                  <Text style={s.tileTitle}>{sceneArt[hazard].title}</Text>
                  <Ionicons name="arrow-forward" size={17} color={colors.navy} />
                </View>
              </Pressable>
            ))}
          </View>
          {past.length > 0 && <SectionTitle>Practice history</SectionTitle>}
          {past.slice(0, 12).map(({ record, local }) => {
            const snapshot = replay(record);
            return (
              <Pressable
                key={(local ? 'local' : 'account') + record.id}
                accessibilityRole="button"
                disabled={!!busy}
                onPress={() => resume(record, local)}
                style={({ pressed }) => [s.past, pressed && s.pressed]}
              >
                <Image source={sceneArt[record.scenarioId].image} style={s.thumbnail} />
                <View style={s.grow}>
                  <Strong>
                    {sceneArt[record.scenarioId].title} · {capitalize(snapshot.animal)}
                  </Strong>
                  <Muted>
                    {snapshot.completed ? 'Score ' + snapshot.score + '/100' : 'Resume drill'} ·{' '}
                    {local ? 'On this device' : 'Account'}
                  </Muted>
                </View>
                <Ionicons name="chevron-forward" color={colors.navy} size={18} />
              </Pressable>
            );
          })}
          <ErrorNote error={error} />
        </>
      ) : !run ? (
        <>
          <Button
            label="All situations"
            variant="ghost"
            compact
            icon="arrow-back"
            disabled={!!busy}
            onPress={leave}
            style={s.back}
          />
          <Banner title={scene!.title} caption="Choose the pet you’ll guide through this drill." />
          <SectionTitle>Choose your companion</SectionTitle>
          <View style={s.grid}>
            {animals.map((a) => (
              <Pressable
                key={a}
                accessibilityRole="button"
                accessibilityLabel={'Play as ' + a}
                disabled={!!busy}
                onPress={() => start(a)}
                style={({ pressed }) => [s.companion, { width: tileWidth }, pressed && s.pressed]}
              >
                <Image source={companions[a].image} style={s.companionImage} contentFit="contain" />
                <Text style={s.tileTitle}>
                  {busy === 'start' && startingAnimal === a ? 'Starting…' : capitalize(a)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Muted>
            {canSaveOnline
              ? 'Progress saves to your PawSafe account.'
              : 'This practice run saves on this device.'}
          </Muted>
          <ErrorNote error={error} />
          {error && canSaveOnline && (
            <Button
              label="Switch to on-device practice"
              icon="phone-portrait-outline"
              variant="outline"
              onPress={() => {
                setWantsLocal(true);
                setError(undefined);
              }}
            />
          )}
        </>
      ) : (
        <>
          <View style={s.stage}>
            <Image source={scene!.image} contentFit="cover" style={StyleSheet.absoluteFill} />
            <View style={s.stageTag}>
              <Text style={s.kicker}>FICTIONAL DRILL</Text>
            </View>
            <Image source={companions[animal].image} contentFit="contain" style={s.stagePet} />
          </View>
          <Muted>
            {scene!.title} / {capitalize(animal)} / {localRun ? 'On this device' : 'Account'}
          </Muted>
          {run.scene ? (
            <>
              <View style={s.progress}>
                <View
                  style={[
                    s.progressFill,
                    { width: (((run.history.length + 1) * 100) / run.totalDecisions + '%') as `${number}%` },
                  ]}
                />
              </View>
              {run.history.length > 0 && (
                <Card tone="info">
                  <Strong>What happened</Strong>
                  <Body>{run.history[run.history.length - 1].feedback}</Body>
                </Card>
              )}
              <Text style={s.step}>
                Decision {run.history.length + 1} of {run.totalDecisions}
              </Text>
              <Text style={s.story}>{run.scene.title}</Text>
              {run.scene.choices.map((c) => (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  disabled={!!busy}
                  onPress={() => choose(c.id)}
                  style={({ pressed }) => [s.choice, pressed && s.pressed]}
                >
                  <Text style={s.choiceLabel}>{c.label}</Text>
                  <Ionicons name="arrow-forward-circle-outline" color={colors.navy} size={22} />
                </Pressable>
              ))}
            </>
          ) : (
            <>
              <View style={s.results}>
                <Text style={s.kicker}>DRILL COMPLETE</Text>
                <Text style={s.score}>
                  {run.score}
                  <Text style={s.scoreTotal}> / 100</Text>
                </Text>
                <Text style={s.bannerCaption}>Your preparedness score</Text>
              </View>
              <Row>
                <Stat label="Pet safety" value={run.metrics.petSafety} tone="success" />
                <Stat label="Preparedness" value={run.metrics.preparedness} tone="warning" />
                <Stat label="Decision quality" value={run.metrics.decisionQuality} tone="sim" />
              </Row>
              <Muted>Game score weights are 50% pet safety, 30% preparedness and 20% decision quality.</Muted>
              <SectionTitle>Decision review</SectionTitle>
              {run.history.map((item, index) => (
                <Card key={index}>
                  <Strong>{item.label}</Strong>
                  <Body>{item.feedback}</Body>
                </Card>
              ))}
              <Card tone="info">
                <Strong>For your {animal}’s kit</Strong>
                <Body>{companions[animal].gear}</Body>
                <SourceLink
                  label="Pet preparedness guidance · CDC"
                  url="https://www.cdc.gov/healthy-pets/emergency-preparedness/"
                />
              </Card>
              <SourceLink label="Official guidance for this scenario" url={run.source} />
              {!localRun &&
                (explanation ? (
                  <Card tone="sim">
                    <Strong>Pawtricia’s AI debrief</Strong>
                    <Body>{explanation}</Body>
                  </Card>
                ) : (
                  <Button
                    label="Get Pawtricia’s debrief"
                    icon="sparkles-outline"
                    variant="outline"
                    onPress={explain}
                    loading={busy === 'feedback'}
                  />
                ))}
            </>
          )}
          <ErrorNote error={error} />
          <Button
            label={run.completed ? 'Choose another situation' : 'Save and leave drill'}
            variant={run.completed ? 'primary' : 'ghost'}
            disabled={!!busy}
            onPress={leave}
          />
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  content: { width: '100%', maxWidth: 960, alignSelf: 'center', gap: 13 },
  banner: {
    backgroundColor: midnight,
    borderRadius: 20,
    padding: 22,
    gap: 10,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  bannerWords: { flex: 1, gap: 7 },
  kicker: { color: '#B8DCFF', fontSize: 10, fontWeight: '800', letterSpacing: 1.8 },
  bannerTitle: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '700',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', web: 'Georgia' }),
  },
  bannerCaption: { color: '#E1EDFF', fontSize: 14, lineHeight: 20 },
  portrait: { width: 72, alignItems: 'center' },
  heroPet: { width: 64, height: 76, zIndex: 1 },
  ground: { width: 65, backgroundColor: '#45567D', height: 5, marginTop: -2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 },
  tile: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderColor: '#CFDEEC',
    borderWidth: 1,
  },
  tileScene: { width: '100%', aspectRatio: 1.85, backgroundColor: midnight },
  tileFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
    paddingVertical: 13,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  tileTitle: { color: colors.text, fontWeight: '800', fontSize: 16, flexShrink: 1 },
  pressed: { opacity: 0.77 },
  companion: {
    gap: 10,
    minHeight: 135,
    backgroundColor: '#E6F3FF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#C4D8E9',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
  },
  companionImage: { width: 74, height: 75 },
  back: { alignSelf: 'flex-start' },
  past: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    borderRadius: 14,
    gap: 12,
  },
  thumbnail: { width: 46, height: 46, borderRadius: 8 },
  grow: { flex: 1, gap: 3 },
  stage: { height: 195, overflow: 'hidden', borderRadius: 18, backgroundColor: midnight },
  stageTag: {
    alignSelf: 'flex-start',
    margin: 14,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: midnight,
    borderRadius: 4,
  },
  stagePet: { position: 'absolute', height: 83, width: 84, bottom: 11, left: 21 },
  progress: { height: 5, backgroundColor: '#DAE6F2', borderRadius: 4, overflow: 'hidden' },
  progressFill: { backgroundColor: colors.navy, height: 5 },
  story: { color: colors.text, fontSize: 23, lineHeight: 30, fontWeight: '700' },
  step: { marginTop: 5, color: colors.navy, fontSize: 13, fontWeight: '700' },
  choice: {
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 15,
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.baby,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  choiceLabel: { flex: 1, color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  results: { backgroundColor: midnight, borderRadius: 16, padding: 20, gap: 5 },
  score: { color: '#FFFFFF', fontSize: 43, fontWeight: '800' },
  scoreTotal: { color: '#BBCEEF', fontSize: 20, fontWeight: '500' },
});
