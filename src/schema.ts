import { z } from "zod";

const requiredString = z.string().trim().min(1);
const optionalString = z.string().trim().optional();
const isoDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Expected real calendar date");
const decimalText = z.union([z.number(), z.string().trim()]).transform((value) => String(value).trim());
const percentageNumber = decimalText
  .refine((value) => /^\d+(\.\d+)?$/.test(value), "Expected decimal number")
  .transform(Number)
  .refine((value) => value >= 0 && value <= 100, "Expected value between 0 and 100");
const positiveDecimalText = decimalText
  .refine((value) => /^\d+(\.\d+)?$/.test(value), "Expected positive decimal number")
  .refine((value) => Number(value) > 0, "Expected value greater than 0");
const nonNegativeMoneyText = decimalText
  .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), "Expected money amount with max 2 decimals")
  .refine((value) => Number(value) >= 0, "Expected value greater than or equal to 0");
const currencySchema = z.preprocess((value) => {
  return typeof value === "string" ? value.trim().toUpperCase() : value;
}, z.literal("EUR")).default("EUR");
const nextNumberSchema = z.union([z.number().int().nonnegative(), requiredString])
  .transform(String)
  .refine((value) => /\d+$/.test(value), "Expected invoice number ending with digits");
const paymentSymbolSchema = z.string().trim().regex(/^\d{1,10}$/, "Expected digits only, max 10 characters").optional();
const bicSchema = z.string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value), "Expected valid BIC/SWIFT")
  .optional();

function isValidIban(value: string): boolean {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(compact)) return false;

  const rearranged = `${compact.slice(4)}${compact.slice(0, 4)}`;
  let remainder = 0;
  for (const character of rearranged) {
    const expanded = /[A-Z]/.test(character)
      ? String(character.charCodeAt(0) - 55)
      : character;
    for (const digit of expanded) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

export const vatModeSchema = z.enum(["domestic", "reverse-charge", "exempt"]);
export const vatRateSchema = z.union([
  percentageNumber,
  z.literal("reverse"),
  z.literal("exempt"),
]);

export const addressSchema = z.object({
  street: requiredString,
  postalCode: requiredString,
  city: requiredString,
  country: requiredString,
});

export const sellerSchema = z.object({
  name: requiredString,
  address: addressSchema,
  ico: requiredString,
  dic: optionalString,
  icDph: optionalString,
});

export const clientSchema = z.object({
  id: requiredString,
  name: requiredString,
  address: addressSchema,
  ico: optionalString,
  dic: optionalString,
  icDph: optionalString,
  vatMode: vatModeSchema.default("domestic"),
});

export const configSchema = z.object({
  version: z.literal(1).default(1),
  seller: sellerSchema,
  bank: z.object({
    iban: requiredString.refine(isValidIban, "Expected valid IBAN"),
    swift: bicSchema,
    currency: currencySchema,
  }),
  invoice: z.object({
    nextNumber: nextNumberSchema,
    defaultDueDays: z.number().int().positive().default(14),
    outputDir: requiredString.default("out"),
    filenamePattern: requiredString.refine((value) => value.includes("{number}"), "Expected {number} placeholder").default("Faktura_{number}.pdf"),
    variableSymbolFromNumber: z.boolean().default(true),
  }),
  tax: z.object({
    defaultVatRate: z.number().min(0).max(100).default(23),
    reverseChargeText: requiredString,
  }),
  pdf: z.object({
    language: requiredString.default("sk"),
    showPayBySquare: z.boolean().default(true),
  }).default({
    language: "sk",
    showPayBySquare: true,
  }),
});

export const invoiceItemSchema = z.object({
  name: requiredString,
  description: optionalString,
  quantity: positiveDecimalText,
  unitPrice: nonNegativeMoneyText,
  vatRate: vatRateSchema.optional(),
});

export const invoiceSchema = z.object({
  status: z.enum(["draft", "issued"]).default("draft"),
  number: optionalString,
  variableSymbol: paymentSymbolSchema,
  client: requiredString,
  dates: z.object({
    issued: isoDate,
    delivered: isoDate,
    due: isoDate,
  }),
  payment: z.object({
    method: z.enum(["bank_transfer"]).default("bank_transfer"),
  }).default({ method: "bank_transfer" }),
  items: z.array(invoiceItemSchema).min(1),
  note: optionalString,
});

export type VatMode = z.infer<typeof vatModeSchema>;
export type VatRate = z.infer<typeof vatRateSchema>;
export type Config = z.infer<typeof configSchema>;
export type Client = z.infer<typeof clientSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type InvoiceItem = z.infer<typeof invoiceItemSchema>;
