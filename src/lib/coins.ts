/**
 * Well-known ticker → CoinGecko id + display name.
 * Used for popular-coin buttons and offline ticker validation suggestions.
 */

export interface KnownCoin {
  ticker: string;
  display_name: string;
  coingecko_id: string;
}

export const POPULAR_COINS: KnownCoin[] = [
  { ticker: "BTC", display_name: "Bitcoin", coingecko_id: "bitcoin" },
  { ticker: "ETH", display_name: "Ethereum", coingecko_id: "ethereum" },
  { ticker: "TON", display_name: "Toncoin", coingecko_id: "the-open-network" },
];

export const KNOWN_COINS: Record<string, KnownCoin> = {
  BTC: POPULAR_COINS[0]!,
  ETH: POPULAR_COINS[1]!,
  TON: POPULAR_COINS[2]!,
  SOL: { ticker: "SOL", display_name: "Solana", coingecko_id: "solana" },
  BNB: { ticker: "BNB", display_name: "BNB", coingecko_id: "binancecoin" },
  XRP: { ticker: "XRP", display_name: "XRP", coingecko_id: "ripple" },
  ADA: { ticker: "ADA", display_name: "Cardano", coingecko_id: "cardano" },
  DOGE: { ticker: "DOGE", display_name: "Dogecoin", coingecko_id: "dogecoin" },
  AVAX: { ticker: "AVAX", display_name: "Avalanche", coingecko_id: "avalanche-2" },
  DOT: { ticker: "DOT", display_name: "Polkadot", coingecko_id: "polkadot" },
  MATIC: { ticker: "MATIC", display_name: "Polygon", coingecko_id: "matic-network" },
  LINK: { ticker: "LINK", display_name: "Chainlink", coingecko_id: "chainlink" },
  LTC: { ticker: "LTC", display_name: "Litecoin", coingecko_id: "litecoin" },
  ATOM: { ticker: "ATOM", display_name: "Cosmos", coingecko_id: "cosmos" },
  UNI: { ticker: "UNI", display_name: "Uniswap", coingecko_id: "uniswap" },
  NEAR: { ticker: "NEAR", display_name: "NEAR Protocol", coingecko_id: "near" },
  APT: { ticker: "APT", display_name: "Aptos", coingecko_id: "aptos" },
  ARB: { ticker: "ARB", display_name: "Arbitrum", coingecko_id: "arbitrum" },
  OP: { ticker: "OP", display_name: "Optimism", coingecko_id: "optimism" },
  SUI: { ticker: "SUI", display_name: "Sui", coingecko_id: "sui" },
  TRX: { ticker: "TRX", display_name: "TRON", coingecko_id: "tron" },
  SHIB: { ticker: "SHIB", display_name: "Shiba Inu", coingecko_id: "shiba-inu" },
  PEPE: { ticker: "PEPE", display_name: "Pepe", coingecko_id: "pepe" },
  NOT: { ticker: "NOT", display_name: "Notcoin", coingecko_id: "notcoin" },
};

/** Normalize free-text ticker input. */
export function normalizeTicker(raw: string): string {
  return raw.trim().toUpperCase().replace(/^\$/, "");
}

/** Validate ticker shape (2–10 alphanumerics). */
export function isValidTickerShape(ticker: string): boolean {
  return /^[A-Z0-9]{2,10}$/.test(ticker);
}

export function resolveKnown(ticker: string): KnownCoin | undefined {
  return KNOWN_COINS[normalizeTicker(ticker)];
}

export function suggestionList(): string {
  return POPULAR_COINS.map((c) => c.ticker).join(", ");
}
