import type { Config } from "./config.ts";

export type WahaFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal; redirect: "error" },
) => Promise<{ ok: boolean; status: number; body?: { cancel: () => Promise<void> } | null }>;

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
