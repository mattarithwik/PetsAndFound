import { View } from 'react-native';

import { Chips, Field, SectionTitle } from '@/components/ui';
import type { Angle, Pet, Species } from '@/lib/types';

export const photoAngles: { angle: Angle; label: string }[] = [
  { angle: 'front', label: 'Front' },
  { angle: 'left', label: 'Left side' },
  { angle: 'right', label: 'Right side' },
  { angle: 'marking', label: 'Markings' },
];

export function petForm(pet?: Pet) {
  return {
    name: pet?.name ?? '',
    species: pet?.species ?? 'dog' as Species,
    breed: pet?.breed ?? '',
    age: pet?.age ?? '',
    size: pet?.size ?? '',
    colors: pet?.colors.join(', ') ?? '',
    markings: pet?.markings ?? '',
    microchip: pet?.microchip ?? '',
    healthNotes: pet?.healthNotes ?? '',
  };
}
export type PetForm = ReturnType<typeof petForm>;

export function petPayload(form: PetForm) {
  if (!form.name.trim()) throw new Error("Enter your pet’s name.");
  const colors = form.colors.split(',').map((color) => color.trim()).filter(Boolean);
  if (colors.length > 20 || colors.some((color) => color.length > 100)) {
    throw new Error('Use up to 20 colors, with at most 100 characters per color.');
  }
  return { ...form, name: form.name.trim(), colors };
}

export function PetFields({ form, onChange }: { form: PetForm; onChange: (form: PetForm) => void }) {
  const set = <K extends keyof PetForm>(key: K) => (value: PetForm[K]) => onChange({ ...form, [key]: value });
  return (
    <View style={{ gap: 13 }}>
      <Field label="Pet name" value={form.name} onChangeText={set('name')} placeholder="Daisy" maxLength={120} />
      <Chips label="Species" value={form.species} onChange={set('species')} options={[
        { value: 'dog', label: 'Dog' }, { value: 'cat', label: 'Cat' }, { value: 'other', label: 'Other' },
      ]} />
      <Field label="Breed" value={form.breed} onChangeText={set('breed')} placeholder="Breed or mix" maxLength={120} />
      <Field label="Approximate age" value={form.age} onChangeText={set('age')} placeholder="4 years" maxLength={60} />
      <Chips label="Size" value={form.size} onChange={set('size')} options={[
        { value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' },
      ]} />
      <Field label="Coat or body colors" value={form.colors} onChangeText={set('colors')} placeholder="Gold, white" hint="Separate colors with commas." />
      <Field label="Identifying features" value={form.markings} onChangeText={set('markings')} multiline placeholder="White chest patch, notched left ear…" maxLength={500} />
      <SectionTitle>Private details</SectionTitle>
      <Field label="Microchip number" value={form.microchip} onChangeText={set('microchip')} maxLength={120} autoCapitalize="characters" />
      <Field label="Health conditions and care notes" value={form.healthNotes} onChangeText={set('healthNotes')} multiline maxLength={1000} placeholder="Medications, allergies or special handling" hint="Only you can view these details in your pet’s profile." />
    </View>
  );
}
