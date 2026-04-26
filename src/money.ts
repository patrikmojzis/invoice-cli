import Decimal from "decimal.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export type VatKind = "domestic" | "reverse" | "exempt";

export type CalculatedLine = {
  name: string;
  description?: string;
  quantity: Decimal;
  unitPrice: Decimal;
  vatRate: Decimal;
  vatKind: VatKind;
  net: Decimal;
  vat: Decimal;
  gross: Decimal;
};

export type VatBucket = {
  key: string;
  label: string;
  vatKind: VatKind;
  rate: Decimal;
  net: Decimal;
  vat: Decimal;
  gross: Decimal;
};

export type Totals = {
  lines: CalculatedLine[];
  buckets: VatBucket[];
  net: Decimal;
  vat: Decimal;
  gross: Decimal;
};

export function money(value: Decimal.Value): Decimal {
  return new Decimal(value).toDecimalPlaces(2);
}

export function formatMoney(value: Decimal.Value): string {
  const decimal = new Decimal(value).toDecimalPlaces(2);
  const sign = decimal.isNegative() ? "-" : "";
  const [whole, fraction = "00"] = decimal.abs().toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${grouped},${fraction}`;
}

export function formatCurrency(value: Decimal.Value, currency = "EUR"): string {
  return `${formatMoney(value)} ${currency}`;
}

export function formatQuantity(value: Decimal.Value): string {
  return new Decimal(value).toDecimalPlaces(2).toFixed(2).replace(".", ",");
}

export function formatVat(rate: Decimal, kind: VatKind): string {
  if (kind === "reverse") return "Neobsahuje DPH";
  if (kind === "exempt") return "Oslobodené";
  return `${rate.toString()} %`;
}
