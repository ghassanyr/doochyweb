Telegram notifications — final v1 plan
Locked decisions: reuse @DoochyBot with a rotated token · long polling · publish-only · any signed-in user · one global on/off toggle · https://doochy.net · Mongo outbox + worker.

Flow
Signed-in user opens /settings → Connect Telegram.
POST /api/telegram/link mints a single-use, hashed, 15-minute code and returns https://t.me/DoochyBot?start=<code>.
User taps the deep link or sends the code to the bot.
Bot consumes the code, binds chat_id ↔ userId, replies “Linked”.
Settings polls /api/telegram/status until linked.
Admin publishes a signal → createSignal() enqueues one delivery per enabled link → worker sends the DM.
Open on Doochy button opens /signals?signal=<id>.
Data model
TelegramLink — unique userId, unique chatId, Telegram identity, notificationsEnabled, linkedAt, lastError.
TelegramLinkCode — codeHash unique, userId, expiresAt TTL index, usedAt, usedByChatId.
TelegramDelivery — signalId, event, chatId, message snapshot, status, attempts, nextAttemptAt, unique (signalId, event, chatId).
TelegramState — persisted polling offset.
Server
client.ts — Bot API wrapper with timeouts, token redaction, 429 handling.
link.ts — Crockford code generation, normalization, SHA-256 hashing, consume-once.
messages.ts — HTML-safe signal/test/bot messages.
notify.ts — enqueue on publish + outbox worker with exponential backoff, 429 retry_after, permanent 400/403 handling.
bot.ts — update parsing, /start, /status, /stop, /resume, /unlink, /help, long-poll loop.
routes.ts — /api/telegram/link|status|unlink|prefs|test.
index.ts — start/stop bot + worker, sync indexes.
signals/routes.ts — enqueue after createSignal() only.
UI
Settings.tsx gains a Telegram card: connect, code + deep link, copy, auto-refresh until linked, linked handle, one notifications toggle, test message, disconnect, last-error display. api.ts gains telegramApi.

Deploy
Rotate the token in BotFather, stop the old consumer, clear any old webhook, put the token in /home/san/doochyweb/.env (600), build, pm2 restart doochyweb, then verify with a real publish. Polling needs no nginx or Cloudflare change.

