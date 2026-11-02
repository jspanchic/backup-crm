import { useMemo } from "react";
import { useLocaleState, useStore } from "ra-core";

import type { DealStage, LabeledValue, NoteStatus } from "../types";
import { defaultConfiguration } from "./defaultConfiguration";
import atomicDarkLogo from "./logos/logo_atomic_crm_dark.svg";
import atomicLightLogo from "./logos/logo_atomic_crm_light.svg";
import { localizeConfiguration } from "./localizeConfiguration";
import { adaptLegacyConfiguration } from "./adaptLegacyConfiguration";

export const CONFIGURATION_STORE_KEY = "app.configuration";

export interface ConfigurationContextValue {
  companySectors: LabeledValue[];
  currency: string;
  dealCategories: LabeledValue[];
  dealPipelineStatuses: string[];
  dealStages: DealStage[];
  noteStatuses: NoteStatus[];
  taskTypes: LabeledValue[];
  title: string;
  darkModeLogo: string;
  lightModeLogo: string;
}

export const useConfigurationContext = (localize = true) => {
  const [locale] = useLocaleState();
  const [config] = useStore<ConfigurationContextValue>(
    CONFIGURATION_STORE_KEY,
    defaultConfiguration,
  );
  // Merge with defaults so that missing fields in stored config
  // fall back to default values (e.g. when new settings are added)
  return useMemo(() => {
    const merged = adaptLegacyConfiguration({
      ...defaultConfiguration,
      ...config,
    });
    // Replace only the upstream defaults in existing browser/server settings;
    // any branding deliberately customized by the user remains untouched.
    if (merged.title === "Atomic CRM")
      merged.title = defaultConfiguration.title;
    if (
      merged.darkModeLogo === atomicDarkLogo ||
      merged.darkModeLogo?.includes("logo_atomic_crm_dark")
    )
      merged.darkModeLogo = defaultConfiguration.darkModeLogo;
    if (
      merged.lightModeLogo === atomicLightLogo ||
      merged.lightModeLogo?.includes("logo_atomic_crm_light")
    )
      merged.lightModeLogo = defaultConfiguration.lightModeLogo;
    return localize && (locale === "es" || locale.startsWith("es-"))
      ? localizeConfiguration(merged)
      : merged;
  }, [config, locale, localize]);
};

export const useConfigurationUpdater = () => {
  const [, setConfig] = useStore<ConfigurationContextValue>(
    CONFIGURATION_STORE_KEY,
  );
  return setConfig;
};
