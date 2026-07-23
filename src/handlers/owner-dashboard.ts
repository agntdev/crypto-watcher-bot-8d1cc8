import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import { isOwner } from "../lib/owner.js";
import {
  getPriceFeedSettings,
  setPriceFeedSettings,
} from "../lib/prices.js";
import { topAlerts, totalUsers } from "../lib/users.js";
import { COPY } from "../lib/ui.js";

registerMainMenuItem({
  label: "Owner Dashboard",
  data: "owner:dashboard",
  order: 90,
});

const composer = new Composer<Ctx>();

async function dashboardText(): Promise<string> {
  const users = await totalUsers();
  const top = await topAlerts(10);
  const feed = await getPriceFeedSettings();

  const lines = [
    "Owner dashboard",
    "",
    `Total users: ${users}`,
    "",
    "Top alerts:",
  ];
  if (top.length === 0) {
    lines.push("No alerts recorded yet.");
  } else {
    top.forEach((t, i) => {
      lines.push(`${i + 1}. ${t.coin} (${t.type}) — ${t.count}`);
    });
  }
  lines.push(
    "",
    "Price feed:",
    `• Base: ${feed.base_url}`,
    `• VS: ${feed.vs_currency.toUpperCase()}`,
    `• Retries: ${feed.retries}`,
    "",
    "System: scheduler runs alerts, quiet-hour flush, and morning summaries each minute.",
  );
  return lines.join("\n");
}

function dashKeyboard() {
  return inlineKeyboard([
    [inlineButton("Refresh", "owner:dashboard")],
    [inlineButton("Price feed settings", "owner:feed")],
    [inlineButton("Back to menu", "menu:main")],
  ]);
}

composer.callbackQuery("owner:dashboard", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isOwner(ctx.from?.id)) {
    const text = "This dashboard is only available to the bot owner.";
    try {
      await ctx.editMessageText(text, {
        reply_markup: inlineKeyboard([
          [inlineButton("Back to menu", "menu:main")],
        ]),
      });
    } catch {
      await ctx.reply(text, {
        reply_markup: inlineKeyboard([
          [inlineButton("Back to menu", "menu:main")],
        ]),
      });
    }
    return;
  }
  ctx.session.step = "idle";
  const text = await dashboardText();
  try {
    await ctx.editMessageText(text, { reply_markup: dashKeyboard() });
  } catch {
    await ctx.reply(text, { reply_markup: dashKeyboard() });
  }
});

composer.callbackQuery("owner:feed", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isOwner(ctx.from?.id)) {
    await ctx.reply("This dashboard is only available to the bot owner.");
    return;
  }
  const feed = await getPriceFeedSettings();
  const text =
    "Price feed settings.\n\n" +
    `Current base URL:\n${feed.base_url}\n\n` +
    "Tap a preset or send a custom CoinGecko-compatible base URL.";
  ctx.session.step = "awaiting_price_feed_url";
  try {
    await ctx.editMessageText(text, {
      reply_markup: inlineKeyboard([
        [inlineButton("CoinGecko public", "owner:feed:cg")],
        [inlineButton("Back", "owner:dashboard")],
      ]),
    });
  } catch {
    await ctx.reply(text, {
      reply_markup: inlineKeyboard([
        [inlineButton("CoinGecko public", "owner:feed:cg")],
        [inlineButton("Back", "owner:dashboard")],
      ]),
    });
  }
});

composer.callbackQuery("owner:feed:cg", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Saved" });
  if (!isOwner(ctx.from?.id)) return;
  await setPriceFeedSettings({
    base_url: "https://api.coingecko.com/api/v3",
  });
  ctx.session.step = "idle";
  const text = await dashboardText();
  try {
    await ctx.editMessageText(text, { reply_markup: dashKeyboard() });
  } catch {
    await ctx.reply(text, { reply_markup: dashKeyboard() });
  }
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "awaiting_price_feed_url") return next();
  if (!isOwner(ctx.from?.id)) {
    ctx.session.step = "idle";
    return next();
  }
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return next();
  if (text.toLowerCase() === "cancel") {
    ctx.session.step = "idle";
    await ctx.reply(COPY.cancel);
    return;
  }
  if (!/^https:\/\//i.test(text)) {
    await ctx.reply("Send an https:// base URL for the price API.");
    return;
  }
  await setPriceFeedSettings({ base_url: text.replace(/\/$/, "") });
  ctx.session.step = "idle";
  await ctx.reply("Price feed base URL saved.", {
    reply_markup: inlineKeyboard([
      [inlineButton("Owner Dashboard", "owner:dashboard")],
      [inlineButton("Back to menu", "menu:main")],
    ]),
  });
});

export default composer;
