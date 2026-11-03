// Creates or completes infra/local/.env. Existing values are never changed and no value is printed.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(import.meta.dirname, "../../infra/local");
const target = resolve(dir, ".env");
const lines = (path: string) => readFileSync(path, "utf8").split(/\r?\n/).filter((line) => /^[A-Z0-9_]+=/.test(line));

const current = new Map(existsSync(target) ? lines(target).map((line) => [line.split("=")[0], line]) : []);
const added: string[] = [];
for (const line of lines(resolve(dir, ".env.example"))) {
  const name = line.split("=")[0];
  if (current.has(name)) continue;
  current.set(name, line.endsWith("=") ? `${line}${randomBytes(32).toString("hex")}` : line);
  added.push(name);
}

writeFileSync(target, `${[...current.values()].join("\n")}\n`, { mode: 0o600 });
console.log(added.length ? `infra/local/.env: added ${added.join(", ")}` : "infra/local/.env is complete");
