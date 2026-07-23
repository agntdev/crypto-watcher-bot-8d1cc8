/** Shared UI helpers and copy fragments. */

import {
  inlineButton,
  inlineKeyboard,
  mainMenuKeyboard,
  type InlineKeyboardMarkup,
} from "../toolkit/index.js";
import { POPULAR_COINS } from "./coins.js";

export function backRow(data = "menu:main"): ReturnType<typeof inlineButton>[] {
  return [inlineButton("Back to menu", data)];
}

export function popularCoinKeyboard(
  prefix: string,
  extraRows: ReturnType<typeof inlineButton>[][] = [],
): InlineKeyboardMarkup {
  const popular = POPULAR_COINS.map((c) =>
    inlineButton(c.ticker, `${prefix}:${c.ticker}`),
  );
  return inlineKeyboard([[...popular], ...extraRows, backRow()]);
}

export function mainMenu(): InlineKeyboardMarkup {
  return mainMenuKeyboard();
}

export const COPY = {
  welcome:
    "Crypto Watcher tracks the coins you care about and alerts you on price moves.\n\n" +
    "Pick a popular coin below, or type a ticker (e.g. SOL). Not financial advice.",
  help:
    "Crypto Watcher — personal watchlists and price alerts.\n\n" +
    "• Add Coin — put a ticker on your watchlist\n" +
    "• Manage Alerts — threshold or percent-move rules\n" +
    "• Set Quiet Hours — pause alerts overnight\n" +
    "• Morning Summary — opt-in daily digest\n" +
    "• /price BTC — live price, or /price for your whole list\n\n" +
    "Tap /start for the menu. Not financial advice.",
  emptyWatchlist: "Your watchlist is empty — tap Add Coin to add BTC, ETH, or TON.",
  cancel: "Cancelled. Tap /start whenever you're ready.",
} as const;
