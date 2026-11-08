import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { errorText } from '@/lib/api';
import { feedback } from '@/lib/motion';
import { currentPlace, placeFromCoordinates, searchPlaces, type Place } from '@/lib/location';
import { Button, Card, Chips, ErrorNote, Field, ListRow, Muted, Strong, styles } from './ui';

export function LocationPicker({ label = 'Location', value, onChange }: { label?: string; value?: Place; onChange: (place: Place) => void }) {
  const [mode, setMode] = useState<'search' | 'point'>('search');
  const [query, setQuery] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState<'gps' | 'search'>();
  const [error, setError] = useState('');
  const revision = useRef(0);
  useEffect(() => () => { revision.current++; }, []);

  const clear = () => {
    revision.current++;
    setResults([]);
    setError('');
    setBusy(undefined);
  };
  const locate = async (method: 'search' | 'gps') => {
    if (method === 'search' && !query.trim()) return;
    clear();
    const version = revision.current;
    setBusy(method);
    try {
      if (method === 'gps') {
        const point = await currentPlace();
        if (revision.current === version) { onChange(point); feedback('success'); }
      } else {
        const places = await searchPlaces(query.trim());
        if (revision.current !== version) return;
        setResults(places);
        if (!places.length) setError('No places matched. Try a nearby city or enter coordinates.');
      }
    } catch (e) {
      if (revision.current === version) setError(errorText(e));
    } finally {
      if (revision.current === version) setBusy(undefined);
    }
  };

  return (
    <View style={styles.field}>
      <Strong>{label}</Strong>
      {value ? <Card tone="info">
        <Strong>{value.label}</Strong>
        {value.label !== `${value.latitude.toFixed(4)}, ${value.longitude.toFixed(4)}` ? <Muted>{value.latitude.toFixed(4)}, {value.longitude.toFixed(4)}</Muted> : null}
      </Card> : null}
      <Button label="Use my current location" icon="locate" variant="outline" onPress={() => locate('gps')} loading={busy === 'gps'} />
      <Chips value={mode} options={[{ value: 'search', label: 'Address search' }, { value: 'point', label: 'Coordinates' }]}
        onChange={(next) => { clear(); setMode(next); }} />
      {mode === 'search' ? <>
        <Field label="Search an address" value={query} onChangeText={(text) => { clear(); setQuery(text); }}
          placeholder="City, street or landmark" returnKeyType="search" onSubmitEditing={() => locate('search')} />
        <Button label="Search" variant="ghost" compact icon="search" disabled={!query.trim()} onPress={() => locate('search')} loading={busy === 'search'} style={styles.alignStart} />
        {results.map((place, index) => (
          <ListRow key={`${place.latitude},${place.longitude},${index}`} icon="location-outline" title={place.label} onPress={() => {
            clear(); setQuery(''); onChange(place);
          }} />
        ))}
      </> : <>
        <Field label="Latitude" value={latitude} onChangeText={(text) => { clear(); setLatitude(text); }}
          autoCorrect={false} autoCapitalize="none" placeholder="32.9481" />
        <Field label="Longitude" value={longitude} onChangeText={(text) => { clear(); setLongitude(text); }}
          autoCorrect={false} autoCapitalize="none" placeholder="-96.7299" />
        <Button label="Use coordinates" icon="pin-outline" compact variant="ghost" style={styles.alignStart} onPress={() => {
          clear();
          try { onChange(placeFromCoordinates(latitude, longitude)); feedback('success'); } catch (e) { setError(errorText(e)); }
        }} />
      </>}
      <ErrorNote error={error} />
    </View>
  );
}
