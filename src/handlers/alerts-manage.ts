import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import {
  DEFAULT_PERCENT_TIMEFRAME_MIN,
  type ThresholdDirection,
} from "../lib/models.js";
import {
  addAlertRule,
  ensureUser,
  getUser,
  removeAlertRule,
} from "../lib/users.js";
import { COPY } from "../lib/ui.js";

registerMainMenuItem({ label: "Manage Alerts", data: "alerts:manage", order: 20 });

const composer = new Composer<Ctx>();

function navKeyboard(extra: ReturnType<typeof inlineButton>[][] = []) {
  return inlineKeyboard([
    ...extra,
    [inlineButton("Back to menu", "menu:main")],
  ]);
}

async function renderManage(ctx: Ctx, edit: boolean) {
  const uid = ctx.from?.id;
  if (!uid) return;
  const user = await ensureUser(uid);
  const lines: string[] = ["Manage alerts — threshold or percent-move rules."];

  if (user.alert_rules.length === 0) {
    lines.push("", "No alert rules yet — pick a coin to create one.");
  } else {
    lines.push("", "Your rules:");
    for (const r of user.alert_rules) {
      if (r.alert_type === "threshold") {
        lines.push(
          `• ${r.coin_ticker} ${r.direction} ${r.threshold_price} USD`,
        );
      } else {
        lines.push(
          `• ${r.coin_ticker} ±${r.percent_move}% / ${r.timeframe ?? DEFAULT_PERCENT_TIMEFRAME_MIN}m`,
        );
      }
    }
  }

  const rows: ReturnType<typeof inlineButton>[][] = [];
  if (user.watchlist.length === 0) {
    lines.push("", COPY.emptyWatchlist);
    rows.push([inlineButton("Add Coin", "add_coin:start")]);
  } else {
    lines.push("", "Tap a coin to add an alert:");
    for (const w of user.watchlist) {
      rows.push([
        inlineButton(`${w.ticker}`, `alerts:coin:${w.ticker}`),
      ]);
    }
  }

  if (user.alert_rules.length > 0) {
    rows.push([inlineButton("Remove a rule", "alerts:remove")]);
  }

  const text = lines.join("\n");
  const markup = navKeyboard(rows);
  if (edit) {
    try {
      await ctx.editMessageText(text, { reply_markup: markup });
      return;
    } catch {
      /* fall through */
    }
  }
  await ctx.reply(text, { reply_markup: markup });
}

composer.callbackQuery("alerts:manage", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  ctx.session.draft_alert_ticker = undefined;
  ctx.session.draft_alert_type = undefined;
  ctx.session.draft_alert_direction = undefined;
  await renderManage(ctx, true);
});

composer.callbackQuery(/^alerts:coin:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const ticker = (ctx.match![1] ?? "").toUpperCase();
  ctx.session.draft_alert_ticker = ticker;
  ctx.session.step = "idle";
  const text =
    `Alert for ${ticker}.\n\n` +
    "Choose a type:\n" +
    "• Threshold — fire when price crosses a USD level\n" +
    "• Percent move — fire on a % change over 1 hour";
  const markup = inlineKeyboard([
    [
      inlineButton("Threshold", `alerts:type:threshold`),
      inlineButton("Percent move", `alerts:type:percent`),
    ],
    [inlineButton("Back", "alerts:manage")],
  ]);
  try {
    await ctx.editMessageText(text, { reply_markup: markup });
  } catch {
    await ctx.reply(text, { reply_markup: markup });
  }
});

composer.callbackQuery("alerts:type:threshold", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.session.draft_alert_ticker) {
    await renderManage(ctx, true);
    return;
  }
  ctx.session.draft_alert_type = "threshold";
  const text = `Direction for ${ctx.session.draft_alert_ticker}: alert when price goes…`;
  const markup = inlineKeyboard([
    [
      inlineButton("Above", "alerts:dir:above"),
      inlineButton("Below", "alerts:dir:below"),
    ],
    [inlineButton("Back", "alerts:manage")],
  ]);
  try {
    await ctx.editMessageText(text, { reply_markup: markup });
  } catch {
    await ctx.reply(text, { reply_markup: markup });
  }
});

composer.callbackQuery("alerts:type:percent", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.session.draft_alert_ticker) {
    await renderManage(ctx, true);
    return;
  }
  ctx.session.draft_alert_type = "percent";
  ctx.session.step = "awaiting_percent_value";
  const text =
    `Percent move for ${ctx.session.draft_alert_ticker}.\n\n` +
    "Send the percent (e.g. 5 for 5%). Timeframe is 1 hour.";
  try {
    await ctx.editMessageText(text, {
      reply_markup: inlineKeyboard([[inlineButton("Cancel", "alerts:manage")]]),
    });
  } catch {
    await ctx.reply(text, {
      reply_markup: inlineKeyboard([[inlineButton("Cancel", "alerts:manage")]]),
    });
  }
});

composer.callbackQuery(/^alerts:dir:(above|below)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const dir = ctx.match![1] as ThresholdDirection;
  ctx.session.draft_alert_direction = dir;
  ctx.session.draft_alert_type = "threshold";
  ctx.session.step = "awaiting_threshold_price";
  const text =
    `Threshold for ${ctx.session.draft_alert_ticker} (${dir}).\n\n` +
    "Send the USD price (e.g. 65000).";
  try {
    await ctx.editMessageText(text, {
      reply_markup: inlineKeyboard([[inlineButton("Cancel", "alerts:manage")]]),
    });
  } catch {
    await ctx.reply(text, {
      reply_markup: inlineKeyboard([[inlineButton("Cancel", "alerts:manage")]]),
    });
  }
});

composer.callbackQuery("alerts:remove", async (ctx) => {
  await ctx.answerCallbackQuery();
  const uid = ctx.from?.id;
  if (!uid) return;
  const user = await getUser(uid);
  if (!user || user.alert_rules.length === 0) {
    await renderManage(ctx, true);
    return;
  }
  const rows = user.alert_rules.map((r) => {
    const label =
      r.alert_type === "threshold"
        ? `${r.coin_ticker} ${r.direction} ${r.threshold_price}`
        : `${r.coin_ticker} ±${r.percent_move}%`;
    return [inlineButton(`Remove ${label}`, `alerts:rm:${r.id}`)];
  });
  const text = "Tap a rule to remove it.";
  const markup = navKeyboard(rows);
  try {
    await ctx.editMessageText(text, { reply_markup: markup });
  } catch {
    await ctx.reply(text, { reply_markup: markup });
  }
});

composer.callbackQuery(/^alerts:rm:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Removed" });
  const uid = ctx.from?.id;
  if (!uid) return;
  await removeAlertRule(uid, ctx.match![1] ?? "");
  await renderManage(ctx, true);
});

composer.on("message:text", async (ctx, next) => {
  const step = ctx.session.step;
  if (step !== "awaiting_threshold_price" && step !== "awaiting_percent_value") {
    return next();
  }
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return next();
  if (text.toLowerCase() === "cancel") {
    ctx.session.step = "idle";
    await ctx.reply(COPY.cancel);
    return;
  }

  const uid = ctx.from?.id;
  if (!uid) return;
  const ticker = ctx.session.draft_alert_ticker;
  if (!ticker) {
    ctx.session.step = "idle";
    await renderManage(ctx, false);
    return;
  }

  if (step === "awaiting_threshold_price") {
    const price = Number(text.replace(/[$,]/g, ""));
    if (!Number.isFinite(price) || price <= 0) {
      await ctx.reply("Send a positive USD price, like 65000.");
      return;
    }
    const direction = ctx.session.draft_alert_direction ?? "above";
    await addAlertRule(uid, {
      coin_ticker: ticker,
      alert_type: "threshold",
      threshold_price: price,
      direction,
    });
    ctx.session.step = "idle";
    ctx.session.draft_alert_ticker = undefined;
    ctx.session.draft_alert_type = undefined;
    ctx.session.draft_alert_direction = undefined;
    await ctx.reply(
      `Saved: alert when ${ticker} goes ${direction} ${price} USD.`,
      {
        reply_markup: inlineKeyboard([
          [inlineButton("Manage Alerts", "alerts:manage")],
          [inlineButton("Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  // percent
  const pct = Number(text.replace(/%/g, ""));
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
    await ctx.reply("Send a percent between 0 and 100, like 5.");
    return;
  }
  await addAlertRule(uid, {
    coin_ticker: ticker,
    alert_type: "percent",
    percent_move: pct,
    timeframe: DEFAULT_PERCENT_TIMEFRAME_MIN,
  });
  ctx.session.step = "idle";
  ctx.session.draft_alert_ticker = undefined;
  ctx.session.draft_alert_type = undefined;
  await ctx.reply(
    `Saved: alert when ${ticker} moves ${pct}% within 1 hour.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Manage Alerts", "alerts:manage")],
        [inlineButton("Back to menu", "menu:main")],
      ]),
    },
  );
});

export default composer;
