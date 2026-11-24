import { ContractError } from "./errors.ts";

const DECIMAL = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

export function toCents(value: unknown, path: string): number {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new ContractError(path, "expected a monetary amount");
  }
  const match = DECIMAL.exec(String(value));
  if (!match) throw new ContractError(path, `invalid monetary amount "${value}"`);
  const [, sign, units, fraction = ""] = match;
  const cents = Number(units) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new ContractError(path, "amount out of range");
  return sign === "-" ? -cents : cents;
}
