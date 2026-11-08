import type { Config } from "./config.ts";
import { phoneFromWahaId } from "./waha.ts";

export type WahaFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal; redirect: "error" },
) => Promise<{ ok: boolean; status: number; body?: { cancel: () => Promise<void> } | null; json?: () => Promise<unknown> }>;

type WahaOperation = "sendSeen" | "startTyping" | "stopTyping" | "sendText" | "sendFile";

export const postWaha = async (
  config: Config, fetch: WahaFetch, operation: WahaOperation, body: Record<string, unknown>, timeoutMs: number,
) => {
  const response = await fetch(`${config.WAHA_BASE_URL}/api/${operation}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.WAHA_API_KEY ? { "X-Api-Key": config.WAHA_API_KEY } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "error",
  });
  // The headers determine the outcome. Release the unused response body and its connection.
  void response.body?.cancel().catch(() => {});
  return response;
};

/** Only accept a matching LID and a real phone that differs from the authenticated account. */
export const resolveWahaLid = async (
  config: Pick<Config, "WAHA_BASE_URL" | "WAHA_API_KEY">, fetch: WahaFetch, session: string, lid: string, ownPhone: string | null,
): Promise<string | null> => {
  const user = /^(\d+)@lid$/.exec(lid)?.[1];
  if (!ownPhone || !user || !/^[A-Za-z0-9_-]{1,100}$/.test(session)) return null;

  try {
    const response = await fetch(`${config.WAHA_BASE_URL}/api/${session}/lids/${user}`, {
      method: "GET",
      headers: config.WAHA_API_KEY ? { "X-Api-Key": config.WAHA_API_KEY } : {},
      signal: AbortSignal.timeout(3_000),
      redirect: "error",
    });
    if (!response.ok || !response.json) {
      void response.body?.cancel().catch(() => {});
      return null;
    }

    const data = await response.json() as { lid?: unknown; pn?: unknown } | null;
    if (data?.lid !== lid || typeof data.pn !== "string") return null;
    const phone = phoneFromWahaId(data.pn);
    // GOWS 2026.9.2 can return its own phone for a LID (fixed in 2026.10.1).
    return phone !== ownPhone ? phone : null;
  } catch {
    return null;
  }
};
