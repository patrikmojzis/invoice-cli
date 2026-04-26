import fs from "node:fs";
import path from "node:path";
import { calculateInvoice } from "./calc";
import { addDays, todayLocalIso } from "./dates";
import { formatCurrency, type VatBucket } from "./money";
import { resolveWorkspace, slugify } from "./paths";
import { renderInvoicePdf } from "./pdf";
import type { Invoice } from "./schema";
import { clientSchema, invoiceSchema } from "./schema";
import {
  initWorkspace,
  listClients,
  listInvoices,
  loadClient,
  loadConfig,
  loadInvoiceFile,
  saveClient,
  saveConfig,
  saveInvoiceFile,
  saveInvoiceFileExclusive,
} from "./store";
import { printTable } from "./table";
import { parseItemSpec } from "./itemSpec";
import { readYamlFile } from "./yaml";

type RootOptions = { root?: string };
type ExportFormat = "csv" | "json";
type ExportRow = {
  source: string;
  number: string;
  status: string;
  clientId: string;
  clientName: string;
  issued: string;
  delivered: string;
  due: string;
  currency: string;
  vatKind: string;
  vatRate: string;
  vatLabel: string;
  net: string;
  vat: string;
  gross: string;
};

function paths(options: RootOptions) {
  return resolveWorkspace(options.root);
}

function invoiceOutputPath(root: ReturnType<typeof resolveWorkspace>, invoice: Invoice, explicit?: string): string {
  if (explicit) return path.resolve(root.root, explicit);
  const config = loadConfig(root);
  const number = invoice.number ?? "DRAFT";
  const filename = config.invoice.filenamePattern.replaceAll("{number}", number);
  return path.join(root.root, config.invoice.outputDir, filename);
}

function uniqueDraftPath(root: ReturnType<typeof resolveWorkspace>, baseName: string): string {
  let candidate = path.join(root.draftsDir, `${baseName}.yaml`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(root.draftsDir, `${baseName}-${index}.yaml`);
    index += 1;
  }
  return candidate;
}

function incrementInvoiceNumber(value: string): string {
  const match = value.match(/^(.*?)(\d+)$/);
  if (!match) {
    throw new Error(`Cannot increment invoice number "${value}". End nextNumber with digits, for example 20260007.`);
  }

  const [, prefix, digits] = match;
  const next = (BigInt(digits) + 1n).toString().padStart(digits.length, "0");
  return `${prefix}${next}`;
}

function variableSymbolFromInvoiceNumber(number: string): string {
  const symbol = number.replace(/\D/g, "");
  if (!/^\d{1,10}$/.test(symbol)) {
    throw new Error(`Cannot derive variable symbol from invoice number "${number}". Use numeric nextNumber or set variableSymbolFromNumber: false.`);
  }
  return symbol;
}

function normalizeExportFormat(format: string | undefined): ExportFormat {
  if (!format) return "csv";
  if (format === "csv" || format === "json") return format;
  throw new Error("Export format must be csv or json.");
}

function assertPeriod(period: string | undefined): void {
  if (period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error("Period must use YYYY-MM format.");
  }
}

function amountText(value: { toFixed(decimalPlaces: number): string }): string {
  return value.toFixed(2);
}

function vatRateText(bucket: VatBucket): string {
  return bucket.vatKind === "domestic" ? bucket.rate.toString() : "0";
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll("\"", "\"\"")}"` : value;
}

function renderCsv(rows: ExportRow[]): string {
  const headers: Array<keyof ExportRow> = [
    "source",
    "number",
    "status",
    "clientId",
    "clientName",
    "issued",
    "delivered",
    "due",
    "currency",
    "vatKind",
    "vatRate",
    "vatLabel",
    "net",
    "vat",
    "gross",
  ];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
}

async function withWorkspaceLock<T>(root: ReturnType<typeof resolveWorkspace>, run: () => Promise<T>): Promise<T> {
  const lockDir = path.join(root.root, ".invoice-generator.lock");
  const started = Date.now();

  while (true) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
      if (code !== "EEXIST") throw error;
      if (Date.now() - started > 5000) {
        throw new Error(`Workspace is locked: ${lockDir}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  try {
    return await run();
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

export function initCommand(options: RootOptions & { force?: boolean }): void {
  const root = paths(options);
  const written = initWorkspace(root, Boolean(options.force));
  if (written.length === 0) {
    console.log("nothing written; workspace already exists");
    return;
  }
  for (const filePath of written) console.log(`created ${path.relative(root.root, filePath)}`);
}

export function configShowCommand(options: RootOptions): void {
  const root = paths(options);
  const config = loadConfig(root);
  console.log(JSON.stringify(config, null, 2));
}

export function clientsListCommand(options: RootOptions): void {
  const root = paths(options);
  const clients = listClients(root);
  console.log(printTable(clients, [
    { header: "id", value: (client) => client.id },
    { header: "name", value: (client) => client.name },
    { header: "vatMode", value: (client) => client.vatMode },
    { header: "ico", value: (client) => client.ico ?? "" },
  ]));
}

export function clientsSearchCommand(query: string, options: RootOptions): void {
  const root = paths(options);
  const needle = query.toLowerCase();
  const clients = listClients(root).filter((client) => {
    return [
      client.id,
      client.name,
      client.ico ?? "",
      client.icDph ?? "",
      client.dic ?? "",
      client.address.city,
    ].some((value) => value.toLowerCase().includes(needle));
  });
  if (clients.length === 0) {
    console.log("no clients found");
    return;
  }
  console.log(printTable(clients, [
    { header: "id", value: (client) => client.id },
    { header: "name", value: (client) => client.name },
    { header: "vatMode", value: (client) => client.vatMode },
    { header: "country", value: (client) => client.address.country },
  ]));
}

export function clientsAddCommand(filePath: string, options: RootOptions): void {
  const root = paths(options);
  const client = clientSchema.parse(readYamlFile(path.resolve(root.root, filePath)));
  saveClient(root, client);
  console.log(`saved clients/${client.id}.yaml`);
}

export function invoicesListCommand(options: RootOptions & { client?: string; drafts?: boolean }): void {
  const root = paths(options);
  const config = loadConfig(root);
  const rows = listInvoices(root, Boolean(options.drafts))
    .filter(({ invoice }) => !options.client || invoice.client === options.client)
    .map(({ filePath, invoice }) => {
      const client = loadClient(root, invoice.client);
      const totals = calculateInvoice(invoice, client, config);
      return {
        file: path.relative(root.root, filePath),
        invoice,
        client,
        total: formatCurrency(totals.gross, config.bank.currency),
      };
    });

  if (rows.length === 0) {
    console.log("no invoices found");
    return;
  }

  console.log(printTable(rows, [
    { header: "number", value: (row) => row.invoice.number ?? "DRAFT" },
    { header: "status", value: (row) => row.invoice.status },
    { header: "client", value: (row) => row.client.name },
    { header: "issued", value: (row) => row.invoice.dates.issued },
    { header: "total", value: (row) => row.total },
    { header: "file", value: (row) => row.file },
  ]));
}

export function exportCommand(options: RootOptions & { period?: string; format?: string; client?: string; drafts?: boolean }): void {
  const root = paths(options);
  const config = loadConfig(root);
  const format = normalizeExportFormat(options.format);
  assertPeriod(options.period);

  const rows = listInvoices(root, Boolean(options.drafts))
    .filter(({ invoice }) => !options.client || invoice.client === options.client)
    .filter(({ invoice }) => !options.period || invoice.dates.issued.startsWith(`${options.period}-`))
    .flatMap(({ filePath, invoice }) => {
      const client = loadClient(root, invoice.client);
      const totals = calculateInvoice(invoice, client, config);
      return totals.buckets.map((bucket) => ({
        source: path.relative(root.root, filePath),
        number: invoice.number ?? "",
        status: invoice.status,
        clientId: client.id,
        clientName: client.name,
        issued: invoice.dates.issued,
        delivered: invoice.dates.delivered,
        due: invoice.dates.due,
        currency: config.bank.currency,
        vatKind: bucket.vatKind,
        vatRate: vatRateText(bucket),
        vatLabel: bucket.label,
        net: amountText(bucket.net),
        vat: amountText(bucket.vat),
        gross: amountText(bucket.gross),
      }));
    });

  console.log(format === "json" ? JSON.stringify(rows, null, 2) : renderCsv(rows));
}

export function nextNumberCommand(options: RootOptions): void {
  console.log(loadConfig(paths(options)).invoice.nextNumber);
}

export function itemsSuggestCommand(options: RootOptions & { client?: string }): void {
  const root = paths(options);
  const config = loadConfig(root);
  const rows = new Map<string, { name: string; description?: string; unitPrice: string; vat: string; count: number }>();

  for (const { invoice } of listInvoices(root, true)) {
    if (options.client && invoice.client !== options.client) continue;
    const client = loadClient(root, invoice.client);
    const totals = calculateInvoice(invoice, client, config);
    invoice.items.forEach((item, index) => {
      const line = totals.lines[index];
      const key = `${item.name}:${item.description ?? ""}`;
      rows.set(key, {
        name: item.name,
        description: item.description,
        unitPrice: item.unitPrice,
        vat: line.vatKind === "domestic" ? line.vatRate.toString() : line.vatKind,
        count: (rows.get(key)?.count ?? 0) + 1,
      });
    });
  }

  const values = Array.from(rows.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  if (values.length === 0) {
    console.log("no item history found");
    return;
  }

  console.log(printTable(values, [
    { header: "name", value: (row) => row.description ? `${row.name} / ${row.description}` : row.name },
    { header: "lastPrice", value: (row) => row.unitPrice },
    { header: "vat", value: (row) => row.vat },
    { header: "seen", value: (row) => String(row.count) },
  ]));
}

export function draftCreateCommand(options: RootOptions & {
  client: string;
  issued?: string;
  delivered?: string;
  due?: string;
  item?: string[];
  output?: string;
  force?: boolean;
}): void {
  const root = paths(options);
  const config = loadConfig(root);
  const client = loadClient(root, options.client);
  const issued = options.issued ?? todayLocalIso();
  const delivered = options.delivered ?? issued;
  const due = options.due ?? addDays(issued, config.invoice.defaultDueDays);
  if (!options.item?.length) throw new Error("At least one --item is required.");
  const items = (options.item ?? []).map(parseItemSpec);

  const invoice = invoiceSchema.parse({
    status: "draft",
    client: client.id,
    dates: { issued, delivered, due },
    items,
  });

  const baseName = options.output ? options.output.replace(/\.ya?ml$/, "") : `${issued.slice(0, 7)}-${slugify(client.id)}`;
  const outputPath = options.output
    ? path.resolve(root.root, options.output)
    : uniqueDraftPath(root, baseName);

  if (fs.existsSync(outputPath) && !options.force) {
    throw new Error(`Draft exists: ${outputPath}. Use --force to overwrite.`);
  }

  saveInvoiceFile(outputPath, invoice);
  const totals = calculateInvoice(invoice, client, config);
  console.log(`created ${path.relative(root.root, outputPath)}`);
  console.log(`subtotal: ${formatCurrency(totals.net, config.bank.currency)}`);
  console.log(`vat:      ${formatCurrency(totals.vat, config.bank.currency)}`);
  console.log(`total:    ${formatCurrency(totals.gross, config.bank.currency)}`);
}

export function validateCommand(filePath: string, options: RootOptions): void {
  const root = paths(options);
  const config = loadConfig(root);
  const invoice = loadInvoiceFile(path.resolve(root.root, filePath));
  const client = loadClient(root, invoice.client);
  const totals = calculateInvoice(invoice, client, config);

  if (invoice.status === "issued" && !invoice.number) throw new Error("Issued invoice is missing number.");
  if (invoice.status === "draft" && invoice.number) throw new Error("Draft must not have a final invoice number.");

  console.log("ok");
  console.log(`client: ${client.name}`);
  console.log(`invoiceNumber: ${invoice.number ?? `next available: ${config.invoice.nextNumber}`}`);
  console.log(`total: ${formatCurrency(totals.gross, config.bank.currency)}`);
}

export async function renderCommand(filePath: string, options: RootOptions & { output?: string }): Promise<void> {
  const root = paths(options);
  const config = loadConfig(root);
  const invoice = loadInvoiceFile(path.resolve(root.root, filePath));
  const client = loadClient(root, invoice.client);
  const outputPath = invoiceOutputPath(root, invoice, options.output);

  await renderInvoicePdf(invoice, client, config, outputPath);
  console.log(`rendered ${path.relative(root.root, outputPath)}`);
}

export async function issueCommand(filePath: string, options: RootOptions & { noRender?: boolean }): Promise<void> {
  const root = paths(options);
  const issued = await withWorkspaceLock(root, async () => {
    const config = loadConfig(root);
    const sourcePath = path.resolve(root.root, filePath);
    const draft = loadInvoiceFile(sourcePath);
    if (draft.status !== "draft") throw new Error("Only drafts can be issued.");

    const number = config.invoice.nextNumber;
    const invoice = invoiceSchema.parse({
      ...draft,
      status: "issued",
      number,
      variableSymbol: config.invoice.variableSymbolFromNumber ? variableSymbolFromInvoiceNumber(number) : draft.variableSymbol,
    });
    const targetPath = path.join(root.invoicesDir, `${number}.yaml`);
    if (fs.existsSync(targetPath)) throw new Error(`Invoice already exists: invoices/${number}.yaml`);

    saveInvoiceFileExclusive(targetPath, invoice);
    config.invoice.nextNumber = incrementInvoiceNumber(number);
    saveConfig(root, config);

    return { config, invoice, targetPath };
  });

  console.log(`issued ${path.relative(root.root, issued.targetPath)}`);
  console.log(`number: ${issued.invoice.number ?? ""}`);
  console.log(`variableSymbol: ${issued.invoice.variableSymbol ?? ""}`);

  if (!options.noRender) {
    const client = loadClient(root, issued.invoice.client);
    const outputPath = invoiceOutputPath(root, issued.invoice);
    await renderInvoicePdf(issued.invoice, client, issued.config, outputPath);
    console.log(`rendered ${path.relative(root.root, outputPath)}`);
  }
}
