import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { Badge, Body, Button, Card, Chips, Empty, ErrorNote, Field, KeyValue, Muted, Notice, Screen, SectionTitle, Title } from '@/components/ui';
import { db } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useAction, useLive } from '@/lib/hooks';
import { uuid } from '@/lib/ids';
import { feedback } from '@/lib/motion';
import { useSession } from '@/lib/session';
import { useShelter } from '@/lib/shelter';
import type { RescueCase, ShelterAnimal, ShelterResources, Species } from '@/lib/types';

export default function Registry() {
  const { token } = useSession();
  const { active, verified } = useShelter();
  const shelterId = active?.shelterId ?? '';
  const [species, setSpecies] = useState<Species>('dog');
  const [description, setDescription] = useState('');
  const [caseId, setCaseId] = useState('');
  const [added, setAdded] = useState(false);
  const [supported, setSupported] = useState('dog, cat');
  const [supplies, setSupplies] = useState('');
  const [food, setFood] = useState('0');
  const [crates, setCrates] = useState('0');
  const [kits, setKits] = useState('0');
  const { busy, error, run } = useAction();
  const data = useLive(async () => {
    if (!verified) return { animals: [] as ShelterAnimal[], resources: null as ShelterResources | null, cases: [] as RescueCase[] };
    const [animals, resources, cases] = await Promise.all([
      db.read<ShelterAnimal[]>(token!, 'shelter_animals', shelterId),
      db.read<ShelterResources | null>(token!, 'shelter_resources', shelterId),
      db.read<RescueCase[]>(token!, 'cases'),
    ]);
    return { animals, resources, cases: cases.filter((c) => c.shelterId === shelterId) };
  }, `registry:${shelterId}:${verified}`, 5000);
  const resources = data.data?.resources;
  const loadedResources = useRef('');
  useEffect(() => {
    if (!resources) return;
    const revision = `${resources.shelterId}:${resources.updatedAt}`;
    if (loadedResources.current === revision) return;
    loadedResources.current = revision;
    setSupported(resources.species); setSupplies(resources.supplies);
    setFood(String(resources.foodUnits)); setCrates(String(resources.crates)); setKits(String(resources.medicalKits));
  }, [resources]);
  const saveResources = () => run('resources', async () => {
    const values = [food, crates, kits].map(Number);
    if (values.some((v) => !Number.isInteger(v) || v < 0 || v > 100000)) throw new Error('Use whole numbers from 0 to 100,000 for supplies.');
    await db.call(token!, 'update_shelter_resources', {
      shelterId, species: supported, supplies, foodUnits: values[0], crates: values[1], medicalKits: values[2],
    });
    await data.refresh();
    feedback('success');
  });
  const addAnimal = () => run('animal', async () => {
    if (!description.trim()) throw new Error('Describe the animal.');
    setAdded(false);
    await db.call(token!, 'register_shelter_animal', {
      id: `animal-${uuid()}`, shelterId, species, description: description.trim(), ...(caseId ? { caseId } : {}),
    });
    setDescription(''); setCaseId('');
    await data.refresh();
    setAdded(true);
    feedback('success');
  });
  const animals = data.data?.animals ?? [];
  const inCare = animals.filter((animal) => animal.status === 'in_care').sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt));
  const departed = animals.filter((animal) => animal.status !== 'in_care').sort((a, b) => b.departedAt.localeCompare(a.departedAt));
  return <Screen onRefresh={data.refresh}>
    <Stack.Screen options={{ title: 'Shelter registry' }} />
    <Title>Animals in our care</Title>
    {!verified ? <Notice tone="warning">Verified shelter staff can update this registry.</Notice> : <>
      <Muted>{active?.shelter?.name}</Muted>
      <ErrorNote error={error ?? data.error} onRetry={data.refresh} />
      <SectionTitle>Add an animal</SectionTitle>
      <Muted>Record an animal currently in your shelter. You can link a rescue case if one exists.</Muted>
      <Chips label="Species" value={species} onChange={setSpecies} options={[{ value: 'dog', label: 'Dog' }, { value: 'cat', label: 'Cat' }, { value: 'other', label: 'Other' }]} />
      <Field label="Description" value={description} onChangeText={(value) => { setDescription(value); setAdded(false); }} multiline maxLength={1000} placeholder="Appearance, collar, identifying details" />
      <Chips label="Linked case (optional)" value={caseId} onChange={setCaseId} options={[{ value: '', label: 'None' }, ...(data.data?.cases ?? []).map((c) => ({ value: c.id, label: c.id.slice(0, 12) }))]} />
      <Button label="Add animal to shelter database" onPress={addAnimal} loading={busy === 'animal'} />
      {added ? <Notice tone="success">Animal added to your shelter's records.</Notice> : null}
      <SectionTitle>Currently in care ({inCare.length})</SectionTitle>
      {data.data && !inCare.length ? <Empty title="No animals currently in care" /> : null}
      {inCare.map((animal) => <Card key={animal.id}>
        <Body>{animal.description}</Body>
        <Muted>{animal.species} · arrived {dateTime(animal.arrivedAt)}</Muted>
        {animal.caseId ? <Muted>Case {animal.caseId}</Muted> : null}
        <Button label="Mark reunited" variant="outline" compact onPress={() => run(`discharge-${animal.id}`, async () => {
          await db.call(token!, 'discharge_shelter_animal', { id: animal.id, status: 'reunited', outcome: 'Reunited with owner' });
          await data.refresh();
          feedback('success');
        })} />
      </Card>)}
      {departed.length ? <SectionTitle>Past animals ({departed.length})</SectionTitle> : null}
      {departed.map((animal) => <Card key={animal.id}>
        <Badge label={animal.status.replace('_', ' ')} />
        <Body>{animal.description}</Body>
        <Muted>{animal.species} · departed {dateTime(animal.departedAt)}</Muted>
      </Card>)}
      <SectionTitle>Intake resources</SectionTitle>
      {resources ? <Card>
        <KeyValue label="Food units" value={String(resources.foodUnits)} />
        <KeyValue label="Crates" value={String(resources.crates)} />
        <KeyValue label="Medical kits" value={String(resources.medicalKits)} />
        <KeyValue label="Species" value={resources.species || 'Unspecified'} />
        <Muted>Updated {dateTime(resources.updatedAt)}. Counts are used in response recommendations.</Muted>
      </Card> : <Notice tone="warning">Publish resources before your shelter can be recommended for incident intake.</Notice>}
      <Field label="Species accepted (comma separated)" value={supported} onChangeText={setSupported} placeholder="dog, cat, other" />
      <Field label="Food units available" value={food} onChangeText={setFood} keyboardType="numeric" />
      <Field label="Crates available" value={crates} onChangeText={setCrates} keyboardType="numeric" />
      <Field label="Medical kits available" value={kits} onChangeText={setKits} keyboardType="numeric" />
      <Field label="Other supplies" value={supplies} onChangeText={setSupplies} multiline maxLength={1000} />
      <Button label="Publish resources" loading={busy === 'resources'} onPress={saveResources} />
    </>}
  </Screen>;
}
