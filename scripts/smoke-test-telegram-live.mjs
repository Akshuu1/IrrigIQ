/**
 * Manual Live Smoke-Test Script for Telegram Bot Integration
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN="<token>" TELEGRAM_TEST_CHAT_ID="<chat_id>" node scripts/smoke-test-telegram-live.mjs
 *
 * Rules:
 *   - Never prints bot tokens or private credentials to console.
 *   - Validates live connectivity against Telegram Bot API.
 */

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const testChatId = process.env.TELEGRAM_TEST_CHAT_ID;

if (!botToken || botToken === 'test-bot-token') {
  console.error('❌ TELEGRAM_BOT_TOKEN is not configured in the environment.');
  console.error('   Please run with a valid bot token to execute live smoke testing.');
  console.error('   Example: TELEGRAM_BOT_TOKEN="123456:ABC..." node scripts/smoke-test-telegram-live.mjs');
  process.exit(1);
}

const maskedToken = `${botToken.slice(0, 4)}...${botToken.slice(-4)}`;
console.log(`\n============================================================`);
console.log(`       IrrigIQ Live Telegram Bot Integration Smoke Test     `);
console.log(`============================================================`);
console.log(`Bot Token: [CONFIGURED] (${maskedToken})`);

const TELEGRAM_API_BASE = `https://api.telegram.org/bot${botToken}`;

async function runSmokeTest() {
  // Step 1: getMe
  console.log('\n[1/3] Testing getMe connectivity...');
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/getMe`);
    const data = await res.json();
    if (!data.ok) {
      console.error(`❌ getMe failed: ${data.description || 'Unknown error'}`);
      process.exit(1);
    }
    console.log(`✅ Success! Bot Username: @${data.result.username} (ID: ${data.result.id})`);
  } catch (err) {
    console.error(`❌ Network error contacting Telegram API:`, err.message);
    process.exit(1);
  }

  // Step 2: getWebhookInfo
  console.log('\n[2/3] Checking Webhook Configuration...');
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/getWebhookInfo`);
    const data = await res.json();
    if (!data.ok) {
      console.error(`❌ getWebhookInfo failed: ${data.description}`);
    } else {
      console.log(`✅ Webhook URL: ${data.result.url || '[NONE - Polling Mode]'}`);
      console.log(`   Pending Update Count: ${data.result.pending_update_count}`);
      if (data.result.last_error_message) {
        console.warn(`   ⚠️ Last Error: ${data.result.last_error_message}`);
      }
    }
  } catch (err) {
    console.error(`❌ Error fetching webhook info:`, err.message);
  }

  // Step 3: Send test message with inline keyboard if chat ID provided
  console.log('\n[3/3] Sending Interactive Test Message...');
  if (!testChatId) {
    console.log('ℹ️ TELEGRAM_TEST_CHAT_ID not provided. Skipping message send.');
    console.log('   To test interactive delivery, pass TELEGRAM_TEST_CHAT_ID="<your_chat_id>".');
  } else {
    try {
      const payload = {
        chat_id: testChatId,
        text: '🌾 *IrrigIQ Live Bot Smoke Test*\n\nPlease tap an action below to verify button callbacks:',
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ 1: Done', callback_data: '1' }],
            [{ text: '⏭️ 2: Skipped', callback_data: '2' }],
            [{ text: '⚡ 3: No power', callback_data: '3' }],
          ],
        },
      };

      const res = await fetch(`${TELEGRAM_API_BASE}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) {
        console.error(`❌ sendMessage failed: ${data.description}`);
      } else {
        console.log(`✅ Test message successfully delivered! Message ID: ${data.result.message_id}`);
      }
    } catch (err) {
      console.error(`❌ Failed to send message:`, err.message);
    }
  }

  console.log('\n============================================================');
  console.log('🎉 Live Telegram Bot Smoke Test Finished.');
  console.log('============================================================\n');
}

runSmokeTest();

