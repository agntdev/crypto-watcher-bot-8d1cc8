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
  resolveKnown,
  suggestionList,
} from "../lib/coins.js";
import { resolveCoingeckoId } from "../lib/prices.js";
import { addWatchlistItem, ensureUser, getUser } from "../lib/users.js";
import { popularCoinKeyboard, COPY } from "../lib/ui.js";

registerMainMenuItem({ label: "Add Coin", data: "add_coin:start", order: 10 });

const composer = new Composer<Ctx>();

function promptKeyboard() {
  return popularCoinKeyboard("add_coin:pick", [
    [inlineButton("Cancel", "add_coin:cancel")],
  ]);
}

const ADD_PROMPT =
  "Add a coin to your watchlist.\n\n" +
  "Tap BTC, ETH, or TON — or type a ticker (e.g. SOL).";

composer.callbackQuery("add_coin:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.from?.id) await ensureUser(ctx.from.id);
  ctx.session.step = "awaiting_coin";
  ctx.session.draft_ticker = undefined;
  ctx.session.draft_coingecko_id = undefined;
  try {
    await ctx.editMessageText(ADD_PROMPT, { reply_markup: promptKeyboard() });
  } catch {
    await ctx.reply(ADD_PROMPT, { reply_markup: promptKeyboard() });
  }
});

composer.callbackQuery("add_coin:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  ctx.session.draft_ticker = undefined;
  await ctx.reply(COPY.cancel, {
    reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]),
  });
});

composer.callbackQuery(/^add_coin:pick:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const ticker = normalizeTicker(ctx.match![1] ?? "");
  const known = resolveKnown(ticker);
  if (!known) {
    await ctx.reply(
      `Couldn't add that coin. Try ${suggestionList()}.`,
      { reply_markup: promptKeyboard() },
    );
    return;
  }
  const uid = ctx.from?.id;
  if (!uid) return;
  await addWatchlistItem(uid, {
    ticker: known.ticker,
    display_name: known.display_name,
    coingecko_id: known.coingecko_id,
  });
  ctx.session.step = "idle";
  const user = await getUser(uid);
  const list =
    user?.watchlist.map((w) => `• ${w.display_name} (${w.ticker})`).join("\n") ??
    "";
  await ctx.reply(
    `Added ${known.display_name} (${known.ticker}) to your watchlist.\n\n${list}`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Add another", "add_coin:start")],
        [inlineButton("Back to menu", "menu:main")],
      ]),
    },
  );
});

async function finishAdd(
  ctx: Ctx,
  ticker: string,
  displayName: string,
  coingeckoId?: string,
) {
  const uid = ctx.from?.id;
  if (!uid) return;
  await addWatchlistItem(uid, {
    ticker,
    display_name: displayName,
    coingecko_id: coingeckoId,
  });
  ctx.session.step = "idle";
  ctx.session.draft_ticker = undefined;
  ctx.session.draft_coingecko_id = undefined;
  const user = await getUser(uid);
  const list =
    user?.watchlist.map((w) => `• ${w.display_name} (${w.ticker})`).join("\n") ??
    "";
  await ctx.reply(`Added ${displayName} (${ticker}) to your watchlist.\n\n${list}`, {
    reply_markup: inlineKeyboard([
      [inlineButton("Add another", "add_coin:start")],
      [inlineButton("Manage Alerts", "alerts:manage")],
      [inlineButton("Back to menu", "menu:main")],
    ]),
  });
}

composer.on("message:text", async (ctx, next) => {
  const step = ctx.session.step;
  if (step !== "awaiting_coin" && step !== "awaiting_display_name") {
    return next();
  }

  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return next();

  if (text.toLowerCase() === "cancel") {
    ctx.session.step = "idle";
    await ctx.reply(COPY.cancel);
    return;
  }

  if (step === "awaiting_display_name") {
    const ticker = ctx.session.draft_ticker;
    if (!ticker) {
      ctx.session.step = "idle";
      return next();
    }
    const name = text.slice(0, 40);
    if (name.length < 1) {
      await ctx.reply("Send a short display name, or type the ticker again.");
      return;
    }
    await finishAdd(ctx, ticker, name, ctx.session.draft_coingecko_id);
    return;
  }

  // awaiting_coin
  const ticker = normalizeTicker(text);
  if (!isValidTickerShape(ticker)) {
    await ctx.reply(
      `That doesn't look like a ticker. Try ${suggestionList()}, or type Cancel.`,
    );
    return;
  }

  const known = resolveKnown(ticker);
  if (known) {
    await finishAdd(ctx, known.ticker, known.display_name, known.coingecko_id);
    return;
  }

  // Resolve via price feed search when possible.
  let cgId: string | null = null;
  try {
    cgId = await resolveCoingeckoId(ticker);
  } catch {
    cgId = null;
  }

  if (!cgId) {
    await ctx.reply(
      `Couldn't find "${ticker}". Try ${suggestionList()}, or check the spelling.`,
    );
    return;
  }

  // Ask for display name for unknown tickers.
  ctx.session.draft_ticker = ticker;
  ctx.session.draft_coingecko_id = cgId;
  ctx.session.step = "awaiting_display_name";
  await ctx.reply(
    `Found ${ticker}. Send a display name (e.g. "Solana"), or send ${ticker} to use the ticker as the name.`,
  );
});

export default composer;
