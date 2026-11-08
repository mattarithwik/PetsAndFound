type KeyboardFrame = { screenY: number; height: number };

/** Both the container and keyboard must use window coordinates, including native modal offsets. */
export function keyboardOverlap(
  containerY: number,
  containerHeight: number,
  frame: KeyboardFrame | undefined,
  screenHeight: number,
) {
  if (!frame || frame.height <= 0) return 0;
  // iOS cross-fade accessibility transitions can report screenY as zero.
  const keyboardTop = frame.screenY > 0 ? frame.screenY : screenHeight - frame.height;
  return Math.max(0, Math.min(containerHeight, containerY + containerHeight - keyboardTop));
}
