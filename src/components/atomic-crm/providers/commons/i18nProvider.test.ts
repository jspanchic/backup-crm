import { afterEach, describe, expect, it, vi } from "vitest";
import { getInitialLocale, i18nProvider } from "./i18nProvider";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("i18nProvider", () => {
  it("registers Spanish, English and French", () => {
    expect(i18nProvider.getLocales?.()).toEqual([
      { locale: "es", name: "Español" },
      { locale: "en", name: "English" },
      { locale: "fr", name: "Français" },
    ]);
  });

  it("translates the language key in french", async () => {
    await i18nProvider.changeLocale("fr");

    expect(i18nProvider.translate("crm.language")).toBe("Langue");
  });

  it("translates CRM and authentication labels in Spanish", async () => {
    await i18nProvider.changeLocale("es");

    expect(i18nProvider.translate("crm.language")).toBe("Idioma");
    expect(
      i18nProvider.translate("resources.deals.name", { smart_count: 2 }),
    ).toBe("Oportunidades");
    expect(i18nProvider.translate("ra.auth.password")).toBe("Contraseña");
  });

  it("falls back to English for unknown locales", async () => {
    await i18nProvider.changeLocale("unknown");
    expect(i18nProvider.translate("crm.language")).toBe("Language");
  });

  it("uses customized password reset overrides for en and fr", async () => {
    await i18nProvider.changeLocale("en");
    expect(i18nProvider.translate("ra-supabase.auth.password_reset")).toBe(
      "Check your emails for a Reset Password message.",
    );

    await i18nProvider.changeLocale("fr");
    expect(i18nProvider.translate("ra-supabase.auth.password_reset")).toBe(
      "Consultez vos emails pour trouver le message de reinitialisation du mot de passe.",
    );
  });

  it("translates recently added fr crm keys", async () => {
    await i18nProvider.changeLocale("fr");

    expect(i18nProvider.translate("resources.deals.empty.title")).toBe(
      "Aucune affaire trouvée",
    );
  });

  it("defaults to Spanish regardless of browser language", () => {
    vi.stubGlobal("navigator", {
      language: "fr-FR",
      languages: ["fr-FR", "en-US"],
    });

    expect(getInitialLocale()).toBe("es");
  });
});
