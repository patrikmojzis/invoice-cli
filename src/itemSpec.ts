import type { InvoiceItem } from "./schema";
import { invoiceItemSchema } from "./schema";

export function parseItemSpec(spec: string): InvoiceItem {
  const parts = spec.split(";").map((part) => part.trim());
  if (parts.length < 3 || parts.length > 5) {
    throw new Error(`Invalid item "${spec}". Use "name;quantity;unitPrice;vat" or "name;description;quantity;unitPrice;vat".`);
  }

  const hasDescription = parts.length === 5;
  const [name, maybeDescription, maybeQuantity, maybeUnitPrice, maybeVat] = parts;
  const quantity = hasDescription ? maybeQuantity : maybeDescription;
  const unitPrice = hasDescription ? maybeUnitPrice : maybeQuantity;
  const vat = hasDescription ? maybeVat : maybeUnitPrice;

  const item: Record<string, unknown> = {
    name,
    quantity,
    unitPrice,
  };

  if (hasDescription && maybeDescription) item.description = maybeDescription;
  if (vat) {
    item.vatRate = vat;
  }

  return invoiceItemSchema.parse(item);
}
