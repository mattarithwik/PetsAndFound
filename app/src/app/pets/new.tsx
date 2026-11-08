import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { PhotoSlot } from '@/components/photos';
import { Button, Chips, ErrorNote, Field, Muted, Notice, Row, Screen, SectionTitle, Toggle } from '@/components/ui';
import { db } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { uuid } from '@/lib/ids';
import { useSession } from '@/lib/session';
import { uploadPhoto, type PickedImage } from '@/lib/uploads';
import type { Angle, Species, UploadedPhoto } from '@/lib/types';

const angles: { angle: Angle; label: string }[] = [
  { angle: 'front', label: 'Front' },
  { angle: 'left', label: 'Left side' },
  { angle: 'right', label: 'Right side' },
  { angle: 'marking', label: 'Markings' },
];

export default function NewPet() {
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  const { token } = useSession();
  const [petId] = useState(() => `pet-${uuid()}`);
  const [form, setForm] = useState({ name: '', breed: '', age: '', colors: '', markings: '', microchip: '' });
  const [species, setSpecies] = useState<Species>('dog');
  const [size, setSize] = useState('');
  const [images, setImages] = useState<Partial<Record<Angle, PickedImage>>>({});
  const [uploaded, setUploaded] = useState<Partial<Record<Angle, UploadedPhoto & { attached?: boolean }>>>({});
  const [singleAnimal, setSingleAnimal] = useState(true);
  const [progress, setProgress] = useState<string>();
  const [registered, setRegistered] = useState(false);
  const { busy, error, setError, run } = useAction();
  const set = (key: keyof typeof form) => (value: string) => setForm({ ...form, [key]: value });

  const save = () =>
    run('save', async () => {
      if (!form.name.trim()) throw new Error("Enter your pet's name.");
      if (!images.front) throw new Error('Add at least a front photo so PawSafe can recognize your pet.');
      setProgress('Saving profile…');
      if (!registered) await db.call(token!, 'register_pet', {
        id: petId,
        name: form.name.trim(),
        species,
        ...(form.breed.trim() ? { breed: form.breed.trim() } : {}),
        ...(form.age.trim() ? { age: form.age.trim() } : {}),
        ...(size ? { size } : {}),
        colors: form.colors.split(',').map((c) => c.trim()).filter(Boolean).slice(0, 20),
        ...(form.markings.trim() ? { markings: form.markings.trim() } : {}),
        ...(form.microchip.trim() ? { microchip: form.microchip.trim() } : {}),
      });
      setRegistered(true);
      const done = { ...uploaded };
      for (const { angle, label } of angles) {
        const image = images[angle];
        if (!image) continue;
        if (!done[angle]) {
          setProgress(`Uploading ${label.toLowerCase()} photo…`);
          done[angle] = await uploadPhoto(token!, image);
          setUploaded({ ...done });
        }
        if (!done[angle]!.attached) {
          await db.call(token!, 'attach_pet_photo', {
            id: done[angle]!.id,
            petId,
            storageKey: done[angle]!.storageKey,
            angle,
            ...(singleAnimal ? { animalCount: 1 } : {}),
          });
          done[angle] = { ...done[angle]!, attached: true };
          setUploaded({ ...done });
        }
      }
      setProgress(undefined);
      if (onboarding) router.replace('/rescue');
      else router.replace(`/pets/${petId}`);
    }).finally(() => setProgress(undefined));

  return (
    <Screen bottomInset={60}>
      <Stack.Screen options={{ title: 'Register a pet' }} />
      {onboarding ? <Notice title="Register your first pet">Photos from several angles make image matching much more reliable. You can skip this and add pets later.</Notice> : null}
      <Field label="Pet name" value={form.name} onChangeText={set('name')} placeholder="Daisy" />
      <Chips
        label="Species"
        value={species}
        onChange={setSpecies}
        options={[
          { value: 'dog', label: 'Dog' },
          { value: 'cat', label: 'Cat' },
          { value: 'other', label: 'Other' },
        ]}
      />
      <Field label="Breed" value={form.breed} onChangeText={set('breed')} placeholder="Golden retriever mix" />
      <Field label="Approximate age" value={form.age} onChangeText={set('age')} placeholder="4 years" />
      <Chips
        label="Size"
        value={size}
        onChange={setSize}
        options={[
          { value: 'small', label: 'Small' },
          { value: 'medium', label: 'Medium' },
          { value: 'large', label: 'Large' },
        ]}
      />
      <Field label="Colors" value={form.colors} onChangeText={set('colors')} placeholder="gold, white" hint="Separate with commas." />
      <Field label="Distinctive markings" value={form.markings} onChangeText={set('markings')} multiline placeholder="White blaze on chest, notch in left ear, red collar" />
      <Field label="Microchip number" value={form.microchip} onChangeText={set('microchip')} hint="Private. Never shown in public search." autoCapitalize="characters" />

      <SectionTitle>Reference photos</SectionTitle>
      <Muted>Clear, well-lit photos of just this pet. The front photo is required; sides and markings improve matching.</Muted>
      <Row style={{ flexWrap: 'nowrap' }}>
        {angles.map(({ angle, label }) => (
          <PhotoSlot
            key={angle}
            label={label}
            image={images[angle]}
            onError={setError}
            onPick={(image) => {
              setImages({ ...images, [angle]: image });
              setUploaded((current) => ({ ...current, [angle]: undefined }));
            }}
          />
        ))}
      </Row>
      <Toggle label="Each photo shows only this pet" detail="Photos with several animals are held back from automatic matching." value={singleAnimal} onChange={setSingleAnimal} />

      <ErrorNote error={error} />
      {progress ? <Muted>{progress}</Muted> : null}
      <Button label="Save pet profile" icon="paw" onPress={save} loading={busy === 'save'} />
      {onboarding ? <Button label="Skip for now" variant="ghost" onPress={() => router.replace('/rescue')} /> : null}
    </Screen>
  );
}
