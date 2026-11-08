import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { LocationPicker } from '@/components/location-picker';
import { CameraAssist } from '@/components/camera-assist';
import { PhotoSlot } from '@/components/photos';
import { Button, Card, Chips, ErrorNote, Field, KeyValue, Loading, Muted, Notice, Row, Screen, SectionTitle, Toggle } from '@/components/ui';
import { agent, db } from '@/lib/api';
import { useDraft } from '@/lib/drafts';
import { conditions, dateTime, hoursAgo, publicArea, sinceOptions, speciesLabel } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { uuid } from '@/lib/ids';
import { feedback } from '@/lib/motion';
import type { Place } from '@/lib/location';
import { usePlace } from '@/lib/place';
import { useSession } from '@/lib/session';
import { uploadPhoto, type PickedImage } from '@/lib/uploads';
import type { Species, UploadedPhoto } from '@/lib/types';

type Draft = {
  reportId: string;
  species: Species;
  breed: string;
  colors: string;
  condition: string;
  since: string;
  place?: Place;
  description: string;
  singleAnimal: boolean;
  images: PickedImage[];
  uploaded: (UploadedPhoto | null)[];
  observedAt?: string;
  reviewing?: boolean;
  assessment?: { environment: string; visibleConcerns: string[]; uncertainty: string };
};

const fresh = (): Draft => ({
  reportId: `found-${uuid()}`,
  species: 'dog',
  breed: '',
  colors: '',
  condition: 'unknown',
  since: '0',
  description: '',
  singleAnimal: true,
  images: [],
  uploaded: [],
});

const urgent = ['injured', 'severe injury', 'trapped', 'immediate danger'];

export default function FoundReport() {
  const { token } = useSession();
  const params = useLocalSearchParams<{ condition?: string }>();
  const { place } = usePlace();
  const { draft, update, clear, storageError } = useDraft<Draft>('found', fresh);
  const { busy, error, setError, run } = useAction();
  const [progress, setProgress] = useState<string>();
  const [cameraOpen, setCameraOpen] = useState(false);

  useEffect(() => {
    if (draft && !draft.place && place && !draft.reviewing) update({ place });
    if (draft && !draft.reviewing && draft.condition === 'unknown' && params.condition === 'injured') update({ condition: 'injured' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.reportId, place, params.condition]);

  if (!draft)
    return (
      <>
        <Stack.Screen options={{ title: 'Report a found animal' }} />
        <Loading />
      </>
    );

  const setImage = (index: number, image: PickedImage) => {
    const images = [...draft.images];
    const uploaded = [...draft.uploaded];
    images[index] = image;
    uploaded[index] = null;
    update({ images, uploaded });
  };

  const review = () =>
    run('review', async () => {
      if (!draft.images.length && !urgent.includes(draft.condition)) throw new Error('Add a photo for matching, or select the reported urgent condition if a photo would be unsafe.');
      if (!draft.place) throw new Error('Choose where you found the animal.');
      const uploaded = [...draft.uploaded];
      for (const [i, image] of draft.images.entries()) {
        if (uploaded[i]) continue;
        setProgress(`Uploading photo ${i + 1} of ${draft.images.length}…`);
        uploaded[i] = await uploadPhoto(token!, image);
        update({ uploaded: [...uploaded] });
      }
      update({ uploaded, reviewing: true, observedAt: hoursAgo(draft.since) });
      feedback('success');
    }).finally(() => setProgress(undefined));

  const submit = () =>
    run('submit', async () => {
      const colors = draft.colors.split(',').map((c) => c.trim()).filter(Boolean);
      await db.call(token!, 'create_found_report', {
        id: draft.reportId,
        idempotencyKey: draft.reportId,
        species: draft.species,
        latitude: draft.place!.latitude,
        longitude: draft.place!.longitude,
        observedAt: draft.observedAt,
        condition: draft.condition,
        ...(draft.breed.trim() ? { breed: draft.breed.trim() } : {}),
        ...(colors.length ? { colors } : {}),
        ...(draft.place!.city ? { generalLocation: draft.place!.city } : {}),
        ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
        photos: draft.uploaded.filter(Boolean).map((p) => ({
          id: p!.id,
          storageKey: p!.storageKey,
          angle: 'other',
          ...(draft.singleAnimal ? { animalCount: 1 } : {}),
        })),
      });
      if (draft.assessment) await db.call(token!, 'save_scene_assessment', { reportId: draft.reportId, ...draft.assessment });
      feedback('success');
      const reportId = draft.reportId;
      await clear();
      agent.post(token!, '/v1/matching/search', { reportId }).catch(() => undefined);
      router.replace(`/reports/${reportId}`);
    });

  const guidance = (
    <Notice tone={urgent.includes(draft.condition) ? 'danger' : 'info'} title="Stay safe">
      {urgent.includes(draft.condition)
        ? "Don't put yourself in danger. Keep a safe distance from injured or frightened animals, and contact local animal control or emergency services if the animal or people nearby are at immediate risk."
        : 'Approach calmly and only if the animal seems relaxed. Offer water, avoid chasing it, and check for a collar or tag from a distance.'}
    </Notice>
  );

  if (draft.reviewing)
    return (
      <Screen key="review">
        <Stack.Screen options={{ title: 'Report a found animal' }} />
        <SectionTitle>Review before publishing</SectionTitle>
        {draft.images.length ? <Row style={{ flexWrap: 'nowrap' }}>
          {draft.images.map((img, i) => (
            <Image key={i} source={{ uri: img.uri }} style={local.preview} contentFit="cover" />
          ))}
        </Row> : null}
        <Card>
          <KeyValue label="Animal" value={[speciesLabel(draft.species), draft.breed, draft.colors].filter(Boolean).join(' · ')} />
          <KeyValue label="Condition" value={conditions.find((c) => c.value === draft.condition)?.label} />
          <KeyValue label="Found" value={dateTime(draft.observedAt)} />
          <KeyValue label="Public area" value={publicArea(draft.place)} />
          <KeyValue label="Notes" value={draft.description || 'None'} />
          {draft.assessment ? <KeyValue label="Scene assist" value={draft.assessment.environment} /> : null}
        </Card>
        <Notice title="What happens next">
          {draft.images.length
            ? 'Verified shelters can accept this case. PawSafe will compare the photos with registered lost pets.'
            : 'Verified shelters can accept this case. There are no photos to compare for a visual match.'}
        </Notice>
        {guidance}
        <ErrorNote error={error} />
        <Button label="Confirm and publish" icon="checkmark" onPress={submit} loading={busy === 'submit'} />
        <Button label="Edit" variant="ghost" onPress={() => update({ reviewing: false })} disabled={busy === 'submit'} />
      </Screen>
    );

  return (
    <Screen key="form">
      <Stack.Screen options={{ title: 'Report a found animal' }} />
      <Chips label="Condition" value={draft.condition} onChange={(condition) => update({ condition })} options={conditions} />
      {guidance}
      <SectionTitle>Photos</SectionTitle>
      <Button label={cameraOpen ? 'Close scene assist' : 'Open scene assist'} variant="outline" icon="camera-outline" onPress={() => setCameraOpen(!cameraOpen)} />
      {cameraOpen ? <CameraAssist condition={draft.condition} onPhoto={(image) => setImage(0, image)} onAssessment={(assessment) => update({ assessment: { environment: assessment.environment, visibleConcerns: assessment.visibleConcerns, uncertainty: assessment.uncertainty } })} /> : null}
      <Muted>Add up to three photos of the animal and its markings. You can report an injured or endangered animal without a photo.</Muted>
      <Row style={{ flexWrap: 'nowrap' }}>
        {[0, 1, 2].map((i) => (
          <PhotoSlot key={i} label={i === 0 ? 'Animal' : i === 1 ? 'Another angle' : 'Collar / marks'} image={draft.images[i]} onPick={(img) => setImage(Math.min(i, draft.images.length), img)} onError={setError} />
        ))}
      </Row>
      {draft.images.length ? <Button label="Remove last photo" compact variant="ghost" disabled={!!busy} onPress={() => update({ images: draft.images.slice(0, -1), uploaded: draft.uploaded.slice(0, -1) })} /> : null}
      {draft.images.length ? <Toggle label="Photos show only this animal" value={draft.singleAnimal} onChange={(singleAnimal) => update({ singleAnimal })} /> : null}
      <Chips
        label="Species"
        value={draft.species}
        onChange={(species) => update({ species })}
        options={[
          { value: 'dog', label: 'Dog' },
          { value: 'cat', label: 'Cat' },
          { value: 'other', label: 'Other' },
        ]}
      />
      <View style={local.pair}>
        <View style={local.half}>
          <Field label="Breed (if known)" value={draft.breed} onChangeText={(breed) => update({ breed })} placeholder="Lab mix" />
        </View>
        <View style={local.half}>
          <Field label="Colors" value={draft.colors} onChangeText={(colors) => update({ colors })} placeholder="black, white" />
        </View>
      </View>
      <Chips label="When did you find them?" value={draft.since} onChange={(since) => update({ since })} options={sinceOptions} />
      <LocationPicker label="Where did you find them?" value={draft.place} onChange={(p) => update({ place: p })} />
      <Field label="Notes for responders" value={draft.description} onChangeText={(description) => update({ description })} multiline placeholder="Friendly, limping on back leg, near the park entrance" />
      <ErrorNote error={error} />
      {storageError ? <Notice tone="warning">{storageError}</Notice> : null}
      {progress ? <Muted>{progress}</Muted> : null}
      <Button label="Review report" icon="arrow-forward" onPress={review} loading={busy === 'review'} />
    </Screen>
  );
}

const local = StyleSheet.create({
  preview: { flex: 1, aspectRatio: 1, borderRadius: 14 },
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  half: { flex: 1, minWidth: 140 },
});
