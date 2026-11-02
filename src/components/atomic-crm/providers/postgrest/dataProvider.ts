import postgrestRestProvider, {
  defaultPrimaryKeys,
  defaultSchema,
} from "@raphiniert/ra-data-postgrest";
import {
  withLifecycleCallbacks,
  type DataProvider,
  type GetListParams,
  type Identifier,
  type ResourceCallbacks,
} from "ra-core";

import type { ConfigurationContextValue } from "../../root/ConfigurationContext";
import type { Deal, SearchResourceName, SearchResult } from "../../types";
import type { CrmDataProvider } from "../supabase/dataProvider";
import { searchDealCategories } from "../supabase/searchDealCategories";
import { getApiUrl, httpClient } from "./httpClient";

// CRM-T1 spike: thin data provider over PostgREST. It only needs the table/view
// names and the JWT; nothing here imports the Supabase client.

const notSupported = (feature: string) => async (): Promise<never> => {
  throw new Error(
    `${feature} is not available with the PostgREST provider (needs core-api)`,
  );
};

const getBaseDataProvider = () =>
  postgrestRestProvider({
    apiUrl: getApiUrl(),
    httpClient,
    defaultListOp: "eq",
    primaryKeys: defaultPrimaryKeys,
    schema: defaultSchema,
    sortOrder: "asc,desc.nullslast" as any,
  });

const getDataProviderWithCustomMethods = () => {
  const base = getBaseDataProvider();

  return {
    ...base,
    async getList(resource: string, params: GetListParams) {
      if (resource === "companies")
        return base.getList("companies_summary", params);
      if (resource === "contacts")
        return base.getList("contacts_summary", params);
      if (resource === "activity_log") {
        const { data, total } = await base.getList("activity_log", params);
        return {
          data: data.map((row: any) => ({
            ...row,
            contactNote: row.contact_note ?? undefined,
            dealNote: row.deal_note ?? undefined,
            contact_note: undefined,
            deal_note: undefined,
          })),
          total,
        };
      }
      return base.getList(resource, params);
    },
    async getOne(resource: string, params: any) {
      if (resource === "companies")
        return base.getOne("companies_summary", params);
      if (resource === "contacts")
        return base.getOne("contacts_summary", params);
      return base.getOne(resource, params);
    },
    // Not available without Supabase Auth / Edge Functions / Storage:
    signUp: notSupported("signUp"),
    salesCreate: notSupported("salesCreate"),
    salesUpdate: notSupported("salesUpdate"),
    updatePassword: notSupported("updatePassword"),
    mergeContacts: notSupported("mergeContacts"),
    async unarchiveDeal(deal: Deal) {
      const { data: deals } = await base.getList<Deal>("deals", {
        filter: { stage: deal.stage },
        pagination: { page: 1, perPage: 1000 },
        sort: { field: "index", order: "ASC" },
      });
      const updatedDeals = deals.map((d, index) => ({
        ...d,
        index: d.id === deal.id ? 0 : index + 1,
        archived_at: d.id === deal.id ? null : d.archived_at,
      }));
      return await Promise.all(
        updatedDeals.map((updatedDeal) =>
          base.update("deals", {
            id: updatedDeal.id,
            data: updatedDeal,
            previousData: deals.find((d) => d.id === updatedDeal.id),
          }),
        ),
      );
    },
    async isInitialized() {
      return true;
    },
    async globalSearch(
      query: string,
      resources: readonly SearchResourceName[],
      maxResults: number,
    ): Promise<SearchResult[]> {
      const { json } = await httpClient(`${getApiUrl()}/rpc/global_search`, {
        method: "POST",
        headers: new Headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ query, resources, max_results: maxResults }),
      });
      return json ?? [];
    },
    async getConfiguration(): Promise<ConfigurationContextValue> {
      const { data } = await base.getOne("configuration", { id: 1 });
      return (data?.config as ConfigurationContextValue) ?? {};
    },
    async updateConfiguration(
      config: ConfigurationContextValue,
    ): Promise<ConfigurationContextValue> {
      const { data } = await base.update("configuration", {
        id: 1,
        data: { config },
        previousData: { id: 1 },
      });
      return data.config as ConfigurationContextValue;
    },
  } satisfies DataProvider;
};

const applyFullTextSearch = (columns: string[]) => (params: GetListParams) => {
  if (!params.filter?.q) return params;
  const { q, ...filter } = params.filter;
  return {
    ...params,
    filter: {
      ...filter,
      "@or": columns.reduce(
        (acc, column) => ({
          ...acc,
          [`${column === "email" ? "email_fts" : column === "phone" ? "phone_fts" : column}@ilike`]:
            q,
        }),
        {},
      ),
    },
  };
};

const lifeCycleCallbacks: ResourceCallbacks[] = [
  {
    resource: "sales",
    beforeGetList: async (params) =>
      applyFullTextSearch(["first_name", "last_name"])(params),
  },
  {
    resource: "contacts",
    beforeGetList: async (params) =>
      applyFullTextSearch([
        "first_name",
        "last_name",
        "company_name",
        "title",
        "email",
        "phone",
        "background",
      ])(params),
  },
  {
    resource: "companies",
    beforeGetList: async (params) =>
      applyFullTextSearch([
        "name",
        "phone_number",
        "website",
        "zipcode",
        "city",
        "state_abbr",
      ])(params),
    beforeCreate: async (params) => ({
      ...params,
      data: { created_at: new Date().toISOString(), ...params.data },
    }),
  },
  {
    resource: "contacts_summary",
    beforeGetList: async (params) =>
      applyFullTextSearch(["first_name", "last_name"])(params),
  },
  {
    resource: "deals",
    beforeGetList: async (params, dataProvider) =>
      searchDealCategories(
        applyFullTextSearch(["name", "description"])(params),
        params.filter?.q,
        dataProvider,
      ),
  },
];

export const getDataProvider = () =>
  withLifecycleCallbacks(
    getDataProviderWithCustomMethods(),
    lifeCycleCallbacks,
  ) as unknown as CrmDataProvider;

export type { Identifier };
