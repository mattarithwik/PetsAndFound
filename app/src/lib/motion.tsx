import * as Haptics from 'expo-haptics';
import { type ReactNode } from 'react';
import { Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type FeedbackKind = 'tap' | 'selection' | 'success' | 'warning' | 'error';

export function feedback(kind: FeedbackKind) {
  // The Web Vibration API is inconsistent and can be disruptive on desktop browsers.
  if (Platform.OS === 'web') return;
  const result = Platform.OS === 'android'
    ? Haptics.performAndroidHapticsAsync(
        kind === 'success' ? Haptics.AndroidHaptics.Confirm
          : kind === 'warning' || kind === 'error' ? Haptics.AndroidHaptics.Reject
            : kind === 'selection' ? Haptics.AndroidHaptics.Clock_Tick
              : Haptics.AndroidHaptics.Context_Click,
      )
    : kind === 'success' || kind === 'warning' || kind === 'error'
      ? Haptics.notificationAsync(
          kind === 'success' ? Haptics.NotificationFeedbackType.Success
            : kind === 'warning' ? Haptics.NotificationFeedbackType.Warning
              : Haptics.NotificationFeedbackType.Error,
        )
      : kind === 'selection' ? Haptics.selectionAsync()
        : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  void result.catch(() => undefined);
}

type MotionPressableProps = Omit<PressableProps, 'children' | 'style'> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  feedback?: 'tap' | 'selection' | 'none';
  pressedScale?: number;
};

export function MotionPressable({
  children,
  style,
  feedback: feedbackKind = 'tap',
  pressedScale = 0.98,
  onPress,
  onPressIn,
  onPressOut,
  disabled,
  ...props
}: MotionPressableProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      style={[style, animatedStyle]}
      onPressIn={(event) => {
        if (!reduceMotion) scale.set(withTiming(pressedScale, { duration: 90, reduceMotion: ReduceMotion.System }));
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.set(withTiming(1, { duration: 150, reduceMotion: ReduceMotion.System }));
        onPressOut?.(event);
      }}
      onPress={(event) => {
        if (!disabled && feedbackKind !== 'none') feedback(feedbackKind);
        onPress?.(event);
      }}>
      {children}
    </AnimatedPressable>
  );
}
