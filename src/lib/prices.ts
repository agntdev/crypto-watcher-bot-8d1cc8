/**
 * CoinGecko price feed — real HTTP contract, retries on failure.
 * Credentials: optional COINGECKO_API_KEY (Demo/Pro header).
 */

import { kvGet, kvSet } from "./kv.js";
import {
  DEFAULT_PRICE_FEED,
  type PriceFeedSettings,
} from "./models.js";
import { KNOWN_COINS, normalizeTicker, resolveKnown } from "./coins.js";

export interface CoinPrice {
  ticker: string;
  coingecko_id: string;
  usd: number;
  change_24h?: number;
}

export interface PriceClient {
  fetchPrices(ids: string[]): Promise<Map<string, { usd: number; change_24h?: number }>>;
  resolveId(ticker: string): Promise<string | null>;
}

const SETTINGS_KEY = "settings:price_feed";

export async function getPriceFeedSettings(): Promise<PriceFeedSettings> {
  const saved = await kvGet<PriceFeedSettings>(SETTINGS_KEY);
  return { ...DEFAULT_PRICE_FEED, ...(saved ?? {}) };
}

export async function setPriceFeedSettings(
  patch: Partial<PriceFeedSettings>,
): Promise<PriceFeedSettings> {
  const next = { ...(await getPriceFeedSettings()), ...patch };
  await kvSet(SETTINGS_KEY, next);
  return next;
}

function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  const key =
    typeof process !== "undefined" && process.env?.COINGECKO_API_KEY
      ? process.env.COINGECKO_API_KEY
      : undefined;
  if (key) {
    // Demo keys use x-cg-demo-api-key; Pro uses x-cg-pro-api-key.
    if (key.startsWith("CG-")) headers["x-cg-pro-api-key"] = key;
    else headers["x-cg-demo-api-key"] = key;
  }
  return headers;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetries(
  url: string,
  retries: number,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchFn(url, { headers: apiHeaders() });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`price feed HTTP ${res.status}`);
        if (attempt < retries) {
          await sleep(200 * (attempt + 1));
          continue;
        }
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(200 * (attempt + 1));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

let fetchFn: typeof globalThis.fetch = globalThis.fetch.bind(globalThis);

/** Test seam for the underlying fetch. */
export function setFetch(fn: typeof globalThis.fetch | null): void {
  fetchFn = fn ?? globalThis.fetch.bind(globalThis);
}

const defaultClient: PriceClient = {
  async fetchPrices(ids: string[]) {
    const out = new Map<string, { usd: number; change_24h?: number }>();
    if (ids.length === 0) return out;

    const settings = await getPriceFeedSettings();
    // Chunk to stay within URL length / rate limits.
    const chunkSize = 50;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const params = new URLSearchParams({
        ids: chunk.join(","),
        vs_currencies: settings.vs_currency,
        include_24hr_change: "true",
      });
      const url = `${settings.base_url.replace(/\/$/, "")}/simple/price?${params}`;
      const res = await fetchWithRetries(url, settings.retries);
      if (!res.ok) {
        // Silent retry path exhausted — callers surface a friendly error.
        throw new Error(`price feed HTTP ${res.status}`);
      }
      const data = (await res.json()) as Record<
        string,
        { usd?: number; usd_24h_change?: number }
      >;
      for (const id of chunk) {
        const row = data[id];
        if (row && typeof row.usd === "number") {
          out.set(id, {
            usd: row.usd,
            change_24h:
              typeof row.usd_24h_change === "number" ? row.usd_24h_change : undefined,
          });
        }
      }
    }
    return out;
  },

  async resolveId(ticker: string) {
    const t = normalizeTicker(ticker);
    const known = resolveKnown(t);
    if (known) return known.coingecko_id;

    const settings = await getPriceFeedSettings();
    const params = new URLSearchParams({ query: t });
    const url = `${settings.base_url.replace(/\/$/, "")}/search?${params}`;
    try {
      const res = await fetchWithRetries(url, settings.retries);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        coins?: Array<{ id: string; symbol: string; name: string; market_cap_rank?: number }>;
      };
      const coins = data.coins ?? [];
      const exact = coins.find((c) => c.symbol.toUpperCase() === t);
      if (exact) return exact.id;
      return coins[0]?.id ?? null;
    } catch {
      return null;
    }
  },
};

let client: PriceClient = defaultClient;

export function setPriceClient(c: PriceClient | null): void {
  client = c ?? defaultClient;
}

export function getPriceClient(): PriceClient {
  return client;
}

/** Resolve ticker to a coingecko id (known map first, then search API). */
export async function resolveCoingeckoId(ticker: string): Promise<string | null> {
  return client.resolveId(ticker);
}

/**
 * Fetch USD prices for tickers. Returns prices keyed by uppercase ticker.
 * Unknown / unresolvable tickers are omitted.
 */
export async function getPricesForTickers(
  tickers: string[],
): Promise<Map<string, CoinPrice>> {
  const unique = [...new Set(tickers.map(normalizeTicker))];
  const idByTicker = new Map<string, string>();

  for (const t of unique) {
    const known = KNOWN_COINS[t];
    if (known) {
      idByTicker.set(t, known.coingecko_id);
      continue;
    }
    const id = await client.resolveId(t);
    if (id) idByTicker.set(t, id);
  }

  const ids = [...new Set(idByTicker.values())];
  const byId = await client.fetchPrices(ids);
  const out = new Map<string, CoinPrice>();
  for (const [ticker, id] of idByTicker) {
    const row = byId.get(id);
    if (!row) continue;
    out.set(ticker, {
      ticker,
      coingecko_id: id,
      usd: row.usd,
      change_24h: row.change_24h,
    });
  }
  return out;
}

export function formatUsd(n: number): string {
  if (n >= 1000) {
    return n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    });
  }
  if (n >= 1) {
    return `$${n.toFixed(2)}`;
  }
  if (n >= 0.01) {
    return `$${n.toFixed(4)}`;
  }
  return `$${n.toPrecision(4)}`;
}

export function formatChange(change?: number): string {
  if (change === undefined || Number.isNaN(change)) return "n/a";
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toFixed(2)}%`;
}
