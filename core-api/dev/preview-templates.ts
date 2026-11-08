// Renders the three templates with sample data, so a template can be tried without issuing a document.
// Usage: npm run docs:preview   (Gotenberg must be up: npm run local:up)
// Writes .data/preview/<type>.pdf. Set TEMPLATES_DIR to preview a folder other than core-api/templates.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DEFAULT_TEMPLATES_DIR } from "../src/documents/service.ts";
import { gotenbergRenderer } from "../src/documents/gotenberg.ts";
import { renderTemplate } from "../src/documents/template.ts";
import { buildView, DOCUMENT_TYPES, type Settings } from "../src/documents/view.ts";
import { sampleRenderData } from "./sample-document.ts";

const dir = process.env.TEMPLATES_DIR ?? DEFAULT_TEMPLATES_DIR;
const out = resolve(import.meta.dirname, "../.data/preview");
const render = gotenbergRenderer({ GOTENBERG_URL: process.env.GOTENBERG_URL ?? `http://127.0.0.1:${process.env.GOTENBERG_PORT ?? 13302}` });
const settings = JSON.parse(await readFile(join(dir, "settings.json"), "utf8")) as Settings;

await mkdir(out, { recursive: true });
let failed = 0;
for (const type of DOCUMENT_TYPES) {
  try {
    const data = sampleRenderData({ document_type: type });
    const html = renderTemplate(await readFile(join(dir, `${type}.html`), "utf8"), buildView(data, settings));
    const pdf = await render(html);
    await writeFile(join(out, `${type}.pdf`), pdf);
    console.log(`✅ ${type}.html → ${join(out, `${type}.pdf`)} (${pdf.length} bytes)`);
  } catch (error) {
    failed++;
    console.error(`❌ ${type}.html: ${(error as Error).message}`);
  }
}
process.exitCode = failed ? 1 : 0;
