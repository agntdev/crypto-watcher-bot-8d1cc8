# Crypto Watcher — Bot specification

**Archetype:** custom

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

A private Telegram bot that lets users maintain personal crypto watchlists and receive alerts on price thresholds or percentage moves. Features include on-demand price checks, configurable morning summaries, quiet hours, and an owner dashboard for usage analytics.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- individual crypto watchers
- Telegram users

## Success criteria

- Users can create and manage watchlists with price alerts
- Alerts are delivered accurately with cooldown periods
- Morning summaries are sent at user-specified times
- Quiet hours suppress alerts as configured
- Owner dashboard shows usage and top alerts

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu
- **/price** (command, actor: user, command: /price) — Check current price of a specific coin or full watchlist
- **Add Coin** (button, actor: user, callback: add_coin:start) — Start the flow to add a new coin to the watchlist
  - inputs: coin ticker, display name
  - outputs: updated watchlist
- **Manage Alerts** (button, actor: user, callback: alerts:manage) — Configure or view existing alert rules
  - inputs: alert type, threshold/percent, timeframe
  - outputs: alert rules
- **Set Quiet Hours** (button, actor: user, callback: quiet_hours:configure) — Configure quiet hours for alert suppression
  - inputs: start time, end time
  - outputs: quiet hours settings
- **Morning Summary** (button, actor: user, callback: summary:configure) — Configure morning summary preferences
  - inputs: enable/disable, local time
  - outputs: summary settings
- **Owner Dashboard** (button, actor: owner, callback: owner:dashboard) — View usage statistics and top alerts
  - inputs: none
  - outputs: usage data, top alerts

## Flows

### onboarding
_Trigger:_ /start

1. Display welcome message
2. Show quick inline buttons for popular coins (BTC, ETH, TON)
3. Allow free-text ticker entry

_Data touched:_ User, Watchlist item

### add_coin
_Trigger:_ add_coin:start

1. Show inline buttons for popular coins
2. Allow free-text ticker entry
3. Validate ticker and display name
4. Add to watchlist

_Data touched:_ Watchlist item

### create_alert
_Trigger:_ alerts:manage

1. Select coin from watchlist
2. Choose alert type (threshold or percent move)
3. Set parameters (price/direction or percent/timeframe)
4. Save alert rule

_Data touched:_ Alert rule

### price_check
_Trigger:_ /price

1. Parse ticker argument
2. Fetch current price and 24h change
3. Display results in formatted message

_Data touched:_ Notification record

### morning_summary
_Trigger:_ summary:configure

1. Enable/disable summary
2. Set local time preference
3. Schedule daily summary message

_Data touched:_ User

### quiet_hours
_Trigger:_ quiet_hours:configure

1. Set start and end times
2. Save quiet hours configuration

_Data touched:_ User

### owner_dashboard
_Trigger:_ owner:dashboard

1. Fetch total users
2. Fetch top 10 alerts by count
3. Display statistics in owner-only chat

_Data touched:_ User, Notification record

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **User** _(retention: persistent)_ — Telegram user account with personal settings
  - fields: telegram_id, watchlist, alert_rules, quiet_hours, summary_time, last_seen_prices
- **Watchlist item** _(retention: persistent)_ — Crypto coin in user's watchlist
  - fields: ticker, display_name
- **Alert rule** _(retention: persistent)_ — Price alert configuration for a coin
  - fields: coin_ticker, alert_type, threshold_price, direction, percent_move, timeframe, last_alert_time
- **Notification record** _(retention: persistent)_ — Record of alerts sent to users
  - fields: user_id, coin_ticker, alert_type, trigger_time, old_price, new_price

## Integrations

- **Telegram** (required) — Bot API messaging
- **Price Feed API** (required) — Market data for crypto prices
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- View total users and top alerts
- Configure price feed settings
- Monitor system health

## Notifications

- Price alerts with detailed metrics
- Morning summary of watchlist prices
- Owner dashboard updates

## Permissions & privacy

- Private user data stored securely
- No exchange account linking
- No financial advice provided

## Edge cases

- Failed price feed requests with retries
- Unknown tickers with suggestions
- Alerts during quiet hours are queued
- Stale alerts after quiet hours

## Required tests

- Verify alert delivery with cooldown periods
- Test morning summary scheduling
- Validate quiet hours suppression
- Check unknown ticker handling

## Assumptions

- Single fixed cooldown period of 1 hour
- Default percent-move timeframe is 1 hour
- Morning summary is opt-in
- Quiet hours default to 22:00-07:00
- Price feed retries on failures without user notification
