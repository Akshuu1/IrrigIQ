import crypto from 'node:crypto';
import { getEnv } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type {
  MessagingProvider,
  SendMessageOptions,
  SendMessageResult,
  InboundUpdate,
} from './provider.interface.js';

export class WhatsAppCloudProvider implements MessagingProvider {
  public readonly name = 'whatsapp';

  /**
   * Checks whether the WhatsApp Cloud Provider has all required credentials configured.
   */
  public isEnabled(): boolean {
    const env = getEnv();
    return Boolean(
      env.WHATSAPP_PHONE_NUMBER_ID &&
        env.WHATSAPP_ACCESS_TOKEN &&
        env.WHATSAPP_WEBHOOK_VERIFY_TOKEN &&
        env.WHATSAPP_APP_SECRET,
    );
  }

  private get phoneNumberId(): string | undefined {
    return getEnv().WHATSAPP_PHONE_NUMBER_ID;
  }

  private get accessToken(): string | undefined {
    return getEnv().WHATSAPP_ACCESS_TOKEN;
  }

  private get verifyToken(): string | undefined {
    return getEnv().WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  }

  private get appSecret(): string | undefined {
    return getEnv().WHATSAPP_APP_SECRET;
  }

  private get apiBase(): string {
    return `https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`;
  }

  /**
   * Verifies the GET webhook verification challenge from Meta.
   */
  public verifyWebhookChallenge(query: Record<string, unknown>): string | null {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === this.verifyToken && typeof challenge === 'string') {
      return challenge;
    }
    return null;
  }

  /**
   * Verifies the X-Hub-Signature-256 header on POST requests using the App Secret.
   * Compares HMAC-SHA256 signature in constant time using crypto.timingSafeEqual.
   */
  public verifyInbound(req: {
    headers: Record<string, string | string[] | undefined>;
    body?: unknown;
    rawBody?: Buffer;
  }): boolean {
    if (!this.appSecret) {
      return false;
    }

    const rawHeader =
      req.headers['x-hub-signature-256'] || req.headers['X-Hub-Signature-256'];
    const signatureHeader = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
      return false;
    }

    const receivedSignature = signatureHeader.slice(7); // remove 'sha256='

    let bodyBuffer: Buffer;
    if (req.rawBody && Buffer.isBuffer(req.rawBody)) {
      bodyBuffer = req.rawBody;
    } else if (typeof req.body === 'string') {
      bodyBuffer = Buffer.from(req.body, 'utf8');
    } else if (req.body) {
      bodyBuffer = Buffer.from(JSON.stringify(req.body), 'utf8');
    } else {
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.appSecret)
      .update(bodyBuffer)
      .digest('hex');

    if (receivedSignature.length !== expectedSignature.length) {
      return false;
    }

    try {
      return crypto.timingSafeEqual(
        Buffer.from(receivedSignature, 'utf8'),
        Buffer.from(expectedSignature, 'utf8'),
      );
    } catch {
      return false;
    }
  }

  /**
   * Parses an inbound WhatsApp Cloud API update from Meta.
   */
  public parseInbound(body: unknown): InboundUpdate | null {
    if (!body || typeof body !== 'object') {
      return null;
    }

    const payload = body as Record<string, unknown>;
    const entry = Array.isArray(payload.entry) ? (payload.entry[0] as Record<string, unknown>) : null;
    const changes = entry && Array.isArray(entry.changes) ? (entry.changes[0] as Record<string, unknown>) : null;
    const value = changes?.value as Record<string, unknown> | undefined;

    if (!value || value.messaging_product !== 'whatsapp') {
      return null;
    }

    const messages = Array.isArray(value.messages) ? value.messages : null;
    if (!messages || messages.length === 0) {
      return null;
    }

    const msg = messages[0] as Record<string, unknown>;
    const updateId = typeof msg.id === 'string' ? msg.id : String(msg.id || Date.now());
    const from = typeof msg.from === 'string' ? msg.from : '';

    if (!from) {
      return null;
    }

    const contacts = Array.isArray(value.contacts) ? (value.contacts[0] as Record<string, unknown>) : null;
    const profile = contacts?.profile as Record<string, unknown> | undefined;
    const fromName = typeof profile?.name === 'string' ? profile.name : undefined;

    // 1. Interactive Button Reply
    if (msg.type === 'interactive' && msg.interactive && typeof msg.interactive === 'object') {
      const interactive = msg.interactive as Record<string, unknown>;
      const buttonReply = interactive.button_reply as Record<string, unknown> | undefined;
      return {
        updateId,
        externalId: from,
        callbackData: typeof buttonReply?.id === 'string' ? buttonReply.id : undefined,
        text: typeof buttonReply?.title === 'string' ? buttonReply.title : undefined,
        messageId: updateId,
        fromName,
      };
    }

    // 2. Text Message
    if (msg.type === 'text' && msg.text && typeof msg.text === 'object') {
      const textObj = msg.text as Record<string, unknown>;
      return {
        updateId,
        externalId: from,
        text: typeof textObj.body === 'string' ? textObj.body : undefined,
        messageId: updateId,
        fromName,
      };
    }

    // 3. Fallback for Quick Reply button
    if (msg.type === 'button' && msg.button && typeof msg.button === 'object') {
      const buttonObj = msg.button as Record<string, unknown>;
      return {
        updateId,
        externalId: from,
        callbackData: typeof buttonObj.payload === 'string' ? buttonObj.payload : undefined,
        text: typeof buttonObj.text === 'string' ? buttonObj.text : undefined,
        messageId: updateId,
        fromName,
      };
    }

    return null;
  }

  /**
   * Sends a message to a WhatsApp user.
   * If inside 24h window: uses interactive buttons or session text.
   * If outside 24h window: uses pre-approved template message (daily_irrigation_digest).
   */
  public async send(
    externalId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<SendMessageResult> {
    if (!this.isEnabled()) {
      return {
        success: false,
        error: 'WhatsAppCloudProvider is disabled (missing environment credentials)',
      };
    }

    try {
      const isInside24h = Boolean(options?.isInside24hWindow);
      let requestBody: Record<string, unknown>;

      if (isInside24h) {
        // Inside 24h Service Window: Session Messages Allowed
        const buttons = options?.replyMarkup?.inlineKeyboard
          ? options.replyMarkup.inlineKeyboard
              .flat()
              .slice(0, 3) // Meta allows max 3 reply buttons
              .map((btn) => ({
                type: 'reply' as const,
                reply: {
                  id: btn.callbackData || btn.text.slice(0, 20),
                  title: btn.text.slice(0, 20), // Meta max 20 chars
                },
              }))
          : [];

        if (buttons.length > 0) {
          // Interactive button message
          requestBody = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: externalId,
            type: 'interactive',
            interactive: {
              type: 'button',
              body: { text },
              action: { buttons },
            },
          };
        } else {
          // Plain session text
          requestBody = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: externalId,
            type: 'text',
            text: { body: text, preview_url: false },
          };
        }
      } else {
        // Outside 24h Window: Meta enforces pre-approved Utility Template
        const templateName = options?.template?.name || 'daily_irrigation_digest';
        const templateLang = options?.template?.language || 'en';
        const params = options?.template?.parameters || [text];

        requestBody = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: externalId,
          type: 'template',
          template: {
            name: templateName,
            language: { code: templateLang },
            components: [
              {
                type: 'body',
                parameters: params.map((p) => ({
                  type: 'text',
                  text: p.slice(0, 1024),
                })),
              },
            ],
          },
        };
      }

      const response = await fetch(this.apiBase, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const data = (await response.json().catch(() => ({}))) as {
        messages?: Array<{ id: string }>;
        error?: {
          message: string;
          code: number;
          error_subcode?: number;
          error_data?: { details: string };
        };
      };

      if (!response.ok || data.error) {
        const errorCode = data.error?.code;
        const isPermanent =
          response.status === 400 &&
          (errorCode === 131030 || // Recipient phone number not in allowed list
            errorCode === 131026 || // Message undeliverable
            errorCode === 100); // Invalid parameter / unregistered number

        logger.warn(
          { status: response.status, errorCode, error: data.error?.message },
          'WhatsApp Cloud API sendMessage failed',
        );

        return {
          success: false,
          permanentFailure: isPermanent,
          error: data.error?.message || `HTTP ${response.status}`,
        };
      }

      const messageId = data.messages && data.messages[0]?.id;
      return {
        success: true,
        messageId,
      };
    } catch (err: unknown) {
      logger.error({ err }, 'Network error calling WhatsApp Cloud API');
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

