import { mergeTranslations } from "ra-core";
import polyglotI18nProvider from "ra-i18n-polyglot";
import englishMessages from "ra-language-english";
import frenchMessages from "ra-language-french";
import { raSupabaseEnglishMessages } from "ra-supabase-language-english";
import { raSupabaseFrenchMessages } from "ra-supabase-language-french";
import { englishCrmMessages } from "./englishCrmMessages";
import { frenchCrmMessages } from "./frenchCrmMessages";
import { spanishCrmMessages } from "./spanishCrmMessages";
import { isPresentationMode } from "../../presentation/presentationMode";
import { PRESENTATION_MESSAGES_ES } from "../../presentation/presentationMessages";
import {
  spanishRaMessages,
  spanishSupabaseMessages,
} from "./spanishBaseMessages";

const raSupabaseEnglishMessagesOverride = {
  "ra-supabase": {
    auth: {
      password_reset: "Check your emails for a Reset Password message.",
    },
    oauth: {
      authorize: "Authorize Application",
      authorize_details: "This application wants to access your account.",
      access_scope:
        "It will be able to read and modify your data, with the same permissions as your account.",
      approved: "Authorization Approved",
      close_tab: "You can now close this tab.",
      no_request: "No authorization request found",
    },
  },
};

const raSupabaseFrenchMessagesOverride = {
  "ra-supabase": {
    auth: {
      password_reset:
        "Consultez vos emails pour trouver le message de reinitialisation du mot de passe.",
    },
    oauth: {
      authorize: "Autoriser l'application",
      authorize_details: "Cette application souhaite accéder à votre compte.",
      access_scope:
        "Elle pourra lire et modifier vos données, avec les mêmes droits que votre compte.",
      approved: "Autorisation accordée",
      close_tab: "Vous pouvez fermer cet onglet.",
      no_request: "Aucune demande d'autorisation trouvée",
    },
  },
};

const englishCatalog = mergeTranslations(
  englishMessages,
  raSupabaseEnglishMessages,
  raSupabaseEnglishMessagesOverride,
  englishCrmMessages,
);

const frenchCatalog = mergeTranslations(
  englishCatalog,
  frenchMessages,
  raSupabaseFrenchMessages,
  raSupabaseFrenchMessagesOverride,
  frenchCrmMessages,
);

const spanishCatalog = mergeTranslations(
  englishCatalog,
  spanishRaMessages,
  spanishSupabaseMessages,
  spanishCrmMessages,
  {
    crm: {
      theme: {
        toggle: "Cambiar tema",
        light: "Claro",
        dark: "Oscuro",
        system: "Sistema",
      },
    },
  },
  // Presentation mode: the words a person says out loud ("negocios", "agenda").
  isPresentationMode() ? PRESENTATION_MESSAGES_ES : {},
);

// Spanish is the default for Salvionix; users can still choose another
// language in their profile and that choice is persisted by react-admin.
export const getInitialLocale = (): "es" => "es";

export const i18nProvider = polyglotI18nProvider(
  (locale) => {
    if (locale === "es") {
      return spanishCatalog;
    }
    if (locale === "fr") {
      return frenchCatalog;
    }
    return englishCatalog;
  },
  getInitialLocale(),
  [
    { locale: "es", name: "Español" },
    { locale: "en", name: "English" },
    { locale: "fr", name: "Français" },
  ],
  { allowMissing: true },
);

export const testI18nProvider = polyglotI18nProvider(
  () => englishCatalog,
  "en",
  [{ locale: "en", name: "English" }],
  { allowMissing: true },
);
