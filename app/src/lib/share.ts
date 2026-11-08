import { Platform, Share } from 'react-native';

/** On web, copies to the clipboard because the native share sheet is unavailable. */
export async function shareText(message: string): Promise<'copied' | 'shared'> {
  if (Platform.OS === 'web') {
    if (!navigator.clipboard?.writeText) throw new Error('Copy this value from the screen — clipboard access is unavailable.');
    await navigator.clipboard.writeText(message);
    return 'copied';
  }
  await Share.share({ message });
  return 'shared';
}
