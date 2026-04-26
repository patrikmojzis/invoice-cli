import { Command } from "commander";
import { ZodError } from "zod";
import {
  clientsAddCommand,
  clientsListCommand,
  clientsSearchCommand,
  configShowCommand,
  draftCreateCommand,
  exportCommand,
  initCommand,
  invoicesListCommand,
  issueCommand,
  itemsSuggestCommand,
  nextNumberCommand,
  renderCommand,
  validateCommand,
} from "./commands";

const program = new Command();

program
  .name("invoice")
  .description("Agent-friendly invoice CLI.")
  .version("0.1.0")
  .option("--root <dir>", "workspace root", process.cwd());

program
  .command("init")
  .description("Create config, clients, and seed invoices.")
  .option("--force", "overwrite existing seed files")
  .action((options) => initCommand({ ...program.opts(), ...options }));

const config = program.command("config").description("Config commands.");
config.command("show").action(() => configShowCommand(program.opts()));

const clients = program.command("clients").description("Client commands.");
clients.command("list").action(() => clientsListCommand(program.opts()));
clients.command("search <query>").action((query) => clientsSearchCommand(query, program.opts()));
clients.command("add <file>").action((file) => clientsAddCommand(file, program.opts()));

const invoices = program.command("invoices").description("Invoice commands.");
invoices
  .command("list")
  .option("--client <id>", "filter by client")
  .option("--drafts", "include drafts")
  .action((options) => invoicesListCommand({ ...program.opts(), ...options }));

program.command("next-number").action(() => nextNumberCommand(program.opts()));

program
  .command("export")
  .description("Export invoice VAT buckets as CSV or JSON.")
  .option("--period <month>", "issued month YYYY-MM")
  .option("--format <format>", "csv or json", "csv")
  .option("--client <id>", "filter by client")
  .option("--drafts", "include drafts")
  .action((options) => exportCommand({ ...program.opts(), ...options }));

const items = program.command("items").description("Item history commands.");
items
  .command("suggest")
  .option("--client <id>", "filter by client")
  .action((options) => itemsSuggestCommand({ ...program.opts(), ...options }));

const draft = program.command("draft").description("Draft commands.");
draft
  .command("create")
  .requiredOption("--client <id>", "client id")
  .option("--issued <date>", "issue date YYYY-MM-DD")
  .option("--delivered <date>", "delivery date YYYY-MM-DD")
  .option("--due <date>", "due date YYYY-MM-DD")
  .option("--item <spec>", "item: name;quantity;unitPrice;vat or name;description;quantity;unitPrice;vat", (value, previous: string[] = []) => previous.concat(value))
  .option("--output <file>", "draft YAML path")
  .option("--force", "overwrite output draft")
  .action((options) => draftCreateCommand({ ...program.opts(), ...options }));

program.command("validate <file>").action((file) => validateCommand(file, program.opts()));

program
  .command("render <file>")
  .option("--output <file>", "PDF output path")
  .action((file, options) => renderCommand(file, { ...program.opts(), ...options }));

program
  .command("issue <draftFile>")
  .option("--no-render", "do not render PDF")
  .action((file, options) => issueCommand(file, { ...program.opts(), noRender: options.render === false }));

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof ZodError
    ? error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("\n")
    : error instanceof Error
      ? error.message
      : String(error);
  console.error(`error: ${message}`);
  process.exitCode = 1;
});
