import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge, Body, Button, Card, ErrorNote, Hero, Loading, Muted, Notice, Row, Screen, SectionTitle, SourceLink, SourceTag, Stat, Strong, colors } from '@/components/ui';
import { agent, db } from '@/lib/api';
import { capitalize } from '@/lib/format';
import { useAction, useLive } from '@/lib/hooks';
import { uuid } from '@/lib/ids';
import { useSession } from '@/lib/session';
import type { Hazard, ScenarioSummary, SimulationState } from '@/lib/types';

const art: Record<Hazard, string> = { tornado: '🌪️', flood: '🌊', wildfire: '🔥', heat: '☀️' };

type Feedback = { score: number; feedback: string; source: string };
type PastRun = { id: string; scenarioId: Hazard; score: number; revision: number };

export default function Simulation() {
  const { token } = useSession();
  const [run, setRun] = useState<SimulationState>();
  const [lastFeedback, setLastFeedback] = useState<string>();
  const [explanation, setExplanation] = useState<Feedback>();
  const [pendingChoice, setPendingChoice] = useState<string>();
  const { busy, error, run: act, setError } = useAction();

  const scenarios = useLive(() => agent.get<ScenarioSummary[]>(token!, '/v1/scenarios'), 'scenarios');
  const past = useLive(() => db.read<PastRun[]>(token!, 'simulation_runs'), `past:${run?.completed}`);

  const start = (scenarioId: Hazard) =>
    act('start', async () => {
      setExplanation(undefined);
      setLastFeedback(undefined);
      setRun(await agent.post<SimulationState>(token!, '/v1/simulations', { id: uuid(), scenarioId }));
    });

  const resume = (id: string) =>
    act('start', async () => {
      setExplanation(undefined);
      setLastFeedback(undefined);
      setRun(await agent.get<SimulationState>(token!, `/v1/simulations/${id}`));
    });

  const choose = (choiceId: string) =>
    act('choose', async () => {
      if (!run) return;
      setPendingChoice(choiceId);
      try {
        const next = await agent.post<SimulationState>(token!, `/v1/simulations/${run.id}/choices`, { choiceId, revision: run.revision });
        setLastFeedback(next.history[next.history.length - 1]?.feedback);
        setRun(next);
      } catch (e) {
        // Another device advanced this run; reload the authoritative scene.
        if (String(e).includes('advanced')) setRun(await agent.get<SimulationState>(token!, `/v1/simulations/${run.id}`));
        throw e;
      } finally {
        setPendingChoice(undefined);
      }
    });

  const explain = () =>
    act('feedback', async () => {
      if (run) setExplanation(await agent.post<Feedback>(token!, `/v1/simulations/${run.id}/feedback`, {}));
    });

  return (
    <Screen edges={['top']} bottomInset={156}>
      <Hero title="Ready, pet hero?" subtitle="Practice disaster decisions in fictional scenarios and learn what keeps pets safe." />
      <Notice tone="sim" title="Simulation" icon="game-controller">
        These scenarios are fictional training exercises. They are not real or active emergencies.
      </Notice>

      {!run ? (
        <>
          <SectionTitle>Choose a scenario</SectionTitle>
          {scenarios.loading && !scenarios.data ? <Loading /> : null}
          <ErrorNote error={scenarios.error ?? error} onRetry={scenarios.refresh} />
          <View style={local.grid}>
            {scenarios.data?.map((s) => (
              <Pressable
                key={s.id}
                accessibilityRole="button"
                accessibilityLabel={`${capitalize(s.id)}. ${s.title}`}
                onPress={() => start(s.id)}
                disabled={!!busy}
                style={({ pressed }) => [local.tile, pressed && { opacity: 0.8 }]}>
                <Text style={local.art}>{art[s.id]}</Text>
                <Text style={local.tileTitle}>{capitalize(s.id)}</Text>
                <Text style={local.tileDetail}>{s.title}</Text>
              </Pressable>
            ))}
          </View>
          {busy === 'start' ? <Loading label="Starting…" /> : null}
          {past.data?.length ? (
            <>
              <SectionTitle>Your past runs</SectionTitle>
              {past.data
                .slice()
                .reverse()
                .slice(0, 6)
                .map((p) => (
                  <Card key={p.id} onPress={() => resume(p.id)}>
                    <Row>
                      <Text style={local.small}>{art[p.scenarioId]}</Text>
                      <Strong>{capitalize(p.scenarioId)}</Strong>
                      <Badge label={p.revision >= 3 ? `Score ${Math.round(p.score)}` : 'In progress'} tone={p.revision >= 3 ? 'success' : 'neutral'} />
                    </Row>
                  </Card>
                ))}
            </>
          ) : null}
        </>
      ) : (
        <>
          <Row>
            <SourceTag kind="simulation" />
            <Badge label={run.title} tone="neutral" />
          </Row>
          {lastFeedback ? (
            <Card tone="info">
              <Muted>What happened</Muted>
              <Body>{lastFeedback}</Body>
            </Card>
          ) : null}
          {run.scene ? (
            <Card>
              <Muted>Scene {run.history.length + 1}</Muted>
              <Text style={local.story}>
                {art[run.scenarioId]} {run.scene.title}
              </Text>
              {run.scene.choices.map((c) => (
                <Button key={c.id} label={c.label} variant="outline" onPress={() => choose(c.id)} loading={pendingChoice === c.id} disabled={!!busy} style={local.choice} />
              ))}
            </Card>
          ) : (
            <>
              <SectionTitle>Your result</SectionTitle>
              <Row>
                <Stat label="Overall score" value={run.score} />
                <Stat label="Pet safety" value={run.metrics.petSafety} tone="success" />
              </Row>
              <Row>
                <Stat label="Preparedness" value={run.metrics.preparedness} tone="warning" />
                <Stat label="Decision quality" value={run.metrics.decisionQuality} tone="sim" />
              </Row>
              <Muted>Score = 50% pet safety + 30% preparedness + 20% decision quality. These are game-design weights, not risk estimates.</Muted>
              <Card>
                <Strong>Your choices</Strong>
                {run.history.map((h, i) => (
                  <View key={i} style={local.history}>
                    <Body>
                      {i + 1}. {h.label}
                    </Body>
                    <Muted>{h.feedback}</Muted>
                  </View>
                ))}
                <SourceLink url={run.source} label="Official safety guidance" />
              </Card>
              {explanation ? (
                <Card tone="sim">
                  <Row>
                    <SourceTag kind="ai" />
                    <Strong>Pawtricia's debrief</Strong>
                  </Row>
                  <Body>{explanation.feedback}</Body>
                </Card>
              ) : (
                <Button label="Explain my results" icon="sparkles-outline" variant="outline" onPress={explain} loading={busy === 'feedback'} />
              )}
            </>
          )}
          <ErrorNote error={error} />
          <Button
            label={run.completed ? 'Try another scenario' : 'Leave scenario'}
            variant="ghost"
            onPress={() => {
              setRun(undefined);
              setError(undefined);
              past.refresh();
            }}
          />
        </>
      )}
    </Screen>
  );
}

const local = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '47%', flexGrow: 1, backgroundColor: colors.white, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 4 },
  art: { fontSize: 34 },
  small: { fontSize: 20 },
  tileTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  tileDetail: { fontSize: 13, color: colors.muted },
  story: { fontSize: 18, fontWeight: '700', lineHeight: 25, color: colors.text, marginBottom: 6 },
  history: { gap: 2, paddingVertical: 4 },
  choice: { paddingRight: 56 },
});
