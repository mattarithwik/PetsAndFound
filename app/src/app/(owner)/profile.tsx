import { router } from 'expo-router';
import { useState } from 'react';

import { PetCover, PetPassport } from '@/components/pet-passport';
import { Badge, Button, Card, Chips, ErrorNote, ListRow, Loading, Screen, SectionTitle } from '@/components/ui';
import { db } from '@/lib/api';
import { useLive } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { Pet } from '@/lib/types';

export default function Profile() {
  const { token, profile, unread, setRole, signOut } = useSession();
  const [selected, setSelected] = useState('');
  const pets = useLive(() => db.read<Pet[]>(token!, 'pets'), `pets:${profile?.id}`, 0, ['my_pets']);
  const active = pets.data?.find((pet) => pet.id === selected) ?? pets.data?.[0];

  return (
    <Screen edges={['top']} bottomInset={120}>
      <SectionTitle action={<Button label="Add pet" icon="add" compact onPress={() => router.push('/pets/new')} />}>My pets</SectionTitle>
      {pets.loading && !pets.data ? <Loading /> : null}
      <ErrorNote error={pets.error} onRetry={pets.refresh} />
      {pets.data && !pets.data.length ? <>
        <PetCover />
        <Button label="Register your first pet" icon="paw" onPress={() => router.push('/pets/new')} />
      </> : null}
      {pets.data && pets.data.length > 1 ? <Chips label="Choose a pet" options={pets.data.map((pet) => ({ value: pet.id, label: pet.name }))} value={active?.id} onChange={setSelected} /> : null}
      {active ? <PetPassport key={active.id} id={active.id} onSaved={pets.refresh} /> : null}
      <SectionTitle>My account</SectionTitle>
      <Card>
        <ListRow icon="person-outline" title={profile?.name || 'Account settings'} detail="Edit your home area and emergency contacts" onPress={() => router.push('/account')} />
        <ListRow icon="notifications-outline" title="Notifications" detail="Matches, case updates and official warnings" right={unread ? <Badge label={`${unread} new`} /> : undefined} onPress={() => router.push('/notifications')} />
        <ListRow icon="business-outline" title="Switch to ShelterDash" detail="For shelter staff and responders" onPress={async () => {
          await setRole('shelter');
          router.replace('/dashboard');
        }} />
        <ListRow icon="log-out-outline" title="Sign out" detail="Save your account key first if you want to sign in again" onPress={async () => {
          await signOut();
          router.replace('/welcome');
        }} />
      </Card>
    </Screen>
  );
}
