export interface SupplierRecord {
  orders: number;
  onTime: number;
  defects: number;
  cancellations: number;
}

export interface SupplierScore {
  sufficientSample: boolean;
  onTimeLowerBps: number;
  failureUpperBps: number;
  scoreBps: number | null;
}

export const MINIMUM_SAMPLE = 20;
const Z = 1.96;

function wilson(successes: number, total: number): { lower: number; upper: number } {
  if (total === 0) return { lower: 0, upper: 1 };
  const p = successes / total;
  const z2 = Z * Z;
  const center = p + z2 / (2 * total);
  const margin = Z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  const denominator = 1 + z2 / total;
  return {
    lower: Math.max(0, (center - margin) / denominator),
    upper: Math.min(1, (center + margin) / denominator),
  };
}

const toBps = (value: number) => Math.round(value * 10_000);

export function scoreSupplier(record: SupplierRecord): SupplierScore {
  const { orders, onTime, defects, cancellations } = record;
  for (const value of [orders, onTime, defects, cancellations]) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError("counts must be non-negative integers");
    }
  }
  if (onTime > orders || defects + cancellations > orders) {
    throw new RangeError("counts exceed orders");
  }
  const punctuality = wilson(onTime, orders);
  const failures = wilson(defects + cancellations, orders);
  const sufficientSample = orders >= MINIMUM_SAMPLE;
  const onTimeLowerBps = toBps(punctuality.lower);
  const failureUpperBps = toBps(failures.upper);
  return {
    sufficientSample,
    onTimeLowerBps,
    failureUpperBps,
    scoreBps: sufficientSample ? Math.max(0, onTimeLowerBps - failureUpperBps) : null,
  };
}
