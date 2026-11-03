import type { AuthProvider } from "ra-core";

import { canAccess } from "../commons/canAccess";
import { getCoreApiUrl, httpClient } from "./httpClient";

type Session = {
  id: number;
  first_name: string;
  last_name: string;
  avatar?: { src?: string } | null;
  administrator: boolean;
};

// core-api decides who the user is. The panel only asks, once, and remembers the answer.
let session: Promise<Session | undefined> | undefined;

const getSession = (): Promise<Session | undefined> => {
  session ??= httpClient(`${getCoreApiUrl()}/admin/session`, {})
    .then(({ json }) => json as Session)
    .catch(() => {
      session = undefined;
      return undefined;
    });
  return session;
};

export const getAuthProvider = (): AuthProvider => ({
  login: async () => undefined,
  logout: async () => {
    session = undefined;
  },
  checkAuth: async () => {
    if (!(await getSession())) throw new Error("Not signed in");
  },
  checkError: async (error) => {
    if (error?.status === 401) throw new Error("Unauthorized");
  },
  getPermissions: async () => undefined,
  getIdentity: async () => {
    const current = await getSession();
    if (!current) throw new Error("No session");
    return {
      id: current.id,
      fullName: `${current.first_name} ${current.last_name}`,
      avatar: current.avatar?.src,
    };
  },
  canAccess: async (params) => {
    const current = await getSession();
    if (!current) return false;
    return canAccess(current.administrator ? "admin" : "user", params);
  },
});
