import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

import { agent, ApiError } from './api';
import type { UploadedPhoto } from './types';

export type PickedImage = { uri: string; mimeType?: string };

const maxBytes = 10_000_000;

async function jpegForUpload(image: PickedImage): Promise<Blob> {
  const original = await (await fetch(image.uri)).blob();
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    if (original.size > maxBytes) throw new ApiError(413, 'Photo is too large. Choose a smaller image (under 10 MB).');
    return original;
  }
  const bitmap = await createImageBitmap(original);
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ApiError(500, 'Could not prepare the photo for upload.');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.82, 0.7, 0.55, 0.4]) {
    const next = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (next && next.size <= maxBytes) return next;
  }
  throw new ApiError(413, 'Photo is too large. Choose a smaller image (under 10 MB).');
}

export async function pickImage(source: 'camera' | 'library' | 'files'): Promise<PickedImage | undefined> {
  if (source === 'files') {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'image/*', multiple: false, copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return undefined;
    const asset = result.assets[0];
    if (asset.mimeType && !asset.mimeType.startsWith('image/'))
      throw new Error('Choose an image file for your pet photo.');
    return { uri: asset.uri, mimeType: asset.mimeType };
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6 };
  if (source === 'camera' && Platform.OS !== 'web') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Allow camera access in Settings to take a photo.');
  }
  const result =
    source === 'camera' && Platform.OS !== 'web'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets[0]) return undefined;
  const asset = result.assets[0];
  return { uri: asset.uri, mimeType: asset.mimeType ?? undefined };
}

type Signed = { photoId: string; storageKey: string; uploadUrl: string; fields: Record<string, string> };

/** Uploads to private Cloudinary storage through a short-lived signature from the agent service. */
export async function uploadPhoto(token: string, image: PickedImage): Promise<UploadedPhoto> {
  const signed = await agent.post<Signed>(token, '/v1/uploads/sign', {});
  const form = new FormData();
  for (const [name, value] of Object.entries(signed.fields)) form.append(name, value);
  if (Platform.OS === 'web') {
    form.append('file', await jpegForUpload(image), 'photo.jpg');
  } else {
    const { File } = await import('expo-file-system');
    let file = new File(image.uri);
    if (!file.exists) throw new ApiError(0, 'The selected photo is no longer available. Choose it again.');
    if (file.size != null && file.size > maxBytes) {
      const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
      for (const [edge, quality] of [[2048, 0.8], [1600, 0.65], [1200, 0.5]]) {
        const context = ImageManipulator.manipulate(image.uri, { maxWidth: edge, maxHeight: edge });
        const rendered = await context.renderAsync();
        const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: quality });
        file = new File(result.uri);
        if (file.size != null && file.size <= maxBytes) break;
      }
    }
    if (file.size == null || file.size > maxBytes)
      throw new ApiError(413, 'Photo is too large. Choose a smaller image (under 10 MB).');
    form.append('file', file);
  }
  let response: Response;
  try {
    // Expo's fetch streams native File objects without React Native's URI-to-Blob shim.
    const uploadFetch = Platform.OS === 'web' ? fetch : (await import('expo/fetch')).fetch;
    response = await uploadFetch(signed.uploadUrl, { method: 'POST', body: form });
  } catch (error) {
    console.warn('Photo upload request failed', error);
    throw new ApiError(0, 'Photo upload failed while sending to storage. Check your connection and try again.');
  }
  if (!response.ok) {
    let detail = `Photo upload failed (${response.status}).`;
    try {
      const body = JSON.parse(await response.text()) as { error?: { message?: string } };
      if (body.error?.message?.toLowerCase().includes('cloud_name'))
        detail = 'Photo storage is misconfigured. Set CLOUDINARY_CLOUD_NAME to your Cloudinary cloud name and restart the agent.';
      else if (body.error?.message) detail = `Photo upload failed: ${body.error.message}`;
    } catch {
      /* keep the status-only message */
    }
    throw new ApiError(response.status, detail);
  }
  return { id: signed.photoId, storageKey: signed.storageKey };
}

const urlCache = new Map<string, { url: string; expires: number }>();
let cacheOwner: string | undefined;

export async function photoUrl(token: string, photoId: string) {
  if (token !== cacheOwner) {
    urlCache.clear();
    cacheOwner = token;
  }
  const cached = urlCache.get(photoId);
  if (cached && cached.expires > Date.now()) return cached.url;
  const { url, expiresIn } = await agent.get<{ url: string; expiresIn: number }>(
    token,
    `/v1/photos/${encodeURIComponent(photoId)}/url`,
  );
  if (cacheOwner === token) urlCache.set(photoId, { url, expires: Date.now() + (expiresIn - 20) * 1000 });
  return url;
}
