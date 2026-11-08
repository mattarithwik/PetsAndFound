import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';

import { DrillRoom } from '@/components/drill-room';
import { colors } from '@/components/ui';
import { MotionPressable } from '@/lib/motion';

function ExitPractice() {
  const exit = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  return (
    <MotionPressable accessibilityRole="button" accessibilityLabel="Back to PawSafe" onPress={exit} hitSlop={10} style={{ padding: 6 }}>
      <Ionicons name="arrow-back" size={24} color={colors.navy} />
    </MotionPressable>
  );
}

export default function Practice() {
  return (
    <>
      <Stack.Screen options={{ title: 'Practice arcade', headerLeft: ExitPractice, headerBackVisible: false }} />
      <DrillRoom deviceOnly />
    </>
  );
}
