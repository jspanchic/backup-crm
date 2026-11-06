/**
 * One format for every amount of the panel in presentation mode: dollar sign first, thousands with a comma, no
 * decimals unless there are some ($1,450 · $780 · $20.16).
 */
export const formatUsd = (value: number | null | undefined): string =>
  `$${Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
