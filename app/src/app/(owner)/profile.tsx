import { router } from 'expo-router';

import { PetCard } from '@/components/cards';
import { Badge, Button, Card, Empty, ErrorNote, Hero, ListRow, Loading, Screen, SectionTitle } from '@/components/ui';
import { db } from '@/lib/api';
import { useLive } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { Pet, Photo } from '@/lib/types';

export default function Profile() {
  const { token, profile, unread, setRole, signOut } = useSession();
  const pets = useLive(async () => {
    const rows = await db.read<Pet[]>(token!, 'pets');
    const photos = await Promise.all(rows.map((p) => db.read<Photo[]>(token!, 'pet_photos', p.id)));
    return rows.map((pet, i) => ({ pet, photos: photos[i] }));
  }, 'pets');

  return (
    <Screen edges={['top']} bottomInset={156}>
      <Hero title={profile?.name ?? 'Profile'} subtitle={profile?.generalLocation || 'Home area not set'} />

      <SectionTitle action={<Button label="Add pet" icon="add" compact onPress={() => router.push('/pets/new')} />}>Your pets</SectionTitle>
      {pets.loading && !pets.data ? <Loading /> : null}
      <ErrorNote error={pets.error} onRetry={pets.refresh} />
      {pets.data && !pets.data.length ? (
        <Empty title="No pets registered yet" body="Register your pets with photos from several angles so PawSafe can match them if they're ever lost." />
      ) : null}
      {pets.data?.map(({ pet, photos }) => (
        <PetCard key={pet.id} pet={pet} photoId={(photos.find((p) => p.angle === 'front') ?? photos[0])?.id} />
      ))}

      <SectionTitle>Account</SectionTitle>
      <Card>
        <ListRow icon="notifications-outline" title="Notifications" detail="Match alerts, case updates and official warnings" right={unread ? <Badge label={`${unread} new`} tone="danger" /> : undefined} onPress={() => router.push('/notifications')} />
        <ListRow icon="person-outline" title="Profile and contact preferences" detail="Name, home area, emergency contact" onPress={() => router.push('/account')} />
        <ListRow
          icon="business-outline"
          title="Switch to ShelterDash"
          detail="For shelter staff and responders"
          onPress={async () => {
            await setRole('shelter');
            router.replace('/dashboard');
          }}
        />
        <ListRow
          icon="log-out-outline"
          title="Sign out"
          detail="Save your account key first if you want to sign in again"
          onPress={async () => {
            await signOut();
            router.replace('/welcome');
          }}
        />
      </Card>
    </Screen>
  );
}
