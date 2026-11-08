import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Phones on the LAN reach the dev machine through the same host that serves the Expo bundle.
function devHost() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.hostname;
  return Constants.expoConfig?.hostUri?.split(':')[0] || 'localhost';
}

const host = devHost();
const devOrigin = Platform.OS === 'web' && typeof window !== 'undefined'
  ? window.location.origin
  : (() => {
      const authority = Constants.expoConfig?.hostUri;
      if (!authority) return undefined;
      return /^https?:\/\//.test(authority) ? authority.replace(/\/$/, '')
        : `${/\.(on\.expo\.app|exp\.direct|ngrok\.io|ngrok-free\.app)(:|$)/.test(authority) ? 'https' : 'http'}://${authority}`;
    })();

export const config = {
  spacetimeUrl: (process.env.EXPO_PUBLIC_SPACETIME_URI || 'https://maincloud.spacetimedb.com')
    .replace(/^ws/i, 'http')
    .replace(/\/$/, ''),
  database: process.env.EXPO_PUBLIC_SPACETIME_DATABASE || 'petlovers-mlcfo',
  agentUrl: (process.env.EXPO_PUBLIC_AGENT_URL ||
    (__DEV__ && devOrigin ? `${devOrigin}/pawsafe-api` : `http://${host}:8080`)).replace(/\/$/, ''),
  photonUrl: (process.env.EXPO_PUBLIC_PHOTON_URL || 'https://photon.komoot.io').replace(/\/$/, ''),
};
