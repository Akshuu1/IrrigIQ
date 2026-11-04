import { Router, Request, Response } from 'express';
import { TelegramProvider } from '../services/messaging/telegram.provider.js';
import { handleReply } from '../services/messaging/reply-handler.service.js';
import { MessageChannelModel } from '../models/message-channel.model.js';
import { InboundMessageModel } from '../models/inbound-message.model.js';
import { LinkCodeModel } from '../models/link-code.model.js';
import { encryptExternalId, hashExternalId, hashLinkCode } from '../utils/crypto.js';
import { getRedisClient } from '../infra/redis.js';
import { logger } from '../config/logger.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';

export const webhookRouter = Router();

const telegramProvider = new TelegramProvider();

// In-memory fallback dedupe set for testing or when Redis is offline
const memoryDedupeSet = new Set<number>();

export async function clearMemoryDedupe(): Promise<void> {
  memoryDedupeSet.clear();
  try {
    const redis = getRedisClient();
    const keys = await redis.keys('dedupe:telegram:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch {
    // Ignore if redis is unavailable
  }
}

// Rate limiter for webhook endpoint (e.g. 100 requests per minute)
const webhookRateLimiter = createRateLimiter({
  windowSeconds: 60,
  maxRequests: 100,
  prefix: 'webhook:telegram',
});

webhookRouter.post(
  '/telegram',
  webhookRateLimiter,
  async (req: Request, res: Response): Promise<void> => {
    // 1. Verify Secret Token Header first
    const isValidSecret = telegramProvider.verifyInbound({
      headers: req.headers,
      body: req.body,
    });

    if (!isValidSecret) {
      logger.warn('Rejected Telegram webhook with missing or invalid secret token');
      res.status(401).json({
        status: 'error',
        code: 'UNAUTHORIZED_WEBHOOK',
        message: 'Invalid webhook secret token',
      });
      return;
    }

    // 2. Parse Inbound Update
    const parsed = telegramProvider.parseInbound(req.body);
    if (!parsed || typeof parsed.updateId !== 'number') {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    // 3. Deduplicate by update_id with Redis SET NX for 48 hours (172800s)
    const dedupeKey = `dedupe:telegram:${parsed.updateId}`;
    let isDuplicate = false;

    try {
      const redis = getRedisClient();
      const setRes = await redis.set(dedupeKey, '1', 'EX', 172800, 'NX');
      if (!setRes) {
        isDuplicate = true;
      }
    } catch {
      // In-memory fallback
      if (memoryDedupeSet.has(parsed.updateId)) {
        isDuplicate = true;
      } else {
        memoryDedupeSet.add(parsed.updateId);
        // Evict after 48h limit
        if (memoryDedupeSet.size > 50000) {
          const first = memoryDedupeSet.values().next().value;
          if (first !== undefined) memoryDedupeSet.delete(first);
        }
      }
    }

    if (isDuplicate) {
      logger.info({ updateId: parsed.updateId }, 'Duplicate Telegram update received, ignoring');
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }

    // 4. Respond 200 Fast to Telegram
    res.status(200).json({ ok: true });

    // 5. Process Update in Background
    setImmediate(async () => {
      try {
        const inboundDoc = await InboundMessageModel.create({
          provider: 'telegram',
          updateId: parsed.updateId,
          rawUpdate: req.body as Record<string, unknown>,
        });

        const externalIdHash = hashExternalId(parsed.externalId);
        let channel = await MessageChannelModel.findOne({ externalIdHash });

        // Handle Linking with /start <code>
        const rawText = parsed.text || parsed.callbackData || '';
        const trimmed = rawText.trim();

        if (!channel && (trimmed.startsWith('/start') || trimmed.startsWith('start'))) {
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 2 && parts[1]) {
            const code = parts[1];
            const codeHash = hashLinkCode(code);
            const linkDoc = await LinkCodeModel.findOne({
              codeHash,
              used: false,
              expiresAt: { $gt: new Date() },
            });

            if (linkDoc) {
              linkDoc.used = true;
              await linkDoc.save();

              // Create channel for linked user
              channel = await MessageChannelModel.create({
                userId: linkDoc.userId,
                provider: 'telegram',
                externalIdEncrypted: encryptExternalId(parsed.externalId),
                externalIdHash,
                status: 'pending_opt_in',
                optedIn: false,
              });
            }
          }
        }

        if (channel) {
          inboundDoc.channelId = channel._id;
          const reply = await handleReply(channel, rawText);

          inboundDoc.replyAction = reply.actionTaken;
          inboundDoc.processed = true;
          await inboundDoc.save();

          await telegramProvider.send(
            parsed.externalId,
            reply.text,
            reply.replyMarkup ? { replyMarkup: reply.replyMarkup } : undefined,
          );
        } else {
          // Unlinked user sending messages
          const unlinkedMsg =
            '🌾 Welcome to IrrigIQ!\nPlease generate a linking code in your IrrigIQ app dashboard to link your farmer advisory account.';
          await telegramProvider.send(parsed.externalId, unlinkedMsg);
        }
      } catch (err: unknown) {
        logger.error({ err, updateId: parsed.updateId }, 'Error processing Telegram update in background');
      }
    });
  },
);
