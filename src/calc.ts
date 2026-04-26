import Decimal from "decimal.js";
import type { Client, Config, Invoice, InvoiceItem } from "./schema";
import type { Totals, VatBucket, VatKind } from "./money";
import { formatVat, money } from "./money";

function vatForItem(item: InvoiceItem, client: Client, config: Config): { rate: Decimal; kind: VatKind } {
  if (item.vatRate === "reverse" || client.vatMode === "reverse-charge") {
    return { rate: new Decimal(0), kind: "reverse" };
  }
  if (item.vatRate === "exempt" || client.vatMode === "exempt") {
    return { rate: new Decimal(0), kind: "exempt" };
  }
  return {
    rate: new Decimal(item.vatRate ?? config.tax.defaultVatRate),
    kind: "domestic",
  };
}

export function calculateInvoice(invoice: Invoice, client: Client, config: Config): Totals {
  const lines = invoice.items.map((item) => {
    const quantity = new Decimal(item.quantity);
    const unitPrice = new Decimal(item.unitPrice);
    const { rate, kind } = vatForItem(item, client, config);
    const net = money(quantity.mul(unitPrice));
    const vat = kind === "domestic" ? money(net.mul(rate).div(100)) : money(0);
    const gross = money(net.plus(vat));

    return {
      name: item.name,
      description: item.description,
      quantity,
      unitPrice,
      vatRate: rate,
      vatKind: kind,
      net,
      vat,
      gross,
    };
  });

  const bucketMap = new Map<string, VatBucket>();
  for (const line of lines) {
    const key = `${line.vatKind}:${line.vatRate.toString()}`;
    const current = bucketMap.get(key) ?? {
      key,
      label: formatVat(line.vatRate, line.vatKind),
      vatKind: line.vatKind,
      rate: line.vatRate,
      net: money(0),
      vat: money(0),
      gross: money(0),
    };
    current.net = money(current.net.plus(line.net));
    current.vat = money(current.vat.plus(line.vat));
    current.gross = money(current.gross.plus(line.gross));
    bucketMap.set(key, current);
  }

  const buckets = Array.from(bucketMap.values());
  const net = money(lines.reduce((sum, line) => sum.plus(line.net), new Decimal(0)));
  const vat = money(lines.reduce((sum, line) => sum.plus(line.vat), new Decimal(0)));
  const gross = money(lines.reduce((sum, line) => sum.plus(line.gross), new Decimal(0)));

  return { lines, buckets, net, vat, gross };
}
