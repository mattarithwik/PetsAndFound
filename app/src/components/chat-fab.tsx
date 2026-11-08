import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from './ui';
import { MotionPressable } from '@/lib/motion';

export function ChatFab({ header = false }: { header?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel="Ask Pawtricia"
      accessibilityHint="Opens your PawSafe assistant"
      onPress={() => router.push('/chat')}
      style={header ? local.header : [local.fab, { bottom: 72 + insets.bottom }]}
    >
      <Image source={require('@/assets/doghead.png')} style={local.icon} contentFit="contain" />
    </MotionPressable>
  );
}

const local = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 16,
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.text,
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  header: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.pale,
    marginHorizontal: 6,
  },
  icon: { width: 34, height: 34 },
});
