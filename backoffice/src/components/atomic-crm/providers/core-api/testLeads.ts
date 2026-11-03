import { useSyncExternalStore } from "react";
import type { GetListParams } from "ra-core";

// Test leads ("Prueba X") stay out of the lists, the board and the dashboard unless the user asks to see
// them. The database marks the rows (is_test); this decides whether the panel asks for them.

const STORAGE_KEY = "salvionix.showTestLeads";

/** Lists whose rows carry the mark, as the panel names them. */
const MARKED_RESOURCES = new Set([
  "contacts",
  "contacts_summary",
  "deals",
  "tasks",
  "contact_notes",
  "deal_notes",
  "activity_log",
  "appointments",
]);

/** A list pinned to one record (its tasks, its notes) is that record's own page: it shows what it has. */
const PINNING_FILTERS = ["id", "contact_id", "deal_id", "contact_ids@cs"];

const listeners = new Set<() => void>();

let memory = false;

/** Whether the user asked to see test leads. The choice lives in this browser. */
export const getShowTestLeads = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Private mode: the choice lasts until the page is reloaded.
    return memory;
  }
};

export const setShowTestLeads = (show: boolean): void => {
  memory = show;
  try {
    localStorage.setItem(STORAGE_KEY, show ? "1" : "0");
  } catch {
    // Kept in memory only.
  }
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useShowTestLeads = (): boolean =>
  useSyncExternalStore(subscribe, getShowTestLeads, () => false);

export const excludeTestLeads = (
  resource: string,
  params: GetListParams,
): GetListParams => {
  // A caller that needs every row (the next free position in a column) says so.
  if (params.meta?.includeTestLeads || getShowTestLeads() || !MARKED_RESOURCES.has(resource)) return params;
  const filter = params.filter ?? {};
  if (PINNING_FILTERS.some((key) => filter[key] != null)) return params;
  return { ...params, filter: { ...filter, is_test: false } };
};
