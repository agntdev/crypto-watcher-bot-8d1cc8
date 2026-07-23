import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { COPY } from "../lib/ui.js";

const composer = new Composer<Ctx>();

const backToMenu = inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);

composer.command("help", async (ctx) => {
  ctx.session.step = "idle";
  await ctx.reply(COPY.help);
});

composer.callbackQuery("menu:help", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  try {
    await ctx.editMessageText(COPY.help, { reply_markup: backToMenu });
  } catch {
    await ctx.reply(COPY.help, { reply_markup: backToMenu });
  }
});

export default composer;
