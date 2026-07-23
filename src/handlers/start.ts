import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  mainMenuKeyboard,
} from "../toolkit/index.js";
import { POPULAR_COINS } from "../lib/coins.js";
import { ensureUser } from "../lib/users.js";
import { COPY } from "../lib/ui.js";

// /start — welcome + popular coins + main menu. Features register their own
// main-menu buttons via registerMainMenuItem in their handler modules.
const composer = new Composer<Ctx>();

function welcomeKeyboard() {
  const popular = POPULAR_COINS.map((c) =>
    inlineButton(c.ticker, `add_coin:pick:${c.ticker}`),
  );
  const menu = mainMenuKeyboard();
  // Popular row on top, then registered menu rows.
  return inlineKeyboard([[...popular], ...menu.inline_keyboard]);
}

composer.command("start", async (ctx) => {
  if (ctx.from?.id) await ensureUser(ctx.from.id);
  ctx.session.step = "awaiting_coin";
  ctx.session.flow_expires_at = undefined;
  await ctx.reply(COPY.welcome, { reply_markup: welcomeKeyboard() });
});

// "Back to menu" — re-render welcome + menu in place.
composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.from?.id) await ensureUser(ctx.from.id);
  ctx.session.step = "idle";
  try {
    await ctx.editMessageText(COPY.welcome, { reply_markup: welcomeKeyboard() });
  } catch {
    await ctx.reply(COPY.welcome, { reply_markup: welcomeKeyboard() });
  }
});

export default composer;
