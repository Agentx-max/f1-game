export function gridSlotFn(track, k) {
  const s = -10 - k * 8;
  const d = (k % 2 === 0 ? 1 : -1) * Math.min(2.4, track.hw * 0.4);
  return { s, d };
}
