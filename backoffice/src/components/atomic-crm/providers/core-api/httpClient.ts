import { fetchUtils } from "ra-core";

/**
 * The panel only talks to core-api. In development core-api knows who the user is (ADMIN_DEV_SUB);
 * in production the Cloudflare Access cookie travels with the request (CRM-T3), so there is no token
 * in the browser and nothing to store.
 */
export const getCoreApiUrl = (): string =>
  (import.meta.env.VITE_CORE_API_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://127.0.0.1:3000";

export const httpClient = (url: string, options: any = {}) =>
  fetchUtils.fetchJson(url, { ...options, credentials: "include" });
