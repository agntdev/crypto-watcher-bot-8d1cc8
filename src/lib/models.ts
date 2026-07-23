/** Domain models for Crypto Watcher — durable entities. */

export interface WatchlistItem {
  ticker: string;
  display_name: string;
  /** CoinGecko coin id when known. */
  coingecko_id?: string;
}

export type AlertType = "threshold" | "percent";
export type ThresholdDirection = "above" | "below";

export interface AlertRule {
  id: string;
  coin_ticker: string;
  alert_type: AlertType;
  /** Absolute USD price for threshold alerts. */
  threshold_price?: number;
  direction?: ThresholdDirection;
  /** Percent move (e.g. 5 = 5%). */
  percent_move?: number;
  /** Lookback window in minutes; default 60. */
  timeframe?: number;
  /** Epoch ms of last successful delivery. */
  last_alert_time?: number;
  /** Price snapshot when the percent window started / last alert. */
  window_anchor_price?: number;
  window_anchor_time?: number;
}

export interface QuietHours {
  /** HH:mm local */
  start: string;
  /** HH:mm local */
  end: string;
  enabled: boolean;
}

export interface UserRecord {
  telegram_id: number;
  watchlist: WatchlistItem[];
  alert_rules: AlertRule[];
  quiet_hours: QuietHours;
  /** Opt-in morning summary local time HH:mm; null/undefined = disabled. */
  summary_time: string | null;
  summary_enabled: boolean;
  /** Minutes east of UTC for local-time interpretation. */
  timezone_offset_minutes: number;
  /** ticker → last observed USD price (for percent-move + summaries). */
  last_seen_prices: Record<string, number>;
  /** Last morning summary send date key YYYY-MM-DD (local). */
  last_summary_date?: string;
  created_at: number;
  updated_at: number;
}

export interface NotificationRecord {
  id: string;
  user_id: number;
  coin_ticker: string;
  alert_type: AlertType | "summary" | "price_check";
  trigger_time: number;
  old_price?: number;
  new_price?: number;
}

/** Alert that fired during quiet hours and is waiting to send. */
export interface QueuedAlert {
  user_id: number;
  rule_id: string;
  coin_ticker: string;
  alert_type: AlertType;
  old_price: number;
  new_price: number;
  queued_at: number;
  message: string;
}

export interface PriceFeedSettings {
  /** Optional CoinGecko base URL override. */
  base_url: string;
  /** vs currency, default usd. */
  vs_currency: string;
  retries: number;
}

export const DEFAULT_QUIET_HOURS: QuietHours = {
  start: "22:00",
  end: "07:00",
  enabled: true,
};

export const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
export const DEFAULT_PERCENT_TIMEFRAME_MIN = 60;

export const DEFAULT_PRICE_FEED: PriceFeedSettings = {
  base_url: "https://api.coingecko.com/api/v3",
  vs_currency: "usd",
  retries: 3,
};
