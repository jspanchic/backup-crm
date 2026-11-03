export { getAuthProvider } from "./authProvider";
export { getDataProvider } from "./dataProvider";

/** The conversation, the test-lead switch and the calendar only exist behind core-api. */
export const isCoreApiProvider = (): boolean =>
  import.meta.env.VITE_DATA_PROVIDER === "core-api";
