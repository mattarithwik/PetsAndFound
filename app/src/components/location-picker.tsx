import { useState } from 'react';
import { View } from 'react-native';

import { errorText } from '@/lib/api';
import { currentPlace, searchPlaces, type Place } from '@/lib/location';

import { Button, Card, ErrorNote, Field, ListRow, Muted, Strong, styles } from './ui';

/** Picks a confirmed location from GPS or an address search; the agent never guesses coordinates. */
export function LocationPicker({ label = 'Location', value, onChange }: { label?: string; value?: Place; onChange: (place: Place) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState<'gps' | 'search'>();
  const [error, setError] = useState<string>();

  const locate = async () => {
    setBusy('gps');
    setError(undefined);
    try {
      onChange(await currentPlace());
      setResults([]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(undefined);
    }
  };
  const search = async () => {
    if (!query.trim()) return;
    setBusy('search');
    setError(undefined);
    try {
      const places = await searchPlaces(query.trim());
      setResults(places);
      if (!places.length) setError('No matching places. Try a street, landmark or city.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <View style={styles.field}>
      <Strong>{label}</Strong>
      {value ? (
        <Card tone="info">
          <Strong>{value.label}</Strong>
          <Muted>
            {value.latitude.toFixed(4)}, {value.longitude.toFixed(4)} · public listings show only an area within about 10 km
          </Muted>
        </Card>
      ) : (
        <Muted>Search for a city, street or landmark, or use your current location.</Muted>
      )}
      <Button label="Use my current location" icon="locate" variant="outline" onPress={locate} loading={busy === 'gps'} />
      <Field label="Or search an address" value={query} onChangeText={setQuery} placeholder="Street, park or landmark" returnKeyType="search" onSubmitEditing={search} />
      <Button label="Search" variant="ghost" compact icon="search" onPress={search} loading={busy === 'search'} style={styles.alignStart} />
      {results.map((place, index) => (
        <ListRow
          key={`${place.latitude},${place.longitude},${index}`}
          icon="location-outline"
          title={place.label}
          onPress={() => {
            onChange(place);
            setResults([]);
          }}
        />
      ))}
      <ErrorNote error={error} />
    </View>
  );
}
