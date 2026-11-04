import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { MessageChannelModel } from '../models/message-channel.model.js';
import { LinkCodeModel } from '../models/link-code.model.js';
import { UserModel } from '../models/user.model.js';
import { generateLinkCode, hashLinkCode } from '../utils/crypto.js';
import { getEnv } from '../config/env.js';
import { buildDigest } from '../services/messaging/digest.service.js';
import { processOutboundMessage } from '../services/messaging/message.queue.js';
import { AppError } from '../errors/AppError.js';

export const messagingRouter = Router();

const updateChannelSchema = z.object({
  sendTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'sendTime must be in HH:MM format')
    .optional(),
  quietHours: z
    .object({
      start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'start must be in HH:MM format'),
      end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'end must be in HH:MM format'),
    })
    .optional(),
  dailyCap: z.number().int().min(1).max(10).optional(),
});

// All messaging endpoints require authentication
messagingRouter.use(authMiddleware);

/**
 * Generates a one-time 6-digit link code and Telegram deep link for the authenticated farmer.
 */
messagingRouter.post('/link-code', async (req: Request, res: Response): Promise<void> => {
  const env = getEnv();
  const userId = req.user!.id;

  // Generate 6-digit code and 15-minute expiration
  const code = generateLinkCode();
  const codeHash = hashLinkCode(code);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  // Invalidate any previously unused link codes for this user
  await LinkCodeModel.deleteMany({ userId, used: false });

  await LinkCodeModel.create({
    codeHash,
    userId,
    expiresAt,
    used: false,
  });

  const deepLink = `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${code}`;

  res.status(201).json({
    status: 'success',
    data: {
      code,
      deepLink,
      expiresAt,
    },
  });
});

/**
 * Returns the current farmer's Telegram message channel settings and status.
 */
messagingRouter.get('/channel', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const channel = await MessageChannelModel.findOne({ userId });

  res.status(200).json({
    status: 'success',
    data: channel ? channel.toJSON() : null,
  });
});

/**
 * Updates send time, quiet hours, or daily cap for the channel.
 */
messagingRouter.patch('/channel', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const validated = updateChannelSchema.parse(req.body);

  const channel = await MessageChannelModel.findOne({ userId });
  if (!channel) {
    throw new AppError('No messaging channel found for user', 404, 'CHANNEL_NOT_FOUND');
  }

  if (validated.sendTime !== undefined) {
    channel.sendTime = validated.sendTime;
  }
  if (validated.quietHours !== undefined) {
    channel.quietHours = validated.quietHours;
  }
  if (validated.dailyCap !== undefined) {
    channel.dailyCap = validated.dailyCap;
  }

  await channel.save();

  res.status(200).json({
    status: 'success',
    data: channel.toJSON(),
  });
});

/**
 * Removes the messaging channel and associated link codes (STOP / opt-out / delete-my-data).
 */
messagingRouter.delete('/channel', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;

  await MessageChannelModel.deleteMany({ userId });
  await LinkCodeModel.deleteMany({ userId });

  res.status(200).json({
    status: 'success',
    message: 'Messaging channel and link codes removed successfully',
  });
});

/**
 * Sends a test advisory immediately to the user's active channel (bypasses quiet hours).
 */
messagingRouter.post('/test-message', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const channel = await MessageChannelModel.findOne({ userId });

  if (!channel || channel.status !== 'active') {
    throw new AppError(
      'No active Telegram channel connected. Please link your Telegram account first.',
      400,
      'CHANNEL_NOT_ACTIVE',
    );
  }

  const user = await UserModel.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const digest = await buildDigest(user, todayStr);

  const result = await processOutboundMessage({
    channelId: String(channel._id),
    userId: String(user._id),
    text: digest.text,
    options: {
      replyMarkup: {
        inlineKeyboard: digest.inlineKeyboard,
      },
    },
    ignoreQuietHours: true, // farmer explicitly clicked test button
  });

  if (!result.success) {
    throw new AppError(
      result.error || `Failed to send test message: ${result.status}`,
      502,
      'SEND_FAILED',
    );
  }

  res.status(200).json({
    status: 'success',
    message: 'Test message sent successfully',
  });
});
