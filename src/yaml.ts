import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export function readYamlFile<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf8");
  return YAML.parse(raw) as T;
}

export function writeYamlFile(filePath: string, value: unknown, flag: "w" | "wx" = "w"): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const body = YAML.stringify(value, {
    indent: 2,
    lineWidth: 0,
    minContentWidth: 0,
  });
  if (flag === "wx") {
    fs.writeFileSync(filePath, body, { encoding: "utf8", flag });
    return;
  }

  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tempPath, body, "utf8");
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}
