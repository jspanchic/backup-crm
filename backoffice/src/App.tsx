import { CRM } from "@/components/atomic-crm/root/CRM";
import {
  getAuthProvider as getCoreApiAuthProvider,
  getDataProvider as getCoreApiDataProvider,
} from "@/components/atomic-crm/providers/core-api";

/**
 * Application entry point
 *
 * The data provider is chosen by configuration, not by editing CRM.tsx:
 *  - VITE_DATA_PROVIDER=core-api  -> the panel talks to core-api (VITE_CORE_API_URL)
 *  - anything else                -> the original Supabase provider
 *
 * Customize Atomic CRM by passing props to the CRM component:
 *  - companySectors
 *  - darkTheme
 *  - dealCategories
 *  - dealPipelineStatuses
 *  - dealStages
 *  - lightTheme
 *  - darkModeLogo / lightModeLogo
 *  - noteStatuses
 *  - taskTypes
 *  - title
 * ... as well as all the props accepted by shadcn-admin-kit's <Admin> component.
 *
 * Logos must be an imported asset, an absolute URL, or a data URI — never a
 * route-relative path like "./img/logo.png", which breaks on nested routes.
 *
 * @example
 * import logoDark from "./logo-dark.svg";
 * import logoLight from "./logo-light.svg";
 *
 * const App = () => (
 *    <CRM
 *       darkModeLogo={logoDark}
 *       lightModeLogo={logoLight}
 *       title="Acme CRM"
 *    />
 * );
 */
const useCoreApi = import.meta.env.VITE_DATA_PROVIDER === "core-api";

// Built once, outside the component, so a re-render never creates a second provider.
// With the default provider this is empty and CRM builds the Supabase ones itself.
const coreApiProviders = useCoreApi
  ? {
      dataProvider: getCoreApiDataProvider(),
      authProvider: getCoreApiAuthProvider(),
    }
  : {};

const App = () => <CRM {...coreApiProviders} />;

export default App;
