import { fetchUtils } from "ra-core";

// CRM-T1 spike: the real provider will talk to core-api, which adds the session
// token. Here the token is a locally minted JWT passed through the Vite env.
export const getSpikeToken = (): string => {
  const token = import.meta.env.VITE_SPIKE_TOKEN;
  if (!token) {
    throw new Error("Please set the VITE_SPIKE_TOKEN environment variable");
  }
  return token;
};

export const getApiUrl = (): string => {
  const url = import.meta.env.VITE_POSTGREST_URL;
  if (!url) {
    throw new Error("Please set the VITE_POSTGREST_URL environment variable");
  }
  return url;
};

export const httpClient = (url: string, options: any = {}) => {
  const headers: Headers =
    options.headers instanceof Headers
      ? options.headers
      : new Headers(options.headers ?? {});
  headers.set("Authorization", `Bearer ${getSpikeToken()}`);
  return fetchUtils.fetchJson(url, { ...options, headers });
};
