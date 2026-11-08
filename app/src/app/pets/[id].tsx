import { router, Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ReportCard } from '@/components/cards';
import { RemotePhoto, choosePhotoSource } from '@/components/photos';
import { Badge, Button, Card, ErrorNote, KeyValue, Loading, Muted, Row, Screen, SectionTitle, Title, colors } from '@/components/ui';
import { db } from '@/lib/api';
import { capitalize, speciesLabel } from '@/lib/format';
import { useAction, useLive } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { uploadPhoto } from '@/lib/uploads';
import type { Angle, Pet, Photo, Report } from '@/lib/types';

const angles: Angle[] = ['front', 'left', 'right', 'marking'];

export default function PetDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useSession();
  const { busy, error, setError, run } = useAction();
  const data = useLive(
    async () => {
      const [pet, photos, reports] = await Promise.all([
        db.read<Pet | null>(token!, 'pet', id),
        db.read<Photo[]>(token!, 'pet_photos', id),
        db.read<Report[]>(token!, 'reports'),
      ]);
      return { pet, photos, reports: reports.filter((r) => r.petId === id) };
    },
    id,
    8000,
  );

  if (data.loading && !data.data)
    return (
      <>
        <Stack.Screen options={{ title: 'Pet profile' }} />
        <Loading />
      </>
    );
  const pet = data.data?.pet;
  if (!pet)
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Pet profile' }} />
        <ErrorNote error={data.error ?? 'This pet was not found on your account.'} onRetry={data.refresh} />
      </Screen>
    );
  const photos = data.data!.photos;
  const openReport = data.data!.reports.find((r) => r.status === 'open');

  const addPhoto = (angle: Angle) =>
    choosePhotoSource(
      (image) =>
        run(angle, async () => {
          const uploaded = await uploadPhoto(token!, image);
          await db.call(token!, 'attach_pet_photo', { id: uploaded.id, petId: pet.id, storageKey: uploaded.storageKey, angle, animalCount: 1 });
          await data.refresh();
        }),
      setError,
    );

  return (
    <Screen>
      <Stack.Screen options={{ title: pet.name }} />
      <Title>{pet.name}</Title>
      <Row>
        <Badge label={speciesLabel(pet.species)} />
        {openReport ? <Badge label="Reported lost" tone="warning" /> : null}
      </Row>
      <Card>
        <KeyValue label="Breed" value={pet.breed} />
        <KeyValue label="Age" value={pet.age} />
        <KeyValue label="Size" value={pet.size && capitalize(pet.size)} />
        <KeyValue label="Colors" value={pet.colors.join(', ')} />
        <KeyValue label="Markings" value={pet.markings} />
        <KeyValue label="Microchip" value={pet.microchip ? 'On file (private)' : 'Not provided'} />
      </Card>

      <SectionTitle>Reference photos</SectionTitle>
      <Muted>Each photo becomes a DINOv2 reference embedding used to recognize {pet.name} in found-animal photos.</Muted>
      <View style={local.grid}>
        {angles.map((angle) => {
          const photo = photos.find((p) => p.angle === angle);
          return (
            <View key={angle} style={local.cell}>
              <RemotePhoto photoId={photo?.id} style={local.full} />
              <Muted style={local.caption}>{capitalize(angle)}</Muted>
              {photo ? (
                <Badge label={photo.embeddingRef ? 'Ready for matching' : 'Processing'} tone={photo.embeddingRef ? 'success' : 'neutral'} />
              ) : (
                <Button label="Add" icon="camera-outline" compact variant="ghost" onPress={() => addPhoto(angle)} loading={busy === angle} />
              )}
            </View>
          );
        })}
      </View>
      {photos
        .filter((p) => !angles.includes(p.angle))
        .map((p) => (
          <RemotePhoto key={p.id} photoId={p.id} style={local.extra} />
        ))}
      <ErrorNote error={error} />

      <SectionTitle>Reports</SectionTitle>
      {data.data!.reports.map((r) => (
        <ReportCard key={r.id} report={r} petName={pet.name} />
      ))}
      {openReport ? null : (
        <Button label={`Report ${pet.name} lost`} icon="alert-circle-outline" variant="danger" onPress={() => router.push({ pathname: '/report/lost', params: { petId: pet.id } })} />
      )}
    </Screen>
  );
}

const local = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { width: '47%', flexGrow: 1, gap: 6, alignItems: 'flex-start' },
  full: { width: '100%' },
  caption: { color: colors.text, fontWeight: '700' },
  extra: { width: 120 },
});
