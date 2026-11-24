export type Regulator = "anvisa" | "inmetro" | "anatel";

export interface ProductCandidate {
  regulators: Regulator[];
  certifiedBy: Regulator[];
  thirdPartyBrand: boolean;
  brandAuthorized: boolean;
  weightGrams: number;
  longestSideCm: number;
  fragile: boolean;
}

export interface SupplierCandidate {
  cnpjActive: boolean;
  issuesInvoice: boolean;
  acceptsMarketplaceLabel: boolean;
  neutralPackaging: boolean;
  returnPolicy: boolean;
  testOrderApproved: boolean;
  handlingDays: number;
}

export interface OperationalLimits {
  maxWeightGrams: number;
  maxLongestSideCm: number;
  maxHandlingDays: number;
  allowFragile: boolean;
}

export type Rejection =
  | "regulated_without_certification"
  | "unauthorized_brand"
  | "too_heavy"
  | "too_large"
  | "fragile"
  | "supplier_cnpj_inactive"
  | "supplier_without_invoice"
  | "supplier_rejects_label"
  | "supplier_branded_packaging"
  | "supplier_without_return_policy"
  | "supplier_test_order_pending"
  | "supplier_too_slow";

export function productRejections(
  product: ProductCandidate,
  limits: OperationalLimits,
): Rejection[] {
  const reasons: Rejection[] = [];
  if (product.regulators.some((regulator) => !product.certifiedBy.includes(regulator))) {
    reasons.push("regulated_without_certification");
  }
  if (product.thirdPartyBrand && !product.brandAuthorized) reasons.push("unauthorized_brand");
  if (product.weightGrams > limits.maxWeightGrams) reasons.push("too_heavy");
  if (product.longestSideCm > limits.maxLongestSideCm) reasons.push("too_large");
  if (product.fragile && !limits.allowFragile) reasons.push("fragile");
  return reasons;
}

export function supplierRejections(
  supplier: SupplierCandidate,
  limits: OperationalLimits,
): Rejection[] {
  const checks: Array<[boolean, Rejection]> = [
    [supplier.cnpjActive, "supplier_cnpj_inactive"],
    [supplier.issuesInvoice, "supplier_without_invoice"],
    [supplier.acceptsMarketplaceLabel, "supplier_rejects_label"],
    [supplier.neutralPackaging, "supplier_branded_packaging"],
    [supplier.returnPolicy, "supplier_without_return_policy"],
    [supplier.testOrderApproved, "supplier_test_order_pending"],
    [supplier.handlingDays <= limits.maxHandlingDays, "supplier_too_slow"],
  ];
  return checks.filter(([passed]) => !passed).map(([, reason]) => reason);
}
