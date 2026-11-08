import { Platform, Share } from 'react-native';

export type ShareOutcome = 'copied' | 'shared' | 'cancelled' | 'opened';

export async function shareText(message: string): Promise<ShareOutcome> {
  if (Platform.OS === 'web') {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable in this browser.');
    await navigator.clipboard.writeText(message);
    return 'copied';
  }
  const result = await Share.share({ message });
  if (result.action === Share.dismissedAction) return 'cancelled';
  // Android reports that a chooser opened, even when the person dismisses it.
  if (Platform.OS === 'android') return 'opened';
  if (result.activityType === 'com.apple.UIKit.activity.CopyToPasteboard') return 'copied';
  return 'shared';
}
