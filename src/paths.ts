import fs from "node:fs";
import path from "node:path";

export type WorkspacePaths = {
  root: string;
  config: string;
  clientsDir: string;
  invoicesDir: string;
  draftsDir: string;
  outDir: string;
};

export function resolveWorkspace(root?: string): WorkspacePaths {
  const resolvedRoot = path.resolve(root ?? process.cwd());
  return {
    root: resolvedRoot,
    config: path.join(resolvedRoot, "invoice.config.yaml"),
    clientsDir: path.join(resolvedRoot, "clients"),
    invoicesDir: path.join(resolvedRoot, "invoices"),
    draftsDir: path.join(resolvedRoot, "drafts"),
    outDir: path.join(resolvedRoot, "out"),
  };
}

export function ensureWorkspaceDirs(paths: WorkspacePaths): void {
  for (const dir of [paths.clientsDir, paths.invoicesDir, paths.draftsDir, paths.outDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
