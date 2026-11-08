import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { colors } from './ui';

export function ChatFab() {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Ask Pawtricia" onPress={() => router.push('/chat')} style={({ pressed }) => [local.fab, pressed && { opacity: 0.85 }]}>
      <Image source={require('@/assets/doghead.png')} style={local.icon} contentFit="contain" />
    </Pressable>
  );
}

const local = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 78,
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
  icon: { width: 34, height: 34 },
});
