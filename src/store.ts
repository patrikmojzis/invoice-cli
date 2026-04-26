import fs from "node:fs";
import path from "node:path";
import { defaultConfig, seedClients, seedInvoices } from "./defaults";
import type { Client, Config, Invoice } from "./schema";
import { clientSchema, configSchema, invoiceSchema } from "./schema";
import type { WorkspacePaths } from "./paths";
import { ensureWorkspaceDirs } from "./paths";
import { fileExists, readYamlFile, writeYamlFile } from "./yaml";

export function initWorkspace(paths: WorkspacePaths, force = false): string[] {
  ensureWorkspaceDirs(paths);
  const written: string[] = [];

  const writeSeed = (filePath: string, value: unknown) => {
    if (!force && fileExists(filePath)) return;
    writeYamlFile(filePath, value);
    written.push(filePath);
  };

  writeSeed(paths.config, defaultConfig);
  for (const client of seedClients) {
    writeSeed(path.join(paths.clientsDir, `${client.id}.yaml`), client);
  }
  for (const invoice of seedInvoices) {
    writeSeed(path.join(paths.invoicesDir, `${invoice.number}.yaml`), invoice);
  }

  return written;
}

export function loadConfig(paths: WorkspacePaths): Config {
  if (!fileExists(paths.config)) {
    throw new Error(`Missing config: ${paths.config}. Run: invoice init`);
  }
  return configSchema.parse(readYamlFile(paths.config));
}

export function saveConfig(paths: WorkspacePaths, config: Config): void {
  writeYamlFile(paths.config, config);
}

export function listClients(paths: WorkspacePaths): Client[] {
  if (!fs.existsSync(paths.clientsDir)) return [];
  return fs.readdirSync(paths.clientsDir)
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .sort()
    .map((name) => clientSchema.parse(readYamlFile(path.join(paths.clientsDir, name))));
}

export function loadClient(paths: WorkspacePaths, id: string): Client {
  const filePath = path.join(paths.clientsDir, `${id}.yaml`);
  if (!fileExists(filePath)) {
    throw new Error(`Unknown client: ${id}`);
  }
  return clientSchema.parse(readYamlFile(filePath));
}

export function saveClient(paths: WorkspacePaths, client: Client): void {
  writeYamlFile(path.join(paths.clientsDir, `${client.id}.yaml`), client);
}

export function loadInvoiceFile(filePath: string): Invoice {
  return invoiceSchema.parse(readYamlFile(filePath));
}

export function saveInvoiceFile(filePath: string, invoice: Invoice): void {
  writeYamlFile(filePath, invoice);
}

export function saveInvoiceFileExclusive(filePath: string, invoice: Invoice): void {
  writeYamlFile(filePath, invoice, "wx");
}

export function listInvoices(paths: WorkspacePaths, includeDrafts = false): Array<{ filePath: string; invoice: Invoice }> {
  const dirs = includeDrafts ? [paths.invoicesDir, paths.draftsDir] : [paths.invoicesDir];
  const found: Array<{ filePath: string; invoice: Invoice }> = [];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
      const filePath = path.join(dir, name);
      found.push({ filePath, invoice: loadInvoiceFile(filePath) });
    }
  }

  return found;
}
