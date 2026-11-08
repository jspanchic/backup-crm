import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gotenbergRenderer, PdfEngineError } from "../../src/documents/gotenberg.ts";
import { readStoredFile, saveFile, sha256Of, StoredFileError } from "../../src/documents/store.ts";
import { fieldsOf, renderTemplate, TemplateError } from "../../src/documents/template.ts";
import { sampleRenderData } from "../../dev/sample-document.ts";
import { buildView, DOCUMENT_TYPES, type Settings } from "../../src/documents/view.ts";

const TEMPLATES = join(import.meta.dirname, "../../templates");

const settings = JSON.parse(readFileSync(join(TEMPLATES, "settings.json"), "utf8")) as Settings;

const data = sampleRenderData;

describe("template language", () => {
  it("puts values in place and escapes them", () => {
    const html = renderTemplate("<p>{{ customer.name }}</p>", { customer: { name: `<b>"Ana" & Co</b>` } });
    expect(html).toBe("<p>&lt;b&gt;&quot;Ana&quot; &amp; Co&lt;/b&gt;</p>");
  });

  it("refuses a field that does not exist, instead of printing a blank", () => {
    expect(() => renderTemplate("{{customer.nmae}}", { customer: { name: "Ana" } })).toThrow(TemplateError);
  });

  it("refuses a group used as if it were a value", () => {
    expect(() => renderTemplate("{{customer}}", { customer: { name: "Ana" } })).toThrow(/group of fields/);
  });

  it("refuses a double brace that is not a field, but accepts one inside a name", () => {
    expect(() => renderTemplate("{{ customer.name", { customer: { name: "Ana" } })).toThrow(TemplateError);
    expect(renderTemplate("{{customer.name}}", { customer: { name: "{{x}}" } })).toBe("{{x}}");
  });

  it("does not reach the prototype of the view", () => {
    expect(() => renderTemplate("{{constructor.name}}", {})).toThrow(TemplateError);
  });

  it("lists the fields of a template once each", () => {
    expect(fieldsOf("{{a.b}} {{ a.b }} {{c}}")).toEqual(["a.b", "c"]);
  });
});

describe("what a template can print", () => {
  it("formats the frozen payload in Spanish, in the brand time zone", () => {
    const view = buildView(data(), settings);

    expect(view).toMatchObject({
      document: { number: "COT-000501", type: "Cotización", test_notice: "", issued_date: "1 de junio de 2030" },
      customer: { name: "Ana Gómez" },
      service: { space_type: "Hogar", address: "1 Main St, Orlando, FL 32801" },
      appointment: { date: "3 de junio de 2030", technician: "Luis Pérez" },
      quote: { total: "$221.07", subtotal: "$223.20", covered_area: "1,860 ft²", valid_until: "15 de junio de 2030", price_note: "" },
    });
  });

  it("prints the whole measured area, the discount as a deduction and the tax line with its rate", () => {
    const view = buildView(data(), settings);

    expect(view).toMatchObject({
      quote: { total_area: "1,860 ft²", discount: "-$15.62", discount_class: "", tax_class: "", tax_label: "Impuesto (6.5%)", tax: "$13.49" },
    });
  });

  it("hides the discount row when the brand had the discount off, and when it took nothing off", () => {
    expect(buildView(data({}, { discount_applied: false, discount: 0 }), settings).quote).toMatchObject({ discount_class: "hidden" });
    expect(buildView(data({}, { discount: 0 }), settings).quote).toMatchObject({ discount_class: "hidden" });
    // A quote issued before the switch existed has no flag: the discount it carries is shown.
    const { discount_applied: _flag, tax_pct: _pct, tax: _tax, ...old } = data().payload;
    expect(buildView(data({ payload: old }), settings).quote).toMatchObject({ discount_class: "", tax_class: "hidden" });
  });

  it("hides the tax row in the rendered quote at a zero tax rate", () => {
    const template = readFileSync(join(TEMPLATES, "quote.html"), "utf8");
    const html = renderTemplate(template, buildView(data({}, { tax_pct: 0, tax: 0 }), settings));
    expect(html).toContain('<tr class="hidden"><td>Impuesto (0%)</td>');
  });

  it("renders the approved quote text and the 1,731-square-foot control", () => {
    const template = readFileSync(join(TEMPLATES, "quote.html"), "utf8");
    const quote = data({}, { covered_sqft: 1731, uncovered_sqft: 0, subtotal: 208, discount: 15, total: 193, tax_pct: 0, tax: 0 });
    const html = renderTemplate(template, buildView(quote, settings));
    expect(html).toContain("Salvionix Biosafety Solutions");
    expect(html.split("<footer>")[1]).toContain("<br>bioseguridad.bytogam.com · +1 (630) 234-1555</footer>");
    expect(html).toContain("<td>Descuento</td><td>-$15.00</td>");
    expect(html).toContain("<td>Total</td><td>$193.00</td>");
    expect(html).toContain("transferencia bancaria, Zelle, tarjeta de débito o crédito");
    expect(html).toContain("después del servicio");
    const guarantee = '<p class="terms guarantee">Exige siempre tu servicio con la garantía oficial de Vital Oxide. Solo el servicio contratado por este medio cuenta con respaldo.</p>';
    expect(html).toContain(guarantee);
    expect(html.indexOf(guarantee)).toBeGreaterThan(html.indexOf("después del servicio"));
    expect(html.toLowerCase()).not.toContain("descuento especial");
    expect(html.toLowerCase()).not.toContain("sujeto a revisión");
  });
  it("shows a dash where the data is missing and says the price is not confirmed", () => {
    const view = buildView(data({}, { customer_name: null, service_address: null, appointment_start_at: null, price_confirmed: false }), settings);

    expect(view).toMatchObject({
      customer: { name: "—" },
      service: { address: "—" },
      appointment: { date: "—", start_time: "—" },
      quote: { price_note: "Precios por confirmar." },
    });
  });

  it("marks the documents of test leads", () => {
    expect(buildView(data({ is_test: true }), settings)).toMatchObject({ document: { test_notice: "DOCUMENTO DE PRUEBA — SIN VALOR" } });
  });

  // The guard against the worst template bug: a field that is not in the view fails here, not in front of a customer.
  it.each(DOCUMENT_TYPES)("the %s template renders completely with the fields that exist", (type) => {
    const html = renderTemplate(readFileSync(join(TEMPLATES, `${type}.html`), "utf8"), buildView(data({ document_type: type }), settings));

    expect(html).not.toContain("{{");
    expect(html).toContain("COT-000501");
    expect(html).toContain("Ana Gómez");
  });

  it("has a template for every document type and nothing else", () => {
    expect(readdirSync(TEMPLATES).sort()).toEqual([...DOCUMENT_TYPES.map((type) => `${type}.html`), "settings.json"].sort());
  });

  it("ships with confirmed provisional text and no placeholders in the legal fields", () => {
    expect(settings.confirmed).toBe(true);
    expect(Object.values(settings.legal).join(" ")).not.toContain("[POR CONFIRMAR]");
  });
});

describe("PDF engine client", () => {
  const pdf = Buffer.from("%PDF-1.7 body");

  it("posts the page to the Chromium route of Gotenberg and returns the PDF", async () => {
    let seen: { url: string; form: FormData } | undefined;
    const render = gotenbergRenderer({ GOTENBERG_URL: "http://gotenberg.test" }, async (url, init) => {
      seen = { url, form: init.body };
      return new Response(pdf, { status: 200 });
    });

    const result = await render("<p>hola</p>");

    expect(result.equals(pdf)).toBe(true);
    expect(seen?.url).toBe("http://gotenberg.test/forms/chromium/convert/html");
    expect(await (seen!.form.get("files") as File).text()).toBe("<p>hola</p>");
    expect((seen!.form.get("files") as File).name).toBe("index.html");
    expect(seen!.form.get("preferCssPageSize")).toBe("true");
  });

  it.each([
    ["answers an error", async () => new Response("no", { status: 503 })],
    ["answers something that is not a PDF", async () => new Response("<html>", { status: 200 })],
    [
      "does not answer",
      async () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("fails with a PdfEngineError when the engine %s", async (_name, answer) => {
    await expect(gotenbergRenderer({ GOTENBERG_URL: "http://gotenberg.test" }, answer)("<p/>")).rejects.toBeInstanceOf(PdfEngineError);
  });
});

describe("private file store", () => {
  const bytes = Buffer.from("%PDF-1.7 hello");

  it("names the file after its hash and reads it back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "store-"));

    const saved = await saveFile(dir, bytes);

    expect(saved).toEqual({ sha256: sha256Of(bytes), sizeBytes: bytes.length });
    expect(readdirSync(dir)).toEqual([`${saved.sha256}.pdf`]);
    expect((await readStoredFile(dir, saved.sha256)).equals(bytes)).toBe(true);
  });

  it("never replaces a file that is already there", async () => {
    const dir = mkdtempSync(join(tmpdir(), "store-"));
    const { sha256 } = await saveFile(dir, bytes);
    writeFileSync(join(dir, `${sha256}.pdf`), "tampered");

    await saveFile(dir, bytes);

    expect(readFileSync(join(dir, `${sha256}.pdf`), "utf8")).toBe("tampered");
  });

  it("refuses a file that does not match its name, a missing one, and a name that is not a hash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "store-"));
    const { sha256 } = await saveFile(dir, bytes);
    writeFileSync(join(dir, `${sha256}.pdf`), "tampered");

    await expect(readStoredFile(dir, sha256)).rejects.toThrow(/does not match/);
    await expect(readStoredFile(dir, "0".repeat(64))).rejects.toThrow(/missing/);
    await expect(readStoredFile(dir, "../../etc/passwd")).rejects.toBeInstanceOf(StoredFileError);
  });
});
