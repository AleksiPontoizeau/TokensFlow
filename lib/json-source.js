import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizeUsage } from "./usage-schema.js";

export async function readJsonUsage(dataFile) {
  const raw = await fs.readFile(dataFile, "utf8");
  return normalizeUsage(JSON.parse(raw));
}

export async function writeJsonUsage(dataFile, usage) {
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, `${JSON.stringify(normalizeUsage(usage), null, 2)}\n`);
}
