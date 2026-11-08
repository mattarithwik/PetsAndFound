import assert from 'node:assert/strict';
import { keyboardOverlap } from '../app/src/lib/keyboard-geometry.ts';

// The bottom of the composer must never pass the keyboard's top, even in a native modal.
for (const { name, y, height, keyboard, screen } of [
  { name: 'full-screen iPhone', y: 0, height: 852, keyboard: { screenY: 520, height: 332 }, screen: 852 },
  { name: 'iPhone modal with native header', y: 160, height: 692, keyboard: { screenY: 520, height: 332 }, screen: 852 },
  { name: 'taller predictive keyboard', y: 160, height: 692, keyboard: { screenY: 480, height: 372 }, screen: 852 },
  { name: 'Android already resized by OS', y: 24, height: 496, keyboard: { screenY: 520, height: 332 }, screen: 852 },
  { name: 'landscape', y: 0, height: 393, keyboard: { screenY: 180, height: 213 }, screen: 393 },
]) {
  const inset = keyboardOverlap(y, height, keyboard, screen);
  assert.equal(y + height - inset, keyboard.screenY, name);
}
assert.equal(keyboardOverlap(160, 692, undefined, 852), 0, 'keyboard dismissed');
assert.equal(keyboardOverlap(0, 852, { screenY: 852, height: 0 }, 852), 0, 'hardware keyboard');
assert.equal(keyboardOverlap(0, 852, { screenY: 0, height: 332 }, 852), 332, 'iOS accessibility cross-fade');
console.log('Keyboard layout checks passed for modal, full-screen, resized, landscape and dismissed states.');
