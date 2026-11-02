// Creates infra/local/.env with random values. Never overwrites an existing file or prints a value.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(import.meta.dirname, "../../infra/local/.env");
if (existsSync(target)) {
  console.log("infra/local/.env already exists; nothing to do");
  process.exit(0);
}

const example = readFileSync(resolve(import.meta.dirname, "../../infra/local/.env.example"), "utf8");
const lines = example
  .split(/\r?\n/)
  .filter((line) => line.endsWith("="))
  .map((line) => `${line}${randomBytes(32).toString("hex")}`);

writeFileSync(target, `${lines.join("\n")}\n`, { mode: 0o600 });
console.log(`infra/local/.env created with ${lines.length} random values`);
