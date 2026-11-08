import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { feedback, MotionPressable } from '@/lib/motion';
import { useToken } from '@/lib/session';
import { photoUrl, pickImage, type PickedImage } from '@/lib/uploads';

import { colors } from './ui';

/** Displays a private photo through a short-lived signed URL scoped to the viewer's permissions. */
export function RemotePhoto({ photoId, style, fit = 'cover' }: { photoId?: string; style?: StyleProp<ViewStyle>; fit?: 'cover' | 'contain' }) {
  const token = useToken();
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setUrl(undefined);
    setFailed(false);
    if (!photoId) return;
    photoUrl(token, photoId)
      .then((value) => alive && setUrl(value))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [token, photoId]);
  return (
    <View style={[local.photo, style]}>
      {url && !failed ? (
        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit={fit} transition={150} onError={() => setFailed(true)} />
      ) : (
        <Ionicons name={failed || !photoId ? 'image-outline' : 'hourglass-outline'} size={26} color={colors.baby} />
      )}
    </View>
  );
}

export function choosePhotoSource(onPick: (image: PickedImage) => void, onError: (message: string) => void) {
  const pick = (source: 'camera' | 'library') =>
    pickImage(source)
      .then((image) => { if (image) { onPick(image); feedback('success'); } })
      .catch((e) => { feedback('error'); onError(e instanceof Error ? e.message : 'Could not open photos.'); });
  if (Platform.OS === 'web') return pick('library');
  if (Platform.OS === 'ios')
    return ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Cancel', 'Take photo', 'Choose from library'], cancelButtonIndex: 0 },
      (index) => index && pick(index === 1 ? 'camera' : 'library'),
    );
  Alert.alert('Add a photo', undefined, [
    { text: 'Take photo', onPress: () => pick('camera') },
    { text: 'Choose from library', onPress: () => pick('library') },
    { text: 'Cancel', style: 'cancel' },
  ]);
}

export function PhotoSlot({ label, image, onPick, onError, style }: { label: string; image?: PickedImage; onPick: (image: PickedImage) => void; onError: (message: string) => void; style?: StyleProp<ViewStyle> }) {
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={`Add ${label} photo`}
      onPress={() => choosePhotoSource(onPick, onError)}
      style={[local.slot, style]}>
      {image ? (
        <Image source={{ uri: image.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <>
          <Ionicons name="camera-outline" size={24} color={colors.sky} />
          <Text style={local.slotLabel}>{label}</Text>
        </>
      )}
    </MotionPressable>
  );
}

const local = StyleSheet.create({
  photo: {
    backgroundColor: colors.pale,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    aspectRatio: 1,
  },
  slot: {
    flex: 1,
    aspectRatio: 1,
    minWidth: 70,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.baby,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    gap: 4,
  },
  slotLabel: { color: colors.navy, fontSize: 12, fontWeight: '700', textAlign: 'center' },
});
