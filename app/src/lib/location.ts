import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { config } from './config';

export type Place = {
  latitude: number;
  longitude: number;
  label: string;
  city?: string;
  /** Two-letter US state code when known, used for FEMA history. */
  state?: string;
};

const states: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
  louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'puerto rico': 'PR', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | undefined>;
};

function toPlace(f: PhotonFeature, fallback?: { latitude: number; longitude: number }): Place {
  const p = f.properties;
  const city = p.city || p.town || p.village || p.county;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const label = [p.name !== city ? p.name : undefined, street || undefined, city, p.state]
    .filter((part, i, all) => part && all.indexOf(part) === i)
    .join(', ');
  return {
    latitude: fallback?.latitude ?? f.geometry.coordinates[1],
    longitude: fallback?.longitude ?? f.geometry.coordinates[0],
    label: label || 'Selected location',
    city,
    state: p.countrycode === 'US' && p.state ? states[p.state.toLowerCase()] : undefined,
  };
}

async function photon(path: string) {
  const response = await fetch(config.photonUrl + path, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Address lookup is unavailable right now.');
  return ((await response.json()) as { features: PhotonFeature[] }).features;
}

export async function searchPlaces(query: string): Promise<Place[]> {
  const features = await photon(`/api/?${new URLSearchParams({ q: query, limit: '5', lang: 'en' })}`);
  return features.map((f) => toPlace(f));
}

export async function describePoint(latitude: number, longitude: number): Promise<Place> {
  try {
    const [feature] = await photon(`/reverse?${new URLSearchParams({ lat: String(latitude), lon: String(longitude) })}`);
    if (feature) return toPlace(feature, { latitude, longitude });
  } catch {
    /* Coordinates alone are still usable. */
  }
  return { latitude, longitude, label: `${latitude.toFixed(3)}, ${longitude.toFixed(3)}` };
}

export async function currentPlace(): Promise<Place> {
  if (Platform.OS !== 'web') {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) throw new Error('Location permission is off. Search for an address instead.');
  }
  const position = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Location timed out. Search for an address instead.')), 8000),
    ),
  ]);
  return describePoint(position.coords.latitude, position.coords.longitude);
}

export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const r = Math.PI / 180;
  const dlat = (b.latitude - a.latitude) * r;
  const dlon = (b.longitude - a.longitude) * r;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin(dlon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}
