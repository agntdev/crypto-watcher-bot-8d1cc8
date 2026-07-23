import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import {
  isValidTickerShape,
  normalizeTicker,
  suggestionList,
} from "../lib/coins.js";
import {
  formatChange,
  formatUsd,
  getPricesForTickers,
} from "../lib/prices.js";
import {
  ensureUser,
  recordNotification,
  saveUser,
} from "../lib/users.js";
import { COPY } from "../lib/ui.js";
import { now } from "../lib/clock.js";

// /price is the free-form price check (spec entry point). Also exposed as a
// main-menu button for button-first access.
registerMainMenuItem({ label: "Prices", data: "price:check", order: 15 });

const composer = new Composer<Ctx>();

async function priceMessageForUser(
  uid: number,
  tickerArg?: string,
): Promise<string> {
  const user = await ensureUser(uid);

  if (tickerArg) {
    const ticker = normalizeTicker(tickerArg);
    if (!isValidTickerShape(ticker)) {
      return `Couldn't find "${tickerArg}". Try ${suggestionList()}.`;
    }
    try {
      const prices = await getPricesForTickers([ticker]);
      const p = prices.get(ticker);
      if (!p) {
        return `Couldn't find "${ticker}". Try ${suggestionList()}, or check the spelling.`;
      }
      user.last_seen_prices[ticker] = p.usd;
      await saveUser(user);
      await recordNotification({
        user_id: uid,
        coin_ticker: ticker,
        alert_type: "price_check",
        trigger_time: now(),
        new_price: p.usd,
      });
      return (
        `${ticker}: ${formatUsd(p.usd)} (${formatChange(p.change_24h)} 24h)\n\n` +
        "Not financial advice."
      );
    } catch {
      return "Couldn't fetch the price right now. Try again in a moment.";
    }
  }

  if (user.watchlist.length === 0) {
    return (
      COPY.emptyWatchlist +
      "\n\nOr try /price BTC for a one-off check."
    );
  }

  try {
    const tickers = user.watchlist.map((w) => w.ticker);
    const prices = await getPricesForTickers(tickers);
    const lines = ["Your watchlist:"];
    for (const w of user.watchlist) {
      const p = prices.get(w.ticker);
      if (!p) {
        lines.push(`• ${w.display_name} (${w.ticker}): unavailable`);
        continue;
      }
      lines.push(
        `• ${w.display_name} (${w.ticker}): ${formatUsd(p.usd)} (${formatChange(p.change_24h)} 24h)`,
      );
      user.last_seen_prices[w.ticker] = p.usd;
    }
    lines.push("", "Not financial advice.");
    await saveUser(user);
    await recordNotification({
      user_id: uid,
      coin_ticker: "*",
      alert_type: "price_check",
      trigger_time: now(),
    });
    return lines.join("\n");
  } catch {
    return "Couldn't fetch prices right now. Try again in a moment.";
  }
}

composer.command("price", async (ctx) => {
  const uid = ctx.from?.id;
  if (!uid) return;
  ctx.session.step = "idle";
  const arg = ctx.match?.trim();
  const text = await priceMessageForUser(uid, arg || undefined);
  await ctx.reply(text, {
    reply_markup: inlineKeyboard([
      [inlineButton("Add Coin", "add_coin:start")],
      [inlineButton("Back to menu", "menu:main")],
    ]),
  });
});

composer.callbackQuery("price:check", async (ctx) => {
  await ctx.answerCallbackQuery();
  const uid = ctx.from?.id;
  if (!uid) return;
  ctx.session.step = "idle";
  const text = await priceMessageForUser(uid);
  try {
    await ctx.editMessageText(text, {
      reply_markup: inlineKeyboard([
        [inlineButton("Add Coin", "add_coin:start")],
        [inlineButton("Back to menu", "menu:main")],
      ]),
    });
  } catch {
    await ctx.reply(text, {
      reply_markup: inlineKeyboard([
        [inlineButton("Add Coin", "add_coin:start")],
        [inlineButton("Back to menu", "menu:main")],
      ]),
    });
  }
});

export default composer;
