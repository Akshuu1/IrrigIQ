import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramProvider } from './telegram.provider.js';

describe('TelegramProvider Unit Tests', () => {
  const provider = new TelegramProvider();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('verifyInbound', () => {
    it('verifies valid X-Telegram-Bot-Api-Secret-Token header', () => {
      const isValid = provider.verifyInbound({
        headers: {
          'x-telegram-bot-api-secret-token': 'irrigiq-telegram-webhook-secret-token',
        },
      });
      expect(isValid).toBe(true);
    });

    it('rejects missing or empty secret token header', () => {
      expect(provider.verifyInbound({ headers: {} })).toBe(false);
      expect(
        provider.verifyInbound({
          headers: { 'x-telegram-bot-api-secret-token': '' },
        }),
      ).toBe(false);
    });

    it('rejects mismatched secret token header', () => {
      expect(
        provider.verifyInbound({
          headers: {
            'x-telegram-bot-api-secret-token': 'wrong-secret-token',
          },
        }),
      ).toBe(false);
    });
  });

  describe('parseInbound', () => {
    it('parses valid Telegram text message update', () => {
      const update = {
        update_id: 123456,
        message: {
          message_id: 99,
          chat: { id: 778899 },
          from: { id: 778899, first_name: 'Ramesh' },
          text: '/start 849201',
        },
      };

      const result = provider.parseInbound(update);
      expect(result).toEqual({
        updateId: 123456,
        externalId: '778899',
        text: '/start 849201',
        messageId: 99,
        fromName: 'Ramesh',
      });
    });

    it('parses inline button callback query update', () => {
      const update = {
        update_id: 123457,
        callback_query: {
          id: 'cb_123',
          from: { id: 778899, first_name: 'Ramesh' },
          message: {
            message_id: 100,
            chat: { id: 778899 },
          },
          data: '1',
        },
      };

      const result = provider.parseInbound(update);
      expect(result).toEqual({
        updateId: 123457,
        externalId: '778899',
        callbackData: '1',
        messageId: 100,
        fromName: 'Ramesh',
      });
    });

    it('returns null on invalid payloads', () => {
      expect(provider.parseInbound(null)).toBeNull();
      expect(provider.parseInbound({})).toBeNull();
      expect(provider.parseInbound({ update_id: 123 })).toBeNull();
    });
  });

  describe('send', () => {
    it('sends message successfully with inline keyboard', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: { message_id: 555 },
        }),
      });
      global.fetch = mockFetch;

      const res = await provider.send('778899', 'Advisory message', {
        replyMarkup: {
          inlineKeyboard: [
            [
              { text: 'Done', callbackData: '1' },
              { text: 'Skip', callbackData: '2' },
            ],
          ],
        },
      });

      expect(res.success).toBe(true);
      expect(res.messageId).toBe(555);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"chat_id":"778899"'),
        }),
      );
    });

    it('identifies permanent failure when bot was blocked (403 Forbidden)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          ok: false,
          error_code: 403,
          description: 'Forbidden: bot was blocked by the user',
        }),
      });

      const res = await provider.send('778899', 'Advisory message');
      expect(res.success).toBe(false);
      expect(res.permanentFailure).toBe(true);
      expect(res.error).toContain('bot was blocked');
    });

    it('identifies non-permanent failures gracefully (e.g. 500 or timeout)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({
          ok: false,
          description: 'Bad Gateway',
        }),
      });

      const res = await provider.send('778899', 'Advisory message');
      expect(res.success).toBe(false);
      expect(res.permanentFailure).toBe(false);
    });
  });
});
