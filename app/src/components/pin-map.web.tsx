import { StyleSheet, Text, View } from 'react-native';

import { colors } from './ui';

export type Pin = { id: string; latitude: number; longitude: number; title: string; detail?: string; tone?: 'shelter' | 'case' | 'urgent' | 'me' };

// react-native-maps has no web renderer; plot pins on a simple projected canvas instead.
export function PinMap({ pins, center, onPress }: { pins: Pin[]; center?: { latitude: number; longitude: number }; onPress?: (pin: Pin) => void }) {
  const focus = center ?? pins[0];
  if (!focus) return null;
  const spread = pins.reduce(
    (max, p) => Math.max(max, Math.abs(p.latitude - focus.latitude), Math.abs(p.longitude - focus.longitude)),
    0.05,
  );
  const position = (p: { latitude: number; longitude: number }) => ({
    left: `${50 + ((p.longitude - focus.longitude) / spread) * 42}%` as const,
    top: `${50 - ((p.latitude - focus.latitude) / spread) * 42}%` as const,
  });
  return (
    <View style={local.map}>
      <View style={[local.grid, StyleSheet.absoluteFill]} />
      {center ? <View style={[local.me, position(center)]} /> : null}
      {pins.map((pin) => (
        <Text
          key={pin.id}
          accessibilityLabel={pin.title}
          onPress={() => onPress?.(pin)}
          style={[local.pin, position(pin), pin.tone === 'urgent' && { backgroundColor: colors.danger }, pin.tone === 'shelter' && { backgroundColor: colors.navy }]}>
          {pin.tone === 'shelter' ? '⌂' : '🐾'}
        </Text>
      ))}
    </View>
  );
}

const local = StyleSheet.create({
  map: { height: 220, borderRadius: 18, overflow: 'hidden', backgroundColor: '#DDF0FF' },
  grid: { borderWidth: 1, borderColor: colors.baby, opacity: 0.6 },
  pin: {
    position: 'absolute',
    width: 30,
    height: 30,
    marginLeft: -15,
    marginTop: -15,
    borderRadius: 15,
    backgroundColor: colors.sky,
    color: colors.white,
    textAlign: 'center',
    lineHeight: 30,
    overflow: 'hidden',
  },
  me: { position: 'absolute', width: 14, height: 14, marginLeft: -7, marginTop: -7, borderRadius: 7, backgroundColor: colors.success, borderWidth: 2, borderColor: colors.white },
});
