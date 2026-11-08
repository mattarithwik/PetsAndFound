import { StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { colors } from './ui';

export type Pin = { id: string; latitude: number; longitude: number; title: string; detail?: string; tone?: 'shelter' | 'case' | 'urgent' | 'me' };

const pinColor = { shelter: colors.navy, case: colors.sky, urgent: colors.danger, me: colors.success };

export function PinMap({ pins, center, onPress }: { pins: Pin[]; center?: { latitude: number; longitude: number }; onPress?: (pin: Pin) => void }) {
  const focus = center ?? pins[0];
  if (!focus) return null;
  const spread = pins.reduce(
    (max, p) => Math.max(max, Math.abs(p.latitude - focus.latitude), Math.abs(p.longitude - focus.longitude)),
    0.05,
  );
  return (
    <View style={local.wrap}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...focus, latitudeDelta: spread * 2.4, longitudeDelta: spread * 2.4 }}>
        {pins.map((pin) => (
          <Marker
            key={pin.id}
            coordinate={pin}
            title={pin.title}
            description={pin.detail}
            pinColor={pinColor[pin.tone ?? 'case']}
            onCalloutPress={() => onPress?.(pin)}
          />
        ))}
      </MapView>
    </View>
  );
}

const local = StyleSheet.create({
  wrap: { height: 220, borderRadius: 18, overflow: 'hidden', backgroundColor: colors.pale },
});
