import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { DATA_DIR, ensureDataDir } from "../config";
import fallback from "../data/pricing-fallback.json";
import type { UsageEvent } from "../adapters/types";

export type ModelPrice = {
  input: number; // USD per token
  output: number;
  cacheWrite: number;
  cacheRead: number;
};

type LiteLLMRow = {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
};

let prices: Map<string, ModelPrice> | null = null;
let unpriced = new Set<string>();

function pricingCachePath() {
  return join(DATA_DIR, "pricing.json");
}

export function loadPricing(forceRefresh = false): Map<string, ModelPrice> {
  if (prices && !forceRefresh) return prices;

  let raw: Record<string, LiteLLMRow> = fallback as Record<string, LiteLLMRow>;
  try {
    ensureDataDir();
    const cachePath = pricingCachePath();
    if (!forceRefresh && existsSync(cachePath)) {
      try {
        raw = JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, LiteLLMRow>;
      } catch {
        raw = fallback as Record<string, LiteLLMRow>;
      }
    }
  } catch {
    // Offline / no home dir write access — use bundled fallback
    raw = fallback as Record<string, LiteLLMRow>;
  }

  prices = indexPrices(raw);
  unpriced = new Set();
  return prices;
}

export async function refreshPricing(): Promise<boolean> {
  try {
    const res = await fetch(
      "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
      { signal: AbortSignal.timeout(12_000) },
    );
    if (!res.ok) return false;
    const raw = (await res.json()) as Record<string, LiteLLMRow>;
    ensureDataDir();
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(pricingCachePath(), JSON.stringify(raw));
    prices = indexPrices(raw);
    unpriced = new Set();
    return true;
  } catch {
    loadPricing();
    return false;
  }
}

function indexPrices(raw: Record<string, LiteLLMRow>): Map<string, ModelPrice> {
  const map = new Map<string, ModelPrice>();
  for (const [key, row] of Object.entries(raw)) {
    if (!row || typeof row !== "object") continue;
    const input = row.input_cost_per_token ?? 0;
    const output = row.output_cost_per_token ?? 0;
    if (input === 0 && output === 0) continue;
    const price: ModelPrice = {
      input,
      output,
      cacheWrite: row.cache_creation_input_token_cost ?? input * 1.25,
      cacheRead: row.cache_read_input_token_cost ?? input * 0.1,
    };
    map.set(key.toLowerCase(), price);
    // Also index bare model id after provider prefix
    const slash = key.lastIndexOf("/");
    if (slash >= 0) map.set(key.slice(slash + 1).toLowerCase(), price);
    if (key.startsWith("anthropic.")) {
      map.set(key.slice("anthropic.".length).toLowerCase(), price);
    }
  }
  return map;
}

export function lookupPrice(model: string): ModelPrice | null {
  const map = loadPricing();
  const key = model.toLowerCase();
  if (map.has(key)) return map.get(key)!;

  // Strip date suffixes and variant tags
  const stripped = key
    .replace(/-\d{8}$/, "")
    .replace(/-(latest|preview|high|medium|low|max)$/, "");
  if (map.has(stripped)) return map.get(stripped)!;

  // Provider-prefixed keys: anthropic/claude-… or openai/gpt-…
  for (const prefix of ["anthropic/", "openai/", "google/", "bedrock/"]) {
    const candidate = prefix + stripped;
    if (map.has(candidate)) return map.get(candidate)!;
  }

  return null;
}

export function costForTokens(
  model: string,
  tokens: { in: number; out: number; cacheWrite: number; cacheRead: number },
): number {
  const price = lookupPrice(model);
  if (!price) {
    unpriced.add(model);
    return 0;
  }
  return (
    tokens.in * price.input +
    tokens.out * price.output +
    tokens.cacheWrite * price.cacheWrite +
    tokens.cacheRead * price.cacheRead
  );
}

export function costForEvent(e: UsageEvent): number {
  return costForTokens(e.model, e.tokens);
}

/** What cache reads would have cost if billed as regular input. */
export function cacheSavingsForTokens(model: string, cacheRead: number): number {
  const price = lookupPrice(model);
  if (!price || cacheRead <= 0) return 0;
  const uncached = cacheRead * price.input;
  const cached = cacheRead * price.cacheRead;
  return Math.max(0, uncached - cached);
}

export function getUnpricedModels(): string[] {
  return [...unpriced].sort();
}

export function clearUnpriced() {
  unpriced = new Set();
}

/** Reprice a hypothetical model swap over existing token totals. */
export function whatIfCost(
  tokens: { in: number; out: number; cacheWrite: number; cacheRead: number },
  targetModel: string,
): number {
  return costForTokens(targetModel, tokens);
}
