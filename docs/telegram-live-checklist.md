# Live Telegram Bot Manual QA Smoke Test Checklist

This checklist is used for end-to-end verification of the IrrigIQ Telegram Bot integration against live Telegram Bot API infrastructure.

---

## Prerequisites
- [ ] Registered bot token from Telegram `@BotFather` stored in `TELEGRAM_BOT_TOKEN`.
- [ ] Active webhook URL registered via `POST https://api.telegram.org/bot<TOKEN>/setWebhook` with secret token.
- [ ] Secret token header matching `TELEGRAM_WEBHOOK_SECRET`.
- [ ] Secret AES-256-GCM encryption key configured via `CHAT_ENCRYPTION_KEY`.
- [ ] Secret HMAC-SHA256 index key configured via `CHAT_INDEX_KEY`.

---

## 1. Automated Smoke Script Check
Run the automated CLI smoke test:
```bash
TELEGRAM_BOT_TOKEN="<bot_token>" TELEGRAM_TEST_CHAT_ID="<your_chat_id>" node scripts/smoke-test-telegram-live.mjs
```
- [ ] `getMe` confirms bot username and ID.
- [ ] `getWebhookInfo` reports `has_custom_certificate`, pending update count, and 0 recent webhook delivery errors.
- [ ] Test message with inline keyboard delivers to your device.

---

## 2. Farmer Account Linking (`/start <code>`)
1. In the IrrigIQ Web Dashboard, go to **Settings > Messaging > Telegram**.
2. Click **Connect Telegram** to generate a 6-digit one-time code (valid 15 minutes).
3. Open Telegram and click the bot deep link or send `/start <code>`.
- [ ] Bot responds in the user's preferred language asking for opt-in confirmation.
- [ ] Database stores the encrypted chat ID and HMAC-SHA256 blind index in `MessageChannel`.
- [ ] Link code is invalidated (`used: true`).

---

## 3. Daily Advisory Digest & Action Buttons
1. Trigger a test digest send from the dashboard or messaging API.
- [ ] Message arrives listing each field, crop, action (Irrigate / Skip), recommended pump run time, and power window.
- [ ] Inline keyboard renders with buttons:
  - `✅ 1: Done`
  - `⏭️ 2: Skipped`
  - `⚡ 3: No power`
- [ ] Tapping `1: Done` logs the irrigation with source `'chat'` and triggers a schedule recompute.
- [ ] Tapping `2: Skipped` logs a skip with reason recorded.
- [ ] Tapping `3: No power` requests an updated power window or reschedules.

---

## 4. Security & Privacy Validation
- [ ] Send webhook request with invalid secret token -> Returns HTTP `401 Unauthorized`.
- [ ] Replay identical `update_id` within 48 hours -> Returns `{ ok: true, duplicate: true }` without executing side effects.
- [ ] Text `STOP` or `रोकें` -> Channel is immediately deactivated (`optedIn: false`, `status: deactivated`).
- [ ] Verify server logs: Ensure Telegram chat IDs, bot tokens, and phone numbers NEVER appear in plain text.

