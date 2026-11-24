export const BPS_SCALE = 10_000;

export function assertCents(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be integer cents`);
}

export function assertBps(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > BPS_SCALE) {
    throw new RangeError(`${name} must be basis points between 0 and ${BPS_SCALE}`);
  }
}

export function applyRate(cents: number, bps: number): number {
  assertCents(cents, "cents");
  assertBps(bps, "bps");
  const product = BigInt(Math.abs(cents)) * BigInt(bps);
  const scale = BigInt(BPS_SCALE);
  const rounded = (product * 2n + scale) / (scale * 2n);
  const result = Number(rounded);
  return cents < 0 ? -result : result;
}

export function rateOf(partCents: number, totalCents: number): number | null {
  assertCents(partCents, "partCents");
  assertCents(totalCents, "totalCents");
  if (totalCents <= 0) return null;
  const scaled = BigInt(partCents) * BigInt(BPS_SCALE);
  const total = BigInt(totalCents);
  const quotient = scaled / total;
  const remainder = scaled % total;
  const twice = (remainder < 0n ? -remainder : remainder) * 2n;
  if (twice < total) return Number(quotient);
  return Number(quotient + (scaled < 0n ? -1n : 1n));
}
