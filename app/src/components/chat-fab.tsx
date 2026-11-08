import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from './ui';

export function ChatFab({ header = false }: { header?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Ask Pawtricia"
      onPress={() => router.push('/chat')}
      style={({ pressed }) => [
        header ? local.header : [local.fab, { bottom: 72 + insets.bottom }],
        pressed && { opacity: 0.85 },
      ]}
    >
      <Image source={require('@/assets/doghead.png')} style={local.icon} contentFit="contain" />
    </Pressable>
  );
}

const local = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 16,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  header: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: colors.pale,
    marginHorizontal: 6,
  },
  icon: { width: 34, height: 34 },
});
