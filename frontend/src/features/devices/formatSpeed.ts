/** Rounded magnitude and sign; anything that rounds to zero is unsigned. */
export function formatSpeed(speed: number, digits: number): { negative: boolean; text: string } {
  const magnitude = Math.abs(speed).toFixed(digits);
  return { negative: speed < 0 && Number(magnitude) !== 0, text: magnitude };
}
