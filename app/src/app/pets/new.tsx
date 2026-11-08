import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PetFields, petForm, petPayload, photoAngles } from '@/components/pet-fields';
import { PhotoSlot } from '@/components/photos';
import { Button, Card, ErrorNote, Muted, Screen, SectionTitle, Toggle } from '@/components/ui';
import { db } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { uuid } from '@/lib/ids';
import { feedback } from '@/lib/motion';
import { useSession } from '@/lib/session';
import type { Angle, UploadedPhoto } from '@/lib/types';
import { uploadPhoto, type PickedImage } from '@/lib/uploads';

export default function NewPet() {
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  const { token } = useSession();
  const [petId] = useState(() => `pet-${uuid()}`);
  const [form, setForm] = useState(() => petForm());
  const [images, setImages] = useState<Partial<Record<Angle, PickedImage>>>({});
  const [uploaded, setUploaded] = useState<Partial<Record<Angle, UploadedPhoto>>>({});
  const [singleAnimal, setSingleAnimal] = useState(true);
  const [progress, setProgress] = useState('');
  const { busy, error, setError, run } = useAction();

  const save = (detailsOnly = false) => run('save', async () => {
    const details = petPayload(form);
    const photos = [];
    for (const { angle, label } of detailsOnly ? [] : photoAngles) {
      const image = images[angle];
      if (!image) continue;
      let result = uploaded[angle];
      if (!result) {
        setProgress(`Uploading ${label.toLowerCase()} photo…`);
        result = await uploadPhoto(token!, image);
        setUploaded((current) => ({ ...current, [angle]: result }));
      }
      photos.push({ id: result.id, storageKey: result.storageKey, angle, ...(singleAnimal ? { animalCount: 1 } : {}) });
    }
    setProgress('Saving pet profile…');
    await db.call(token!, 'register_pet', { id: petId, ...details, photos });
    feedback('success');
    if (onboarding) router.replace('/rescue');
    else router.replace(`/pets/${petId}`);
  }).finally(() => setProgress(''));

  return (
    <Screen bottomInset={64}>
      <Stack.Screen options={{ title: 'Register a pet' }} />
      <View pointerEvents={busy ? 'none' : 'auto'} style={local.form}>
        <Card>
          <PetFields form={form} onChange={setForm} />
        </Card>
        <SectionTitle>Pet photos</SectionTitle>
        <Muted>Start with a front view. Add each side and a close-up of any distinctive markings. You can add photos later from the profile.</Muted>
        <View style={local.grid}>
          {photoAngles.map(({ angle, label }) => (
            <PhotoSlot key={angle} label={label} image={images[angle]} onError={setError} style={local.slot}
              onPick={(image) => {
                setImages((current) => ({ ...current, [angle]: image }));
                setUploaded((current) => ({ ...current, [angle]: undefined }));
              }} />
          ))}
        </View>
        <Toggle label="Each photo shows only this pet" detail="Images with multiple animals need review before matching." value={singleAnimal} onChange={setSingleAnimal} />
      </View>
      <ErrorNote error={error} />
      {progress ? <Muted>{progress}</Muted> : null}
      <Button label="Save pet profile" icon="paw" onPress={() => save()} loading={!!busy} />
      {error && Object.keys(images).length > 0 ? <Button label="Save details without photos" variant="outline" disabled={!!busy} onPress={() => save(true)} /> : null}
      {onboarding ? <Button label="Skip for now" variant="ghost" disabled={!!busy} onPress={() => router.replace('/rescue')} /> : null}
    </Screen>
  );
}
const local = StyleSheet.create({
  form: { gap: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  slot: { minWidth: 100, maxWidth: 180, flexBasis: '38%' },
});
