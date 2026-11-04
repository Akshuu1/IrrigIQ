import crypto from 'node:crypto';
import { getEnv } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type {
  MessagingProvider,
  SendMessageOptions,
  SendMessageResult,
  InboundUpdate,
} from './provider.interface.js';

export class TelegramProvider implements MessagingProvider {
  public readonly name = 'telegram';

  private get botToken(): string {
    return getEnv().TELEGRAM_BOT_TOKEN;
  }

  private get webhookSecret(): string {
    return getEnv().TELEGRAM_WEBHOOK_SECRET;
  }

  private get apiBase(): string {
    return `https://api.telegram.org/bot${this.botToken}`;
  }

  /**
   * Configures the webhook URL with the secret token on the Telegram Bot API.
   */
  async setWebhook(url: string, secretToken = this.webhookSecret): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiBase}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          secret_token: secretToken,
          allowed_updates: ['message', 'callback_query'],
        }),
      });

      const data = (await response.json()) as { ok: boolean; description?: string };
      if (!data.ok) {
        logger.error({ description: data.description }, 'Failed to set Telegram webhook');
        return false;
      }
      logger.info({ url }, 'Telegram webhook configured successfully');
      return true;
    } catch (err: unknown) {
      logger.error({ err }, 'Error setting Telegram webhook');
      return false;
    }
  }

  /**
   * Verifies the X-Telegram-Bot-Api-Secret-Token header matches the configured secret.
   * Uses crypto.timingSafeEqual to prevent timing attacks.
   */
  verifyInbound(req: {
    headers: Record<string, string | string[] | undefined>;
    body?: unknown;
  }): boolean {
    const rawHeader =
      req.headers['x-telegram-bot-api-secret-token'] ||
      req.headers['X-Telegram-Bot-Api-Secret-Token'];

    const secretHeader = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!secretHeader || typeof secretHeader !== 'string') {
      return false;
    }

    const expected = this.webhookSecret;
    if (expected.length !== secretHeader.length) {
      return false;
    }

    try {
      return crypto.timingSafeEqual(
        Buffer.from(secretHeader, 'utf8'),
        Buffer.from(expected, 'utf8'),
      );
    } catch {
      return false;
    }
  }

  /**
   * Parses an inbound Telegram update payload (message or callback query).
   */
  parseInbound(body: unknown): InboundUpdate | null {
    if (!body || typeof body !== 'object') {
      return null;
    }

    const payload = body as Record<string, unknown>;
    const updateId = payload.update_id;
    if (typeof updateId !== 'number') {
      return null;
    }

    // 1. Text Message
    if (payload.message && typeof payload.message === 'object') {
      const msg = payload.message as Record<string, unknown>;
      const chat = msg.chat as Record<string, unknown> | undefined;
      const from = msg.from as Record<string, unknown> | undefined;

      if (chat && (chat.id !== undefined && chat.id !== null)) {
        return {
          updateId,
          externalId: String(chat.id),
          text: typeof msg.text === 'string' ? msg.text : undefined,
          messageId: typeof msg.message_id === 'number' ? msg.message_id : undefined,
          fromName: from && typeof from.first_name === 'string' ? from.first_name : undefined,
        };
      }
    }

    // 2. Inline Keyboard Callback Query
    if (payload.callback_query && typeof payload.callback_query === 'object') {
      const cb = payload.callback_query as Record<string, unknown>;
      const msg = cb.message as Record<string, unknown> | undefined;
      const chat = msg?.chat as Record<string, unknown> | undefined;
      const from = cb.from as Record<string, unknown> | undefined;

      const chatId = chat?.id ?? from?.id;
      if (chatId !== undefined && chatId !== null) {
        return {
          updateId,
          externalId: String(chatId),
          callbackData: typeof cb.data === 'string' ? cb.data : undefined,
          messageId: msg && typeof msg.message_id === 'number' ? msg.message_id : undefined,
          fromName: from && typeof from.first_name === 'string' ? from.first_name : undefined,
        };
      }
    }

    return null;
  }

  /**
   * Sends a message to a Telegram chat.
   * Handles markdown parsing, permanent failures (403 user blocked bot), and returns result.
   */
  async send(
    externalId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<SendMessageResult> {
    try {
      const inlineKeyboard = options?.replyMarkup?.inlineKeyboard?.map((row) =>
        row.map((btn) => ({
          text: btn.text,
          callback_data: btn.callbackData,
          url: btn.url,
        })),
      );

      const requestBody: Record<string, unknown> = {
        chat_id: externalId,
        text,
        parse_mode: 'Markdown',
      };

      if (inlineKeyboard && inlineKeyboard.length > 0) {
        requestBody.reply_markup = {
          inline_keyboard: inlineKeyboard,
        };
      }

      let response = await fetch(`${this.apiBase}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      // If markdown error (Bad Request 400 with parse error), fallback to plain text
      if (response.status === 400) {
        const errorData = (await response.clone().json().catch(() => ({}))) as {
          description?: string;
        };
        if (errorData.description?.toLowerCase().includes('can\'t parse entities')) {
          delete requestBody.parse_mode;
          response = await fetch(`${this.apiBase}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });
        }
      }

      const data = (await response.json().catch(() => ({}))) as {
        ok: boolean;
        result?: { message_id: number };
        description?: string;
        error_code?: number;
      };

      if (!response.ok || !data.ok) {
        const isPermanent =
          response.status === 403 ||
          data.error_code === 403 ||
          data.description?.toLowerCase().includes('bot was blocked') ||
          data.description?.toLowerCase().includes('user is deactivated') ||
          data.description?.toLowerCase().includes('chat not found');

        logger.warn(
          {
            status: response.status,
            errorCode: data.error_code,
            isPermanent,
            description: data.description,
          },
          'Telegram API sendMessage failed',
        );

        return {
          success: false,
          permanentFailure: isPermanent,
          error: data.description || `HTTP ${response.status}`,
        };
      }

      return {
        success: true,
        messageId: data.result?.message_id,
      };
    } catch (err: unknown) {
      logger.error({ err }, 'Network error while calling Telegram sendMessage');
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
