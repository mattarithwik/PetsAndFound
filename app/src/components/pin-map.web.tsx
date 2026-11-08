import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { MotionPressable } from '@/lib/motion';
import { colors } from './ui';

export type Pin = {
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  detail?: string;
  tone?: 'shelter' | 'case' | 'urgent' | 'me';
};
type Point = Pick<Pin, 'latitude' | 'longitude'>;
const height = 240;
const tileSize = 256;
const pinColors = { case: colors.navy, shelter: '#286546', urgent: colors.danger, me: colors.sky };

// Coordinates in one Web Mercator world, before scaling to the current zoom.
function project(point: Point) {
  const lat = (Math.max(-85.0511, Math.min(85.0511, point.latitude)) * Math.PI) / 180;
  return { x: (point.longitude + 180) / 360, y: (1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 };
}

export function PinMap({ pins, center, onPress }: { pins: Pin[]; center?: Point; onPress?: (pin: Pin) => void }) {
  const [width, setWidth] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  const selected = pins.find((p) => p.id === selectedId);
  const focus = center ?? pins[0];
  if (!focus) return null;
  const origin = project(focus);
  const offsets = pins.map((pin) => {
    const p = project(pin);
    const dx = p.x - origin.x;
    return { pin, x: dx - Math.round(dx), y: p.y - origin.y };
  });
  const maxX = Math.max(0.0001, ...offsets.map((p) => Math.abs(p.x)));
  const maxY = Math.max(0.0001, ...offsets.map((p) => Math.abs(p.y)));
  const fit = Math.min((Math.max(width, 80) - 44) / (2 * maxX), (height - 54) / (2 * maxY));
  const zoom = Math.max(0, Math.min(14, Math.floor(Math.log2(fit / tileSize))));
  const count = 2 ** zoom;
  const scale = tileSize * count;
  const left = origin.x * scale - width / 2;
  const top = origin.y * scale - height / 2;
  const tiles = [];
  if (width) {
    for (let y = Math.max(0, Math.floor(top / tileSize)); y <= Math.min(count - 1, Math.floor((top + height) / tileSize)); y++) {
      for (let x = Math.floor(left / tileSize); x <= Math.floor((left + width) / tileSize); x++) {
        const column = ((x % count) + count) % count;
        tiles.push(
          <img
            key={`${zoom}/${x}/${y}`}
            src={`https://tile.openstreetmap.org/${zoom}/${column}/${y}.png`}
            loading="lazy"
            draggable={false}
            alt=""
            style={{
              position: 'absolute',
              left: x * tileSize - left,
              top: y * tileSize - top,
              width: tileSize,
              height: tileSize,
              pointerEvents: 'none',
            }}
          />,
        );
      }
    }
  }
  return (
    <View style={local.frame}>
      <View style={local.map} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
        {tiles}
        {width
          ? offsets.map(({ pin, x, y }) => (
              <MotionPressable
                key={pin.id}
                accessibilityRole="button"
                accessibilityLabel={pin.title}
                accessibilityState={{ selected: selected?.id === pin.id }}
                onPress={() => setSelectedId(pin.id)}
                style={[
                  local.pin,
                  {
                    left: width / 2 + x * scale - 15,
                    top: height / 2 + y * scale - 15,
                    backgroundColor: pinColors[pin.tone ?? 'case'],
                  },
                  selected?.id === pin.id && local.selected,
                ]}
              >
                <Ionicons name={pin.tone === 'shelter' ? 'home' : 'paw'} color="white" size={15} />
              </MotionPressable>
            ))
          : null}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            background: 'white',
            color: '#164D73',
            font: '11px sans-serif',
            padding: '3px 6px',
          }}
        >
          © OpenStreetMap contributors
        </a>
      </View>
      {selected ? (
        <View style={local.caption}>
          <Text style={local.name}>{selected.title}</Text>
          {selected.detail ? <Text>{selected.detail}</Text> : null}
          <MotionPressable
            accessibilityRole="button"
            onPress={() =>
              onPress
                ? onPress(selected)
                : Linking.openURL(
                    `https://www.openstreetmap.org/?mlat=${selected.latitude}&mlon=${selected.longitude}#map=15/${selected.latitude}/${selected.longitude}`,
                  )
            }
          >
            <Text style={local.link}>{onPress ? 'Open details' : 'Open full map'} →</Text>
          </MotionPressable>
        </View>
      ) : null}
    </View>
  );
}

const local = StyleSheet.create({
  frame: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, overflow: 'hidden' },
  map: { height, overflow: 'hidden', backgroundColor: '#DDEAEF' },
  pin: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'white',
  },
  selected: { borderColor: '#FFD06E', zIndex: 1 },
  caption: { padding: 12, backgroundColor: colors.white, gap: 4 },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  link: { fontSize: 13, fontWeight: '700', color: colors.navy, paddingVertical: 4 },
});
