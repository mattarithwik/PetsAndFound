import { Redirect, router } from 'expo-router';
import { useState } from 'react';

import { LocationPicker } from '@/components/location-picker';
import { Button, Card, ErrorNote, Field, Hero, Muted, Screen } from '@/components/ui';
import { useAction } from '@/lib/hooks';
import type { Place } from '@/lib/location';
import { usePlace } from '@/lib/place';
import { useSession } from '@/lib/session';

export default function OwnerOnboarding() {
  const { createAccount, profile } = useSession();
  const { place, setPlace } = usePlace();
  const [choosingArea, setChoosingArea] = useState(false);
  const [selectedArea, setSelectedArea] = useState<Place>();
  const [name, setName] = useState(profile?.name ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [contact, setContact] = useState(profile?.contactPreferences ?? '');
  const [emergency, setEmergency] = useState(profile?.emergencyContact ?? '');
  const { busy, error, run } = useAction();

  const submit = () =>
    run('save', async () => {
      if (!name.trim()) throw new Error('Enter your name.');
      const input = {
        name,
        generalLocation: selectedArea ? selectedArea.city : profile?.generalLocation,
        contactPreferences: contact,
        emergencyContact: emergency,
      };
      if (selectedArea) setPlace(selectedArea);
      await createAccount('owner', input, username, password);
      router.replace('/pets/new?onboarding=1');
    });

  if (profile && !busy) return <Redirect href="/" />;
  return (
    <Screen edges={['top']}>
      <Hero title="Your owner profile" subtitle="Start with your name. You can add your home area and contacts now or later." />
      <Field label="Your name" value={name} onChangeText={setName} placeholder="Jordan Lee" autoComplete="name" maxLength={120} />
      <Field label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} placeholder="jordan" maxLength={32} hint="At least 3 letters or numbers; dots, dashes and underscores are okay." />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="At least 8 characters" maxLength={128} />
      <Card>
        {choosingArea ? <>
          <LocationPicker label="Home area (optional)" value={selectedArea ?? place} onChange={(next) => { setSelectedArea(next); setChoosingArea(false); }} />
          <Button label="Skip location lookup" variant="ghost" compact onPress={() => setChoosingArea(false)} />
        </> : <>
          <Muted>{selectedArea ? selectedArea.city ? `Home city · ${selectedArea.city}` : 'Coordinates selected for local alerts.' : 'Home area is optional.'}</Muted>
          <Button label={selectedArea ? 'Change home area' : 'Add a home area'} variant="outline" compact icon="location-outline" onPress={() => setChoosingArea(true)} />
          {selectedArea ? <Button label="Remove selected area" compact variant="ghost" onPress={() => setSelectedArea(undefined)} /> : null}
        </>}
        <Muted>Only the city goes on your account. PawSafe saves the selected point on this device for nearby searches.</Muted>
      </Card>
      <Field
        label="Contact preference (optional)"
        value={contact}
        onChangeText={setContact}
        placeholder="In-app messages only, or text after 6pm"
        hint="Private contact details for your account."
        maxLength={240}
      />
      <Field label="Emergency contact (optional)" value={emergency} onChangeText={setEmergency} placeholder="Name and phone" maxLength={240} />
      <ErrorNote error={error} />
      <Button label="Continue" icon="arrow-forward" onPress={submit} loading={busy === 'save'} />
      <Button label="Back" variant="ghost" disabled={!!busy} onPress={() => router.canGoBack() ? router.back() : router.replace('/welcome')} />
    </Screen>
  );
}
