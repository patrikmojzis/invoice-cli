import fs from "node:fs";
import path from "node:path";
import pdfMake from "pdfmake";
import QRCode from "qrcode";
import { CurrencyCode, decode as decodePayBySquare, encode as encodePayBySquare, PaymentOptions } from "bysquare/pay";
import { Version } from "bysquare";
import type { Client, Config, Invoice } from "./schema";
import { calculateInvoice } from "./calc";
import { compactDate, formatDateSk } from "./dates";
import { formatCurrency, formatMoney, formatQuantity } from "./money";

type PdfCell = string | Record<string, unknown>;
type PayBySquareQr = {
  qrString: string;
  svg: string;
};

const theme = {
  color: {
    ink: "#202124",
    muted: "#5f6368",
    subtle: "#9aa0a6",
    line: "#dadce0",
    lineStrong: "#3c4043",
    surface: "#f8f9fa",
    surfaceStrong: "#f8f9fa",
  },
  font: {
    footer: 7,
    tiny: 8,
    label: 9,
    body: 10,
    emphasis: 11,
    title: 16,
  },
  space: {
    row: 5,
    rowTight: 3,
    section: 24,
    panelX: 14,
    panelY: 12,
    tableY: 6,
    summaryY: 4,
    totalY: 7,
  },
  line: {
    thin: 0.55,
    normal: 0.7,
    strong: 1,
  },
};

const { color, font, space, line } = theme;
const contentWidth = 511;
const dateBlockWidth = 116;
const paymentBlockGap = 18;
const paymentBoxWidth = contentWidth - dateBlockWidth - paymentBlockGap - 1;
const qrSize = 96;
const summaryWidth = 286;

let fontsReady = false;

function ensureFonts(): void {
  if (fontsReady) return;
  const fontDir = process.env.INVOICE_FONT_DIR ?? path.join(__dirname, "fonts");
  pdfMake.setUrlAccessPolicy(() => false);
  pdfMake.addFonts({
    Roboto: {
      normal: path.join(fontDir, "Roboto-Regular.ttf"),
      bold: path.join(fontDir, "Roboto-Medium.ttf"),
      italics: path.join(fontDir, "Roboto-Italic.ttf"),
      bolditalics: path.join(fontDir, "Roboto-MediumItalic.ttf"),
    },
  });
  fontsReady = true;
}

function taxLine(parts: Array<string | undefined>): string[] {
  return parts.filter((part): part is string => Boolean(part));
}

function sellerTaxLine(config: Config): string[] {
  return taxLine([
    `IČO: ${config.seller.ico}`,
    config.seller.dic ? `DIČ: ${config.seller.dic}` : undefined,
    config.seller.icDph ? `IČ DPH: ${config.seller.icDph}` : undefined,
  ]);
}

function clientTaxLine(client: Client): string[] {
  return taxLine([
    client.ico ? `IČO: ${client.ico}` : undefined,
    client.dic ? `DIČ: ${client.dic}` : undefined,
    client.icDph ? `IČ DPH: ${client.icDph}` : undefined,
  ]);
}

function partyBlock(title: string, name: string, lines: string[], tax: string[]): Record<string, unknown> {
  return {
    stack: [
      { text: title, style: "sectionLabel" },
      { text: name, style: "partyName", margin: [0, 8, 0, 4] },
      ...lines.map((text) => ({ text, margin: [0, 0, 0, space.rowTight] })),
      ...(tax.length
        ? [{
          stack: tax.map((text) => ({ text, color: color.ink, fontSize: font.body, margin: [0, 0, 0, space.rowTight] })),
          margin: [0, space.row, 0, 0],
        }]
        : []),
    ],
  };
}

function sellerBlock(config: Config): Record<string, unknown> {
  return partyBlock(
    "DODÁVATEĽ",
    config.seller.name,
    [
      config.seller.address.street,
      `${config.seller.address.postalCode} ${config.seller.address.city}`,
      config.seller.address.country,
    ],
    sellerTaxLine(config),
  );
}

function clientBlock(client: Client): Record<string, unknown> {
  return partyBlock(
    "ODBERATEĽ",
    client.name,
    [
      client.address.street,
      `${client.address.postalCode} ${client.address.city}`,
      client.address.country,
    ],
    clientTaxLine(client),
  );
}

function detailRows(rows: Array<[string, PdfCell]>): PdfCell[][] {
  return rows.map(([label, value], index) => {
    const bottom = index === rows.length - 1 ? 0 : space.row;
    return [
      { text: label, color: color.muted, fontSize: font.label, margin: [0, 0, 8, bottom] },
      typeof value === "string"
        ? { text: value, fontSize: font.body, margin: [0, 0, 0, bottom] }
        : { fontSize: font.body, margin: [0, 0, 0, bottom], ...value },
    ];
  });
}

function compactDetailRows(rows: Array<[string, PdfCell]>): PdfCell[][] {
  return rows.map(([label, value], index) => {
    const bottom = index === rows.length - 1 ? 0 : space.rowTight;
    return [
      { text: label, color: color.muted, fontSize: font.label, margin: [0, 0, 8, bottom] },
      typeof value === "string"
        ? { text: value, fontSize: font.body, margin: [0, 0, 0, bottom] }
        : { fontSize: font.body, margin: [0, 0, 0, bottom], ...value },
    ];
  });
}

function itemVatText(kind: string, rate: { toString(): string }): string {
  return kind === "domestic" ? rate.toString() : "0";
}

function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, "").toUpperCase();
}

function normalizeBic(bic: string | undefined): string | undefined {
  return bic?.replace(/\s+/g, "").toUpperCase();
}

function assertPaymentSymbol(name: string, value: string | undefined, maxLength: number): void {
  if (value && !new RegExp(`^\\d{1,${maxLength}}$`).test(value)) {
    throw new Error(`${name} must contain digits only and be at most ${maxLength} characters.`);
  }
}

function assertPayBySquareRoundTrip(qrString: string, expected: {
  amount: number;
  iban: string;
  bic: string | undefined;
  variableSymbol: string;
  paymentDueDate: string;
}): void {
  const decoded = decodePayBySquare(qrString);
  const payment = decoded.payments[0];
  const bankAccount = payment?.bankAccounts[0];

  if (!payment || Math.abs((payment.amount ?? 0) - expected.amount) > 0.001) {
    throw new Error("PAY by square round-trip amount mismatch.");
  }
  if (payment.currencyCode !== CurrencyCode.EUR) {
    throw new Error("PAY by square round-trip currency mismatch.");
  }
  if (payment.variableSymbol !== expected.variableSymbol) {
    throw new Error("PAY by square round-trip variable symbol mismatch.");
  }
  if (payment.paymentDueDate !== expected.paymentDueDate) {
    throw new Error("PAY by square round-trip due date mismatch.");
  }
  if (bankAccount?.iban !== expected.iban || bankAccount.bic !== expected.bic) {
    throw new Error("PAY by square round-trip bank account mismatch.");
  }
}

async function qrSvg(invoice: Invoice, config: Config, amount: number): Promise<PayBySquareQr | undefined> {
  if (!config.pdf.showPayBySquare) return undefined;
  const variableSymbol = invoice.variableSymbol ?? invoice.number;
  if (!variableSymbol) return undefined;
  if (config.bank.currency !== CurrencyCode.EUR) {
    throw new Error("PAY by square currently supports only EUR invoices.");
  }

  assertPaymentSymbol("Variable symbol", variableSymbol, 10);
  const iban = normalizeIban(config.bank.iban);
  const bic = normalizeBic(config.bank.swift);
  const paymentDueDate = compactDate(invoice.dates.due);

  const qrString = encodePayBySquare(
    {
      invoiceId: invoice.number,
      payments: [
        {
          type: PaymentOptions.PaymentOrder,
          amount,
          currencyCode: CurrencyCode.EUR,
          paymentDueDate,
          variableSymbol,
          paymentNote: invoice.number ? `Úhrada faktúry: ${invoice.number}` : "Úhrada faktúry",
          beneficiary: {
            name: config.seller.name,
          },
          bankAccounts: [
            {
              iban,
              bic,
            },
          ],
        },
      ],
    },
    {
      deburr: false,
      validate: true,
      version: Version["1.0.0"],
    },
  );

  assertPayBySquareRoundTrip(qrString, {
    amount,
    iban,
    bic,
    variableSymbol,
    paymentDueDate,
  });

  const svg = await QRCode.toString(qrString, {
    type: "svg",
    errorCorrectionLevel: "L",
    margin: 2,
  });

  return { qrString, svg };
}

export async function renderInvoicePdf(
  invoice: Invoice,
  client: Client,
  config: Config,
  outputPath: string,
): Promise<void> {
  ensureFonts();
  const totals = calculateInvoice(invoice, client, config);
  const invoiceNumber = invoice.number ?? "DRAFT";
  const variableSymbol = invoice.variableSymbol ?? invoice.number ?? "";
  const qr = await qrSvg(invoice, config, totals.gross.toNumber());
  const hasReverseCharge = totals.buckets.some((bucket) => bucket.vatKind === "reverse");
  const note = hasReverseCharge ? config.tax.reverseChargeText : invoice.note ?? "";

  const itemRows: PdfCell[][] = [
    [
      { text: "Č.", style: "tableHead" },
      { text: "NÁZOV", style: "tableHead" },
      { text: "MNOŽSTVO", style: "tableHead", alignment: "right" },
      { text: "CENA BEZ DPH", style: "tableHead", alignment: "right" },
      { text: "DPH %", style: "tableHead", alignment: "right" },
      { text: "SPOLU BEZ DPH", style: "tableHead", alignment: "right" },
    ],
    ...totals.lines.map((line, index) => [
      { text: `${index + 1}.`, color: color.muted },
      {
        stack: [
          { text: line.name, bold: true },
          ...(line.description ? [{ text: line.description, color: color.muted, fontSize: font.tiny }] : []),
        ],
      },
      { text: formatQuantity(line.quantity), alignment: "right" },
      { text: formatMoney(line.unitPrice), alignment: "right" },
      { text: itemVatText(line.vatKind, line.vatRate), alignment: "right" },
      { text: formatMoney(line.net), alignment: "right", bold: true },
    ]),
  ];

  const vatRows: PdfCell[][] = [
    [
      { text: "SADZBA DPH", style: "tableHead" },
      { text: "ZÁKLAD", style: "tableHead", alignment: "right" },
      { text: "DPH", style: "tableHead", alignment: "right" },
      { text: "SPOLU", style: "tableHead", alignment: "right" },
    ],
    ...totals.buckets.map((bucket) => [
      bucket.label,
      { text: formatMoney(bucket.net), alignment: "right" },
      { text: formatMoney(bucket.vat), alignment: "right" },
      { text: formatMoney(bucket.gross), alignment: "right" },
    ]),
    [
      { text: "Súčet", bold: true },
      { text: formatMoney(totals.net), alignment: "right", bold: true },
      { text: formatMoney(totals.vat), alignment: "right", bold: true },
      { text: formatMoney(totals.gross), alignment: "right", bold: true },
    ],
  ];

  const docDefinition = {
    pageSize: "A4",
    pageMargins: [42, 40, 42, 44],
    defaultStyle: {
      font: "Roboto",
      fontSize: font.body,
      color: color.ink,
      lineHeight: 1.12,
    },
    styles: {
      title: { fontSize: font.title, bold: true, color: color.ink },
      titleNumber: { fontSize: font.title, bold: true, color: color.ink },
      sectionLabel: { fontSize: font.label, bold: true, color: color.muted, characterSpacing: 0.7 },
      partyName: { fontSize: font.emphasis, bold: true },
      tableHead: { bold: true, fontSize: font.label, color: color.muted },
    },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: invoiceNumber, color: color.muted },
        { text: `Strana ${currentPage}/${pageCount}`, alignment: "right", color: color.muted },
      ],
      fontSize: font.footer,
      margin: [42, 0, 42, 0],
    }),
    content: [
      {
        columns: [
          { text: "Faktúra", style: "title" },
          { text: invoiceNumber, style: "titleNumber", alignment: "right" },
        ],
        margin: [0, 0, 0, 16],
      },
      {
        canvas: [{ type: "line", x1: 0, y1: 0, x2: contentWidth, y2: 0, lineWidth: line.strong, lineColor: color.lineStrong }],
        margin: [0, 0, 0, space.section],
      },
      {
        columns: [
          sellerBlock(config),
          clientBlock(client),
        ],
        columnGap: 34,
        margin: [0, 0, 0, space.section],
      },
      {
        columns: [
          {
            width: dateBlockWidth,
            table: {
              widths: [54, "*"],
              body: compactDetailRows([
                ["Vystavenie", formatDateSk(invoice.dates.issued)],
                ["Dodanie", formatDateSk(invoice.dates.delivered)],
                ["Splatnosť", { text: formatDateSk(invoice.dates.due), bold: true }],
              ]),
            },
            layout: "noBorders",
            margin: [0, space.panelY, 0, 0],
          },
          {
            width: paymentBoxWidth,
            table: {
              widths: [paymentBoxWidth],
              body: [[
                {
                  fillColor: color.surface,
                  margin: [12, 10, 12, 10],
                  columns: [
                    {
                      width: "*",
                      table: {
                        widths: [80, "*"],
                        body: detailRows([
                          ["Spôsob úhrady", "Bankový prevod"],
                          ["Variabilný symbol", { text: variableSymbol, bold: true }],
                          ["IBAN", { text: config.bank.iban, bold: true, noWrap: true }],
                          ["SWIFT", config.bank.swift ?? ""],
                        ]),
                      },
                      layout: "noBorders",
                      margin: [0, 10, 0, 0],
                    },
                    ...(qr ? [{
                      width: qrSize,
                      stack: [
                        { svg: qr.svg, width: qrSize, alignment: "right" },
                        { text: "PAY by square", alignment: "right", fontSize: font.tiny, color: color.subtle, margin: [0, space.rowTight, 0, 0] },
                      ],
                    }] : []),
                  ],
                  columnGap: 14,
                },
              ]],
            },
            layout: {
              hLineWidth: () => line.normal,
              vLineWidth: () => line.normal,
              hLineColor: () => color.line,
              vLineColor: () => color.line,
              paddingLeft: () => 0,
              paddingRight: () => 0,
              paddingTop: () => 0,
              paddingBottom: () => 0,
            },
          },
        ],
        columnGap: paymentBlockGap,
        margin: [0, 0, 0, space.section],
      },
      {
        table: {
          headerRows: 1,
          widths: [22, "*", 58, 78, 40, 82],
          body: itemRows,
        },
        layout: {
          hLineWidth: (index: number) => index === 1 ? line.strong : line.thin,
          vLineWidth: () => 0,
          hLineColor: (index: number) => index === 1 ? color.lineStrong : color.line,
          paddingTop: () => space.tableY,
          paddingBottom: () => space.tableY,
          paddingLeft: () => 0,
          paddingRight: () => 8,
        },
        margin: [0, 0, 0, 22],
      },
      {
        columns: [
          {
            width: "*",
            text: note,
            color: hasReverseCharge ? color.ink : color.muted,
            fontSize: font.body,
            margin: [0, 5, 28, 0],
          },
          {
            width: summaryWidth,
            stack: [
              {
                table: {
                  widths: ["*", 62, 58, 62],
                  body: vatRows,
                },
                layout: {
                  hLineWidth: (index: number) => index === 1 ? line.normal : line.thin,
                  vLineWidth: () => 0,
                  hLineColor: () => color.line,
                  paddingTop: () => space.summaryY,
                  paddingBottom: () => space.summaryY,
                  paddingLeft: () => 0,
                  paddingRight: () => 0,
                },
              },
              {
                table: {
                  widths: ["*", "*"],
                  body: [[
                    { text: "Spolu", bold: true, fontSize: font.emphasis, fillColor: color.surfaceStrong, margin: [10, space.row, 0, space.row] },
                    { text: formatCurrency(totals.gross, config.bank.currency), alignment: "right", bold: true, fontSize: font.emphasis, fillColor: color.surfaceStrong, margin: [0, space.row, 10, space.row] },
                  ]],
                },
                layout: {
                  hLineWidth: () => 0,
                  vLineWidth: () => 0,
                  paddingLeft: () => 0,
                  paddingRight: () => 0,
                  paddingTop: () => 0,
                  paddingBottom: () => 0,
                },
                margin: [0, 8, 0, 0],
              },
            ],
          },
        ],
      },
    ],
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const pdf = pdfMake.createPdf(docDefinition);
  const buffer = await pdf.getBuffer();
  fs.writeFileSync(outputPath, buffer);
}
