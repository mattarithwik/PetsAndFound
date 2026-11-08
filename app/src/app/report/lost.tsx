import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { LocationPicker } from '@/components/location-picker';
import { Button, Card, Chips, Empty, ErrorNote, Field, KeyValue, Loading, Muted, Notice, Screen, SectionTitle } from '@/components/ui';
import { agent, db } from '@/lib/api';
import { useDraft } from '@/lib/drafts';
import { dateTime, hoursAgo, publicArea, sinceOptions } from '@/lib/format';
import { useAction, useLive } from '@/lib/hooks';
import { uuid } from '@/lib/ids';
import type { Place } from '@/lib/location';
import { usePlace } from '@/lib/place';
import { useSession } from '@/lib/session';
import type { Pet } from '@/lib/types';

type Draft = {
  reportId: string;
  petId?: string;
  since: string;
  place?: Place;
  description: string;
  observedAt?: string;
  reviewing?: boolean;
};

const fresh = (): Draft => ({ reportId: `lost-${uuid()}`, since: '1', description: '' });

export default function LostReport() {
  const params = useLocalSearchParams<{ petId?: string }>();
  const { token } = useSession();
  const { place } = usePlace();
  const { draft, update, clear, storageError } = useDraft<Draft>('lost', fresh);
  const { busy, error, setError, run } = useAction();
  const pets = useLive(() => db.read<Pet[]>(token!, 'pets'), 'pets', 0, ['my_pets']);

  useEffect(() => {
    if (!draft || draft.reviewing) return;
    if (params.petId && draft.petId !== params.petId) update({ petId: params.petId });
    else if (!draft.petId && pets.data?.length === 1) update({ petId: pets.data[0].id });
    if (!draft.place && place) update({ place });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.reportId, params.petId, pets.data, place]);

  if (!draft || (pets.loading && !pets.data))
    return (
      <>
        <Stack.Screen options={{ title: 'Report a lost pet' }} />
        <Loading />
      </>
    );
  const pet = pets.data?.find((p) => p.id === draft.petId);

  if (pets.error && !pets.data)
    return <Screen><Stack.Screen options={{ title: 'Report a lost pet' }} /><ErrorNote error={pets.error} onRetry={pets.refresh} /></Screen>;
  if (pets.data && !pets.data.length)
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Report a lost pet' }} />
        <Empty title="Register your pet first" body="Lost reports are linked to a registered pet so PawSafe can compare its photos with found animals." />
        <Button label="Register a pet" onPress={() => router.replace('/pets/new')} />
      </Screen>
    );

  const review = () => {
    if (!pet) return setError('Choose which pet is missing.');
    if (!draft.place) return setError('Choose where your pet was last seen.');
    setError(undefined);
    update({ reviewing: true, observedAt: hoursAgo(draft.since) });
  };

  const submit = () =>
    run('submit', async () => {
      await db.call(token!, 'create_lost_report', {
        id: draft.reportId,
        idempotencyKey: draft.reportId,
        petId: draft.petId,
        latitude: draft.place!.latitude,
        longitude: draft.place!.longitude,
        observedAt: draft.observedAt,
        ...(draft.place!.city ? { generalLocation: draft.place!.city } : {}),
        ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
      });
      const reportId = draft.reportId;
      await clear();
      // The worker also queues matching; this just returns early results sooner.
      agent.post(token!, '/v1/matching/search', { reportId }).catch(() => undefined);
      router.replace(`/reports/${reportId}`);
    });

  if (draft.reviewing)
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Report a lost pet' }} />
        <SectionTitle>Review before publishing</SectionTitle>
        <Card>
          <KeyValue label="Pet" value={pet?.name} />
          <KeyValue label="Last seen" value={dateTime(draft.observedAt)} />
          <KeyValue label="Public area" value={publicArea(draft.place)} />
          <KeyValue label="Details" value={draft.description || 'None'} />
        </Card>
        <Notice title="What becomes public">
          Other users see only the species, report type, time and an approximate area (about 10 km). Your name, contact details, exact location and microchip stay private.
        </Notice>
        <Muted>After publishing, PawSafe compares {pet?.name}'s reference photos with found-animal reports, shelter listings and permitted public posts.</Muted>
        <ErrorNote error={error} />
        <Button label="Confirm and publish" icon="checkmark" onPress={submit} loading={busy === 'submit'} />
        <Button label="Edit" variant="ghost" onPress={() => update({ reviewing: false })} disabled={busy === 'submit'} />
      </Screen>
    );

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Report a lost pet' }} />
      <Chips label="Which pet is missing?" value={draft.petId} onChange={(petId) => update({ petId })} options={(pets.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />
      <Chips label="When were they last seen?" value={draft.since} onChange={(since) => update({ since })} options={sinceOptions} />
      <LocationPicker label="Where were they last seen?" value={draft.place} onChange={(p) => update({ place: p })} />
      <Field
        label="What happened?"
        value={draft.description}
        onChangeText={(description) => update({ description })}
        multiline
        placeholder="Ran off during the storm, wearing a red collar, scared of strangers"
      />
      <ErrorNote error={error} />
      {storageError ? <Notice tone="warning">{storageError}</Notice> : null}
      <Button label="Review report" icon="arrow-forward" onPress={review} />
    </Screen>
  );
}
