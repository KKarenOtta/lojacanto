import { assertCents } from "../finance/rates.ts";
import type { Regulator } from "./eligibility.ts";

export interface KitItem {
  sku: string;
  quantity: number;
  unitCostCents: number;
  supplierId: string;
  regulators: Regulator[];
  certifiedBy: Regulator[];
  originalPackaging: boolean;
  inStock: boolean;
}

export interface Kit {
  items: KitItem[];
  assembledBySupplier: boolean;
  assemblerMeetsAnnexB: boolean;
}

export type KitRejection =
  | "empty_kit"
  | "invalid_quantity"
  | "duplicate_sku"
  | "item_not_certified"
  | "item_without_original_packaging"
  | "item_out_of_stock"
  | "mixed_suppliers"
  | "not_assembled_by_supplier"
  | "assembler_not_compliant";

export function kitRejections(kit: Kit): KitRejection[] {
  if (kit.items.length === 0) return ["empty_kit"];
  const reasons = new Set<KitRejection>();
  const skus = new Set<string>();
  for (const item of kit.items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) reasons.add("invalid_quantity");
    if (skus.has(item.sku)) reasons.add("duplicate_sku");
    skus.add(item.sku);
    const regulated = item.regulators.length > 0;
    if (item.regulators.some((regulator) => !item.certifiedBy.includes(regulator))) {
      reasons.add("item_not_certified");
    }
    if (regulated && !item.originalPackaging) reasons.add("item_without_original_packaging");
    if (!item.inStock) reasons.add("item_out_of_stock");
  }
  if (new Set(kit.items.map((item) => item.supplierId)).size > 1) reasons.add("mixed_suppliers");
  if (!kit.assembledBySupplier) reasons.add("not_assembled_by_supplier");
  else if (
    kit.items.some((item) => item.regulators.includes("inmetro")) && !kit.assemblerMeetsAnnexB
  ) {
    reasons.add("assembler_not_compliant");
  }
  return [...reasons];
}

export function kitUnitCostCents(kit: Kit): number {
  let total = 0;
  for (const item of kit.items) {
    assertCents(item.unitCostCents, "unitCostCents");
    if (item.unitCostCents < 0) throw new RangeError("unitCostCents must not be negative");
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new RangeError("invalid quantity");
    }
    total += item.unitCostCents * item.quantity;
  }
  if (!Number.isSafeInteger(total)) throw new RangeError("kit cost overflow");
  return total;
}
