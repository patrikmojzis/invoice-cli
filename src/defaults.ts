import type { Client, Config, Invoice } from "./schema";

export const defaultConfig: Config = {
  version: 1,
  seller: {
    name: "Demo Dodávateľ, s.r.o.",
    address: {
      street: "Hlavná 1",
      postalCode: "811 01",
      city: "Bratislava",
      country: "Slovenská republika",
    },
    ico: "12345678",
    dic: "2123456789",
    icDph: "SK2123456789",
  },
  bank: {
    iban: "SK71 1100 0000 0012 3456 7890",
    swift: "TATRSKBX",
    currency: "EUR",
  },
  invoice: {
    nextNumber: "20260007",
    defaultDueDays: 14,
    outputDir: "out",
    filenamePattern: "Faktura_{number}.pdf",
    variableSymbolFromNumber: true,
  },
  tax: {
    defaultVatRate: 23,
    reverseChargeText:
      "REVERSE CHARGE - Prenesenie daňovej povinnosti podľa čl. 44 a 196 smernice 2006/112/ES",
  },
  pdf: {
    language: "sk",
    showPayBySquare: true,
  },
};

export const seedClients: Client[] = [
  {
    id: "demo-cz",
    name: "Demo CZ, s.r.o.",
    address: {
      street: "Dlouhá 12",
      postalCode: "150 00",
      city: "Praha",
      country: "Česká republika",
    },
    ico: "87654321",
    dic: "CZ87654321",
    vatMode: "reverse-charge",
  },
  {
    id: "demo-sk",
    name: "Demo SK, s.r.o.",
    address: {
      street: "Obchodná 24",
      postalCode: "811 06",
      city: "Bratislava",
      country: "Slovenská republika",
    },
    ico: "23456789",
    icDph: "SK2123456790",
    vatMode: "domestic",
  },
];

export const seedInvoices: Invoice[] = [
  {
    status: "issued",
    number: "20260005",
    variableSymbol: "20260005",
    client: "demo-cz",
    dates: {
      issued: "2026-04-20",
      delivered: "2026-04-20",
      due: "2026-04-25",
    },
    payment: { method: "bank_transfer" },
    items: [
      {
        name: "Konzultačné služby",
        quantity: "4",
        unitPrice: "320",
        vatRate: "reverse",
      },
    ],
  },
  {
    status: "issued",
    number: "20260006",
    variableSymbol: "20260006",
    client: "demo-sk",
    dates: {
      issued: "2026-03-31",
      delivered: "2026-03-31",
      due: "2026-04-25",
    },
    payment: { method: "bank_transfer" },
    items: [
      {
        name: "Vývoj softvéru",
        quantity: "6",
        unitPrice: "480",
        vatRate: 23,
      },
      {
        name: "Technická podpora",
        description: "Mesačný paušál",
        quantity: "5",
        unitPrice: "24",
        vatRate: 23,
      },
    ],
  },
];
