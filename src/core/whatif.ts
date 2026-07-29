import { costForTokens } from "./pricing";
import type { EventRow } from "../adapters/types";

export function whatIfSwap(
  rows: EventRow[],
  targetModel: string,
): { current: number; hypothetical: number; savings: number } {
  let current = 0;
  let hypothetical = 0;
  for (const r of rows) {
    current += r.cost_api;
    hypothetical += costForTokens(targetModel, {
      in: r.in_tokens,
      out: r.out_tokens,
      cacheWrite: r.cache_write,
      cacheRead: r.cache_read,
    });
  }
  return { current, hypothetical, savings: current - hypothetical };
}
