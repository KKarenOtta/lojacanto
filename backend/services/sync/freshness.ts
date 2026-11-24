export function isNewer(stored: string | null, incoming: string): boolean {
  const next = Date.parse(incoming);
  if (Number.isNaN(next)) throw new RangeError(`invalid timestamp "${incoming}"`);
  if (stored === null) return true;
  const previous = Date.parse(stored);
  if (Number.isNaN(previous)) throw new RangeError(`invalid timestamp "${stored}"`);
  return next > previous;
}
