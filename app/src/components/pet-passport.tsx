import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Platform, StyleSheet, Text, View } from 'react-native';

import { ReportCard } from '@/components/cards';
import { PetFields, petForm, petPayload, photoAngles, type PetForm } from '@/components/pet-fields';
import { RemotePhoto, choosePhotoSource } from '@/components/photos';
import { Badge, Button, Card, Chips, ErrorNote, KeyValue, Loading, Muted, Row, SectionTitle, Toggle, colors } from '@/components/ui';
import { db } from '@/lib/api';
import { capitalize, speciesLabel } from '@/lib/format';
import { useAction, useLive } from '@/lib/hooks';
import { feedback, MotionPressable } from '@/lib/motion';
import { useSession } from '@/lib/session';
import type { Angle, Pet, Photo, Report, UploadedPhoto } from '@/lib/types';
import { uploadPhoto, type PickedImage } from '@/lib/uploads';

const portraitFont = Platform.select({ ios: 'Georgia', web: 'Georgia', default: 'serif' });
export function PetCover({ pet, photoId, onPhoto }: { pet?: Pet; photoId?: string; onPhoto?: () => void }) {
  return (
    <View style={local.cover}>
      <View style={local.paw} pointerEvents="none" aria-hidden><Ionicons name="paw" size={180} color="#FFFFFF12" /></View>
      <View style={local.avatar}>
        {photoId ? <RemotePhoto photoId={photoId} style={local.photo} /> : pet ?
          <View style={[local.photo, local.emptyPortrait]}><Ionicons name="paw" size={46} color={colors.navy} /></View> :
          <Image source={require('../../assets/daisy.png')} contentFit="cover" style={local.photo} />}
        {onPhoto ? <MotionPressable onPress={onPhoto} accessibilityRole="button" accessibilityLabel="Add a reference photo" style={local.camera}>
          <Ionicons name="camera" size={16} color={colors.navy} />
        </MotionPressable> : null}
      </View>
      <Text accessibilityRole="header" style={local.name}>{pet?.name ?? 'Your pet profiles'}</Text>
      <Text style={local.subtitle}>{pet ? [pet.breed || speciesLabel(pet.species), pet.age].filter(Boolean).join('  ·  ') :
        'Keep their photos, identifying features and care notes together.'}</Text>
    </View>
  );
}

type Addition = { angle: Angle; image: PickedImage; uploaded?: UploadedPhoto };

export function PetPassport({ id, onSaved }: { id: string; onSaved?: () => void }) {
  const { token } = useSession();
  const data = useLive(async () => {
    const [pet, photos, reports] = await Promise.all([
      db.read<Pet | null>(token!, 'pet', id),
      db.read<Photo[]>(token!, 'pet_photos', id),
      db.read<Report[]>(token!, 'reports'),
    ]);
    return { pet, photos, reports: reports.filter((report) => report.petId === id) };
  }, `pet:${id}`, 15000, ['my_pets', 'my_pet_photos', 'my_reports']);
  const { busy, error, setError, run } = useAction();
  const [form, setForm] = useState<PetForm>();
  const [original, setOriginal] = useState<PetForm>();
  const [addition, setAddition] = useState<Addition>();
  const [single, setSingle] = useState(true);
  const [expanded, setExpanded] = useState<Photo>();
  const pet = data.data?.pet;
  const choose = (angle: Angle) => choosePhotoSource((image) => {
    setError(undefined);
    setSingle(true);
    setAddition({ angle, image });
  }, setError);
  const savePhoto = () => run('photo', async () => {
    if (!addition) return;
    const uploaded = addition.uploaded ?? await uploadPhoto(token!, addition.image);
    setAddition({ ...addition, uploaded });
    await db.call(token!, 'attach_pet_photo', {
      ...uploaded, petId: id, angle: addition.angle, ...(single ? { animalCount: 1 } : {}),
    });
    setAddition(undefined);
    await data.refresh();
    feedback('success');
  });
  const saveDetails = () => run('details', async () => {
    if (!form || !original) return;
    const edited = petPayload(form);
    const previous = petPayload(original);
    const changes = Object.fromEntries(Object.entries(edited).filter(([key, value]) =>
      JSON.stringify(value) !== JSON.stringify(previous[key as keyof typeof previous])));
    if (Object.keys(changes).length) await db.call(token!, 'update_pet', { id, ...changes });
    setForm(undefined);
    await data.refresh();
    feedback('success');
    onSaved?.();
  });

  if (!data.data && data.loading) return <Loading label="Opening pet profile…" />;
  if (!pet) return <ErrorNote error={data.error ?? 'This pet profile could not be found.'} onRetry={data.refresh} />;
  const { photos, reports } = data.data!;
  const main = photos.find((photo) => photo.angle === 'front') ?? photos[0];
  const missingAngle = photoAngles.find(({ angle }) => !photos.some((p) => p.angle === angle))?.angle ?? 'other';
  const gallery = photoAngles.flatMap(({ angle, label }) => {
    const matches = photos.filter((p) => p.angle === angle);
    return matches.length ? matches.map((photo) => ({ angle, label, photo: photo as Photo | undefined })) : [{ angle, label, photo: undefined }];
  }).concat(photos.filter((photo) => photo.angle === 'other').map((photo) => ({ angle: photo.angle, label: 'Other view', photo })));
  return (
    <>
      <PetCover pet={pet} photoId={main?.id} onPhoto={() => choose(missingAngle)} />
      <ErrorNote error={data.error} onRetry={data.refresh} />
      <SectionTitle>Reference photos</SectionTitle>
      {!photos.length ? <Muted>Add a clear front photo to make {pet.name} eligible for image matching.</Muted> : null}
      <View style={local.gallery}>
        {gallery.map(({ angle, label, photo }) => (
          <MotionPressable key={photo?.id ?? angle} accessibilityRole="button"
            accessibilityLabel={photo ? `View ${label.toLowerCase()} photo` : `Add ${label.toLowerCase()} photo`}
            onPress={() => photo ? setExpanded(photo) : choose(angle)} style={local.cell}>
            {photo ? <RemotePhoto photoId={photo.id} style={local.tile} /> : <View style={[local.tile, local.add]}><Ionicons name="add" size={25} color={colors.navy} /></View>}
            <Text style={local.caption}>{label}</Text>
          </MotionPressable>
        ))}
      </View>
      <Modal visible={!!expanded} transparent animationType="fade" onRequestClose={() => setExpanded(undefined)}>
        <View style={local.overlay}>
          <View style={local.viewer}>
            {expanded ? <>
              <RemotePhoto photoId={expanded.id} style={local.enlarged} fit="contain" />
              <Row><Text style={local.caption}>{capitalize(expanded.angle)} view</Text><Badge label={expanded.embeddingRef ? 'Ready for matching' : expanded.animalCount !== 1 ? 'Needs review' : 'Processing'} /></Row>
            </> : null}
            <Button label="Close photo" variant="outline" onPress={() => setExpanded(undefined)} />
          </View>
        </View>
      </Modal>
      {addition ? <Card>
        <Image source={{ uri: addition.image.uri }} style={local.staged} contentFit="contain" />
        <Chips label="Photo angle" value={addition.angle}
          options={[...photoAngles.map(({ angle, label }) => ({ value: angle, label })), { value: 'other', label: 'Other view' }]}
          onChange={(angle) => setAddition({ ...addition, angle })} />
        <Toggle label="Only this pet is in the photo" value={single} onChange={setSingle} />
        <Row><Button label="Save photo" icon="camera" onPress={savePhoto} loading={!!busy} /><Button label="Cancel" variant="ghost" disabled={!!busy} onPress={() => setAddition(undefined)} /></Row>
      </Card> : null}
      <ErrorNote error={error} />
      <SectionTitle action={!form ? <Button label="Edit details" icon="pencil" variant="ghost" compact onPress={() => {
        const initial = petForm(pet);
        setForm(initial); setOriginal(initial); setError(undefined);
      }} /> : undefined}>Pet details</SectionTitle>
      <Card>
        {form ? <>
          <PetFields form={form} onChange={setForm} />
          <Row><Button label="Save changes" onPress={saveDetails} loading={!!busy} /><Button label="Cancel" variant="ghost" disabled={!!busy} onPress={() => setForm(undefined)} /></Row>
        </> : <>
          <KeyValue label="Species" value={speciesLabel(pet.species)} />
          <KeyValue label="Breed" value={pet.breed} />
          <KeyValue label="Age" value={pet.age} />
          <KeyValue label="Size" value={capitalize(pet.size)} />
          <KeyValue label="Colors" value={pet.colors.join(', ')} />
          <KeyValue label="Identifying features" value={pet.markings} />
          <KeyValue label="Microchip" value={pet.microchip ? 'On file · private' : undefined} />
          <KeyValue label="Health and care" value={pet.healthNotes} />
        </>}
      </Card>
      <SectionTitle>Rescue reports</SectionTitle>
      {reports.map((report) => <ReportCard key={report.id} report={report} petName={pet.name} />)}
      {!reports.length ? <Muted>No reports for {pet.name}.</Muted> : null}
      {!reports.some((r) => r.status === 'open') ? <Button label={`Report ${pet.name} lost`} icon="search-outline" variant="outline" onPress={() => router.push({ pathname: '/report/lost', params: { petId: id } })} /> : null}
    </>
  );
}

const local = StyleSheet.create({
  cover: { backgroundColor: '#2178BD', borderRadius: 24, paddingHorizontal: 22, paddingVertical: 26, alignItems: 'center', overflow: 'hidden', gap: 9 },
  paw: { position: 'absolute', right: -30, top: -28, transform: [{ rotate: '18deg' }] },
  avatar: { width: 120, height: 120, padding: 4, borderRadius: 60, backgroundColor: '#D5EEFF', marginBottom: 3 },
  photo: { width: '100%', height: '100%', borderRadius: 60 },
  emptyPortrait: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF7FE' },
  camera: { position: 'absolute', bottom: 1, right: 1, width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: 'white', borderColor: '#D5EEFF', borderWidth: 2 },
  name: { fontFamily: portraitFont, fontWeight: 'bold', fontSize: 38, color: 'white', textAlign: 'center' },
  subtitle: { color: 'white', lineHeight: 21, fontSize: 15, maxWidth: 385, textAlign: 'center' },
  gallery: { flexDirection: 'row', gap: 9, flexWrap: 'wrap' },
  cell: { flexGrow: 1, flexBasis: '19%', maxWidth: 130, minWidth: 58, gap: 5 },
  tile: { width: '100%', aspectRatio: 1, borderRadius: 12 },
  add: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#A6CFE7', borderStyle: 'dashed', backgroundColor: '#EEF7FE' },
  caption: { fontSize: 13, fontWeight: '600', color: colors.text },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#102A40DD', padding: 22 },
  viewer: { width: '100%', maxWidth: 480, backgroundColor: 'white', borderRadius: 18, padding: 16, gap: 12 },
  enlarged: { width: '100%', maxHeight: 420 },
  staged: { width: '100%', height: 160, borderRadius: 12 },
});
