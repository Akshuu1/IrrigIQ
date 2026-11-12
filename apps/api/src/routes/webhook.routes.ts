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

// In-memory fallback dedupe map for testing or when Redis is offline (stores 'processing' | 'done')
const memoryDedupeMap = new Map<string | number, 'processing' | 'done'>();

export async function clearMemoryDedupe(): Promise<void> {
  memoryDedupeMap.clear();
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

    // 3. Deduplicate by update_id with Redis SET NX for 48 hours (172800s) tracking processing & done
    const dedupeKey = `dedupe:telegram:${parsed.updateId}`;
    let isDuplicate = false;

    try {
      const redis = getRedisClient();
      if (redis.status === 'ready') {
        const setRes = await redis.set(dedupeKey, 'processing', 'EX', 172800, 'NX');
        if (!setRes) {
          const state = await redis.get(dedupeKey);
          if (state === 'done' || state === 'processing') {
            isDuplicate = true;
          }
        }
      } else {
        throw new Error('Redis not ready');
      }
    } catch {
      // In-memory fallback
      const state = memoryDedupeMap.get(parsed.updateId);
      if (state === 'done' || state === 'processing') {
        isDuplicate = true;
      } else {
        memoryDedupeMap.set(parsed.updateId, 'processing');
        // Evict after 48h limit
        if (memoryDedupeMap.size > 50000) {
          const first = memoryDedupeMap.keys().next().value;
          if (first !== undefined) memoryDedupeMap.delete(first);
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

        // Processing completed successfully: mark state as 'done'
        try {
          const redis = getRedisClient();
          if (redis.status === 'ready') {
            await redis.set(dedupeKey, 'done', 'EX', 172800);
          } else {
            memoryDedupeMap.set(parsed.updateId, 'done');
          }
        } catch {
          memoryDedupeMap.set(parsed.updateId, 'done');
        }
      } catch (err: unknown) {
        logger.error({ err, updateId: parsed.updateId }, 'Error processing Telegram update in background');
        // Clear dedupe state so a crash does not lose the message on retry
        try {
          const redis = getRedisClient();
          if (redis.status === 'ready') {
            await redis.del(dedupeKey);
          } else {
            memoryDedupeMap.delete(parsed.updateId);
          }
        } catch {
          memoryDedupeMap.delete(parsed.updateId);
        }
      }
    });
  },
);
