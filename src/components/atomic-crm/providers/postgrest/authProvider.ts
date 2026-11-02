import type { AuthProvider } from "ra-core";

import { canAccess } from "../commons/canAccess";
import { getApiUrl, getSpikeToken, httpClient } from "./httpClient";

// CRM-T1 spike: no login screen. The identity comes from the "sub" claim of the
// token, matched against public.sales.user_id.
const getSale = async () => {
  const [, payload] = getSpikeToken().split(".");
  const { sub } = JSON.parse(
    atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
  );
  const { json } = await httpClient(
    `${getApiUrl()}/sales?user_id=eq.${sub}&select=id,first_name,last_name,avatar,administrator`,
    {},
  );
  return json[0] as
    | {
        id: number;
        first_name: string;
        last_name: string;
        avatar?: { src?: string };
        administrator: boolean;
      }
    | undefined;
};

export const getAuthProvider = (): AuthProvider => ({
  login: async () => undefined,
  logout: async () => undefined,
  checkAuth: async () => {
    getSpikeToken();
  },
  checkError: async (error) => {
    if (error?.status === 401) {
      throw new Error("Unauthorized");
    }
  },
  getPermissions: async () => undefined,
  getIdentity: async () => {
    const sale = await getSale();
    if (sale == null) throw new Error("No sales row for this token");
    return {
      id: sale.id,
      fullName: `${sale.first_name} ${sale.last_name}`,
      avatar: sale.avatar?.src,
    };
  },
  canAccess: async (params) => {
    const sale = await getSale();
    if (sale == null) return false;
    return canAccess(sale.administrator ? "admin" : "user", params);
  },
});
