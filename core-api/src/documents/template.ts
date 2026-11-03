/**
 * The whole template language: `{{ path.to.field }}`. The value is HTML-escaped and put in place. There are no
 * conditions, loops or code, so a template is plain HTML that JM can edit without a developer.
 *
 * It fails loudly instead of printing a blank: a mistyped field, or a `{{` that is not a field, stops the
 * rendering. These documents are commitments to a customer, so a hole must never reach one silently.
 */

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\s*\}\}/g;

export type View = { [key: string]: string | View };

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

const escapeHtml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const lookup = (view: View, path: string): string => {
  let current: string | View = view;
  for (const key of path.split(".")) {
    if (typeof current === "string" || !Object.hasOwn(current, key)) throw new TemplateError(`unknown field {{${path}}}`);
    current = current[key];
  }
  if (typeof current !== "string") throw new TemplateError(`{{${path}}} is a group of fields, not a value`);
  return current;
};

/** Every field a template uses, in order of appearance and without repeats. */
export const fieldsOf = (source: string): string[] => [...new Set([...source.matchAll(PLACEHOLDER)].map((match) => match[1]))];

export const renderTemplate = (source: string, view: View): string => {
  // Checked on the template itself, before any value goes in: a customer's name may contain anything.
  const stray = source.replace(PLACEHOLDER, "").indexOf("{{");
  if (stray !== -1) throw new TemplateError(`a "{{" that is not a field in the template`);
  return source.replace(PLACEHOLDER, (_all, path: string) => escapeHtml(lookup(view, path)));
};
