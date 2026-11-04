import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { WhatsAppCloudProvider } from './whatsapp.provider.js';
import * as envModule from '../../config/env.js';

describe('WhatsAppCloudProvider Unit Tests', () => {
  const provider = new WhatsAppCloudProvider();
  const mockSecret = 'test_whatsapp_app_secret_123';
  const mockVerifyToken = 'test_webhook_verify_token_456';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isEnabled', () => {
    it('returns false when WhatsApp credentials are not configured in environment', () => {
      vi.spyOn(envModule, 'getEnv').mockReturnValue({
        ...envModule.getEnv(),
        WHATSAPP_PHONE_NUMBER_ID: undefined,
        WHATSAPP_ACCESS_TOKEN: undefined,
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: undefined,
        WHATSAPP_APP_SECRET: undefined,
      });

      expect(provider.isEnabled()).toBe(false);
    });

    it('returns true when all WhatsApp credentials are present', () => {
      vi.spyOn(envModule, 'getEnv').mockReturnValue({
        ...envModule.getEnv(),
        WHATSAPP_PHONE_NUMBER_ID: '10987654321',
        WHATSAPP_ACCESS_TOKEN: 'EAAB...',
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: mockVerifyToken,
        WHATSAPP_APP_SECRET: mockSecret,
      });

      expect(provider.isEnabled()).toBe(true);
    });
  });

  describe('Webhook Verification (GET challenge & POST signature)', () => {
    it('verifies GET challenge when verify token matches', () => {
      vi.spyOn(envModule, 'getEnv').mockReturnValue({
        ...envModule.getEnv(),
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: mockVerifyToken,
      });

      const challenge = provider.verifyWebhookChallenge({
        'hub.mode': 'subscribe',
        'hub.verify_token': mockVerifyToken,
        'hub.challenge': '11582012',
      });

      expect(challenge).toBe('11582012');
    });

    it('rejects GET challenge when verify token is incorrect', () => {
      vi.spyOn(envModule, 'getEnv').mockReturnValue({
        ...envModule.getEnv(),
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: mockVerifyToken,
      });

      const challenge = provider.verifyWebhookChallenge({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong_token',
        'hub.challenge': '11582012',
      });

      expect(challenge).toBeNull();
    });

    it('verifies valid HMAC-SHA256 signature on raw request body', () => {
      vi.spyOn(envModule, 'getEnv').mockReturnValue({
        ...envModule.getEnv(),
        WHATSAPP_APP_SECRET: mockSecret,
      });

      const rawBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));
      const expectedHmac = crypto.createHmac('sha256', mockSecret).update(rawBody).digest('hex');

      const isValid = provider.verifyInbound({
        headers: { 'x-hub-signature-256': `sha256=${expectedHmac}` },
        rawBody,
      });

      expect(isValid).toBe(true);
    });

    it('rejects invalid, tampered or missing signature', () => {
      vi.spyOn(envModule, 'getEnv').mockReturnValue({
        ...envModule.getEnv(),
        WHATSAPP_APP_SECRET: mockSecret,
      });

      const rawBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));

      // Missing
      expect(provider.verifyInbound({ headers: {}, rawBody })).toBe(false);

      // Wrong signature
      expect(
        provider.verifyInbound({
          headers: { 'x-hub-signature-256': 'sha256=deadbeefdeadbeef' },
          rawBody,
        }),
      ).toBe(false);
    });
  });

  describe('parseInbound', () => {
    it('parses interactive button reply update', () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '12345678',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  contacts: [{ profile: { name: 'Suresh' }, wa_id: '919876543210' }],
                  messages: [
                    {
                      from: '919876543210',
                      id: 'wamid.HBgL1234',
                      timestamp: '1730700000',
                      type: 'interactive',
                      interactive: {
                        type: 'button_reply',
                        button_reply: { id: '1', title: 'Done' },
                      },
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      const result = provider.parseInbound(payload);
      expect(result).toEqual({
        updateId: 'wamid.HBgL1234',
        externalId: '919876543210',
        callbackData: '1',
        text: 'Done',
        messageId: 'wamid.HBgL1234',
        fromName: 'Suresh',
      });
    });

    it('parses text message update', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  contacts: [{ profile: { name: 'Kisan' } }],
                  messages: [
                    {
                      from: '919123456789',
                      id: 'wamid.HBgL5678',
                      type: 'text',
                      text: { body: '4' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = provider.parseInbound(payload);
      expect(result).toEqual({
        updateId: 'wamid.HBgL5678',
        externalId: '919123456789',
        text: '4',
        messageId: 'wamid.HBgL5678',
        fromName: 'Kisan',
      });
    });
  });

  describe('24-Hour Customer Service Rule (Session vs Template Message)', () => {
    beforeEach(() => {
      vi.spyOn(envModule, 'getEnv').mockReturnValue({
        ...envModule.getEnv(),
        WHATSAPP_PHONE_NUMBER_ID: '10987654321',
        WHATSAPP_ACCESS_TOKEN: 'EAAB_token',
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: mockVerifyToken,
        WHATSAPP_APP_SECRET: mockSecret,
      });
    });

    it('sends interactive session message with reply buttons when inside 24h window', async () => {
      let capturedBody: any;
      global.fetch = vi.fn().mockImplementation(async (_url, options) => {
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ messages: [{ id: 'wamid.out123' }] }),
        };
      });

      const res = await provider.send('919876543210', 'Run pump 1 h 47 min tonight', {
        isInside24hWindow: true,
        replyMarkup: {
          inlineKeyboard: [
            [
              { text: 'Done', callbackData: '1' },
              { text: 'Skipped', callbackData: '2' },
              { text: 'No power', callbackData: '4' },
            ],
          ],
        },
      });

      expect(res.success).toBe(true);
      expect(capturedBody.type).toBe('interactive');
      expect(capturedBody.interactive.type).toBe('button');
      expect(capturedBody.interactive.action.buttons).toHaveLength(3);
      expect(capturedBody.interactive.action.buttons[0].reply.id).toBe('1');
    });

    it('sends pre-approved template message when outside 24h customer service window', async () => {
      let capturedBody: any;
      global.fetch = vi.fn().mockImplementation(async (_url, options) => {
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ messages: [{ id: 'wamid.out456' }] }),
        };
      });

      const res = await provider.send('919876543210', 'Advisory summary', {
        isInside24hWindow: false,
        template: {
          name: 'daily_irrigation_digest',
          language: 'hi',
          parameters: ['Wheat Field 1', '1 h 47 min', '22:00-06:00'],
        },
      });

      expect(res.success).toBe(true);
      expect(capturedBody.type).toBe('template');
      expect(capturedBody.template.name).toBe('daily_irrigation_digest');
      expect(capturedBody.template.language.code).toBe('hi');
      expect(capturedBody.template.components[0].parameters).toHaveLength(3);
    });

    it('handles disabled provider gracefully when variables are absent', async () => {
      vi.spyOn(envModule, 'getEnv').mockReturnValue({
        ...envModule.getEnv(),
        WHATSAPP_PHONE_NUMBER_ID: undefined,
      });

      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const res = await provider.send('919876543210', 'Hello');
      expect(res.success).toBe(false);
      expect(res.error).toContain('disabled');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});

