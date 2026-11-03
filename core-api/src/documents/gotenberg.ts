import type { Config } from "../config.ts";

export type RenderPdf = (html: string) => Promise<Buffer>;

export class PdfEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfEngineError";
  }
}

type PdfFetch = (url: string, init: { method: string; body: FormData; signal: AbortSignal }) => Promise<Response>;

/**
 * Turns one self-contained HTML page into a PDF with Gotenberg's Chromium route. The page size and margins
 * come from the template's own `@page` rule, so changing them is a template edit, not a code change.
 */
export const gotenbergRenderer =
  (config: Pick<Config, "GOTENBERG_URL">, send: PdfFetch = (url, init) => fetch(url, init)): RenderPdf =>
  async (html) => {
    const form = new FormData();
    form.append("files", new Blob([html], { type: "text/html" }), "index.html");
    form.append("preferCssPageSize", "true");
    form.append("printBackground", "true");

    let response: Response;
    try {
      response = await send(`${config.GOTENBERG_URL}/forms/chromium/convert/html`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (cause) {
      throw new PdfEngineError(`the PDF engine did not answer (${(cause as Error).name})`);
    }
    if (!response.ok) throw new PdfEngineError(`the PDF engine answered ${response.status}`);

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new PdfEngineError("the PDF engine did not return a PDF");
    return bytes;
  };
