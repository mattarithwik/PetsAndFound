import { router } from 'expo-router';
import { useState } from 'react';

import { LocationPicker } from '@/components/location-picker';
import { Button, ErrorNote, Field, Hero, Muted, Screen } from '@/components/ui';
import { useAction } from '@/lib/hooks';
import { usePlace } from '@/lib/place';
import { useSession } from '@/lib/session';

export default function OwnerOnboarding() {
  const { createAccount, saveProfile, token, profile } = useSession();
  const { place, setPlace } = usePlace();
  const [name, setName] = useState(profile?.name ?? '');
  const [contact, setContact] = useState(profile?.contactPreferences ?? '');
  const [emergency, setEmergency] = useState(profile?.emergencyContact ?? '');
  const { busy, error, run } = useAction();

  const submit = () =>
    run('save', async () => {
      if (!name.trim()) throw new Error('Enter your name.');
      const input = {
        name,
        generalLocation: place?.city ?? place?.label,
        contactPreferences: contact,
        emergencyContact: emergency,
      };
      if (token) await saveProfile(input);
      else await createAccount('owner', input);
      router.replace('/pets/new?onboarding=1');
    });

  return (
    <Screen edges={['top']}>
      <Hero title="Welcome to PawSafe" subtitle="Set up your owner profile. Your exact address and contact details are never shown publicly." />
      <Field label="Your name" value={name} onChangeText={setName} placeholder="Jordan Lee" autoComplete="name" />
      <LocationPicker label="Home area" value={place} onChange={setPlace} />
      <Muted>We only store your general area (city) on your profile. It's used for nearby alerts and searches.</Muted>
      <Field
        label="How should responders reach you?"
        value={contact}
        onChangeText={setContact}
        placeholder="In-app messages only, or text after 6pm"
        hint="Optional and private. Shared only through authorized workflows."
      />
      <Field label="Emergency contact" value={emergency} onChangeText={setEmergency} placeholder="Name and phone" hint="Optional and private." />
      <ErrorNote error={error} />
      <Button label="Continue" icon="arrow-forward" onPress={submit} loading={busy === 'save'} />
      {!token ? <Button label="Back" variant="ghost" onPress={() => router.back()} /> : null}
    </Screen>
  );
}
