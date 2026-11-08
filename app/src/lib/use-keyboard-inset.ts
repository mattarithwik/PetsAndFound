import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform, type KeyboardEvent, type KeyboardMetrics, type ViewInstance } from 'react-native';

import { keyboardOverlap } from './keyboard-geometry';

/** Measure the native root in the same coordinate space as keyboard events. */
export function useKeyboardInset() {
  const containerRef = useRef<ViewInstance>(null);
  const keyboardFrame = useRef<KeyboardMetrics | undefined>(undefined);
  const measurement = useRef(0);
  const [bottomInset, setBottomInset] = useState(0);
  const invalidateMeasurement = useCallback(() => { measurement.current++; }, []);

  const measure = useCallback((event?: KeyboardEvent) => {
    if (Platform.OS === 'web') return;
    const revision = ++measurement.current;
    if (!keyboardFrame.current) {
      if (event) Keyboard.scheduleLayoutAnimation(event);
      setBottomInset(0);
      return;
    }
    containerRef.current?.measureInWindow((_x, y, _width, height) => {
      if (revision !== measurement.current || !containerRef.current) return;
      const inset = keyboardOverlap(y, height, keyboardFrame.current, Dimensions.get('screen').height);
      if (event) Keyboard.scheduleLayoutAnimation(event);
      setBottomInset(previous => Math.abs(previous - inset) < 0.5 ? previous : inset);
    });
  }, []);

  useLayoutEffect(() => {
    if (Platform.OS === 'web') return;
    const show = (event: KeyboardEvent) => {
      keyboardFrame.current = event.endCoordinates;
      measure(event);
    };
    const hide = (event: KeyboardEvent) => {
      keyboardFrame.current = undefined;
      measure(event);
    };
    const subscriptions = Platform.OS === 'ios'
      ? [Keyboard.addListener('keyboardWillShow', show), Keyboard.addListener('keyboardWillChangeFrame', show),
          Keyboard.addListener('keyboardWillHide', hide)]
      : [Keyboard.addListener('keyboardDidShow', show), Keyboard.addListener('keyboardDidHide', hide)];
    keyboardFrame.current = Keyboard.metrics() ?? undefined;
    measure();
    return () => {
      invalidateMeasurement();
      subscriptions.forEach(subscription => subscription.remove());
    };
  }, [measure, invalidateMeasurement]);

  return { containerRef, bottomInset, measure: () => measure() };
}
