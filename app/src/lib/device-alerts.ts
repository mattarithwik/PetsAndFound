import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { db } from './api';
import { uuid } from './ids';
import { storage } from './storage';

const DEVICE_KEY = 'pawsafe.push.device';
const TIPS_KEY = 'pawsafe.push.tips';

async function native() {
  if (Platform.OS === 'web') throw new Error('Device alerts are available in the iOS and Android app.');
  return import('expo-notifications');
}

export async function enableDeviceAlerts(token: string) {
  const Notifications = await native();
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('pawsafe-updates', {
    name: 'PawSafe updates', importance: Notifications.AndroidImportance.HIGH,
  });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Allow notifications in your device settings to receive alerts.');
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  if (!projectId) throw new Error('Configure an EAS project ID before enabling remote alerts.');
  const expoToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  let deviceId = await storage.get(DEVICE_KEY);
  if (!deviceId) deviceId = `dev-${uuid()}`;
  await db.call(token, 'register_push_device', { deviceId, token: expoToken });
  await storage.set(DEVICE_KEY, deviceId);
}

export async function disableDeviceAlerts(token: string) {
  const deviceId = await storage.get(DEVICE_KEY);
  if (deviceId) {
    await db.call(token, 'unregister_push_device', { deviceId });
    await storage.remove(DEVICE_KEY);
  }
}

const tips = [
  'Keep a current photo of each pet, including distinctive markings.',
  'Check that your pet’s ID tag and microchip contact details are current.',
  'Keep a carrier or leash where you can reach it quickly.',
  'Store food, water, medication and care notes in your pet emergency kit.',
  'Know which nearby shelters can accept animals before an evacuation.',
  'Practice bringing your pet to a safe indoor area during severe weather.',
  'Review your evacuation route and where you would reunite with your pet.',
];

export async function enableDailyTips() {
  const Notifications = await native();
  const existing = await storage.get(TIPS_KEY);
  if (existing) return;
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Allow notifications in your device settings to receive daily tips.');
  const ids: string[] = [];
  try {
    for (let day = 1; day <= 7; day++) {
      const id = await Notifications.scheduleNotificationAsync({
        content: { title: 'PawSafe daily preparation', body: tips[day - 1] },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: day, hour: 9, minute: 0 },
      });
      ids.push(id);
    }
    await storage.set(TIPS_KEY, JSON.stringify(ids));
  } catch (error) {
    for (const id of ids) await Notifications.cancelScheduledNotificationAsync(id);
    throw error;
  }
}

export async function disableDailyTips() {
  const Notifications = await native();
  const raw = await storage.get(TIPS_KEY);
  if (!raw) return;
  const ids = JSON.parse(raw) as string[];
  for (const id of ids) await Notifications.cancelScheduledNotificationAsync(id);
  await storage.remove(TIPS_KEY);
}

export async function dailyTipsEnabled() { return !!(await storage.get(TIPS_KEY)); }
export async function deviceAlertsEnabled() { return !!(await storage.get(DEVICE_KEY)); }

export async function unregisterOnSignOut(token: string) {
  try { await disableDeviceAlerts(token); } catch { /* Keep sign-out possible while offline. */ }
}
