import { Queue, Worker, Job } from 'bullmq';
import { getEnv } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { MessageChannelModel } from '../../models/message-channel.model.js';
import { OutboundMessageModel } from '../../models/outbound-message.model.js';
import { decryptExternalId } from '../../utils/crypto.js';
import { TelegramProvider } from './telegram.provider.js';
import { WhatsAppCloudProvider } from './whatsapp.provider.js';
import type { SendMessageOptions, SendMessageResult } from './provider.interface.js';

export const MESSAGES_QUEUE_NAME = 'messages';

export interface SendMessageJobData {
  channelId: string;
  userId: string;
  text: string;
  options?: SendMessageOptions;
  ignoreQuietHours?: boolean; // For explicit user-initiated tests
}

export function isWithinQuietHours(
  currentTimeHHMM: string,
  quietHours: { start: string; end: string },
): boolean {
  const { start, end } = quietHours;
  if (!start || !end || start === end) {
    return false;
  }
  if (start < end) {
    return currentTimeHHMM >= start && currentTimeHHMM < end;
  }
  // Midnight crossing: e.g. 22:00 to 06:00
  return currentTimeHHMM >= start || currentTimeHHMM < end;
}

function parseRedisConnection(redisUrl: string) {
  try {
    const parsed = new URL(redisUrl);
    return {
      host: parsed.hostname || '127.0.0.1',
      port: parsed.port ? parseInt(parsed.port, 10) : 6379,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
      maxRetriesPerRequest: null,
    };
  } catch {
    return {
      host: '127.0.0.1',
      port: 6379,
      maxRetriesPerRequest: null,
    };
  }
}

let messagesQueue: Queue<SendMessageJobData> | null = null;
let messagesWorker: Worker<SendMessageJobData> | null = null;

const telegramProvider = new TelegramProvider();
const whatsappProvider = new WhatsAppCloudProvider();

/**
 * Core delivery processor: checks channel, quiet hours, daily cap, decrypts chat ID,
 * calls provider, and handles permanent failure without impacting other users.
 */
export async function processOutboundMessage(jobData: SendMessageJobData): Promise<{
  success: boolean;
  status: string;
  error?: string;
}> {
  const { channelId, text, options, ignoreQuietHours } = jobData;

  const channel = await MessageChannelModel.findById(channelId);
  if (!channel) {
    logger.warn({ channelId }, 'Channel not found for outbound message delivery');
    return { success: false, status: 'channel_not_found' };
  }

  if (channel.status !== 'active' && !ignoreQuietHours) {
    logger.info({ channelId, status: channel.status }, 'Skipping delivery to inactive channel');
    return { success: false, status: 'channel_inactive' };
  }

  const now = new Date();
  const currentISTTime = now.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  const todayISTDate = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  // 1. Quiet Hours Check
  if (!ignoreQuietHours && isWithinQuietHours(currentISTTime, channel.quietHours)) {
    logger.info(
      { channelId, currentISTTime, quietHours: channel.quietHours },
      'Outbound message skipped due to quiet hours',
    );
    await OutboundMessageModel.create({
      channelId: channel._id,
      userId: channel.userId,
      provider: channel.provider,
      text,
      payload: options?.replyMarkup as Record<string, unknown>,
      status: 'skipped_quiet_hours',
    });
    return { success: false, status: 'skipped_quiet_hours' };
  }

  // 2. Daily Cap Check
  if (channel.lastSentDate !== todayISTDate) {
    channel.messagesSentToday = 0;
    channel.lastSentDate = todayISTDate;
  }

  if (!ignoreQuietHours && channel.messagesSentToday >= channel.dailyCap) {
    logger.info(
      { channelId, count: channel.messagesSentToday, cap: channel.dailyCap },
      'Outbound message skipped due to daily cap',
    );
    await OutboundMessageModel.create({
      channelId: channel._id,
      userId: channel.userId,
      provider: channel.provider,
      text,
      payload: options?.replyMarkup as Record<string, unknown>,
      status: 'skipped_cap',
    });
    return { success: false, status: 'skipped_cap' };
  }

  // 3. Decrypt chat ID for API invocation only (NEVER log externalId)
  let externalId: string;
  try {
    externalId = decryptExternalId(channel.externalIdEncrypted);
  } catch (err: unknown) {
    logger.error({ err, channelId }, 'Failed to decrypt external ID for delivery');
    return { success: false, status: 'decryption_error', error: 'Decryption failed' };
  }

  // 4. Send via configured Provider (WhatsApp or Telegram)
  let sendResult: SendMessageResult;
  if (channel.provider === 'whatsapp') {
    const isInside24hWindow = Boolean(
      channel.lastInboundAt && Date.now() - channel.lastInboundAt.getTime() < 24 * 3600 * 1000,
    );
    sendResult = await whatsappProvider.send(externalId, text, {
      ...options,
      isInside24hWindow,
    });
  } else {
    sendResult = await telegramProvider.send(externalId, text, options);
  }

  // 5. Handle Permanent Failures (e.g. 403 Bot Blocked)
  if (sendResult.permanentFailure) {
    channel.status = 'deactivated';
    channel.optedIn = false;
    await channel.save();
    logger.warn({ channelId }, 'Channel permanently deactivated due to bot block / chat deleted');
  }

  if (sendResult.success) {
    channel.messagesSentToday += 1;
    channel.lastSentDate = todayISTDate;
    await channel.save();

    await OutboundMessageModel.create({
      channelId: channel._id,
      userId: channel.userId,
      provider: channel.provider,
      text,
      payload: options?.replyMarkup as Record<string, unknown>,
      status: 'sent',
      sentAt: new Date(),
    });

    return { success: true, status: 'sent' };
  }

  await OutboundMessageModel.create({
    channelId: channel._id,
    userId: channel.userId,
    provider: channel.provider,
    text,
    payload: options?.replyMarkup as Record<string, unknown>,
    status: 'failed',
    error: sendResult.error,
  });

  return { success: false, status: 'failed', error: sendResult.error };
}

/**
 * Enqueues a message in BullMQ queue, or delivers in-process if BullMQ is disabled/testing.
 */
export async function enqueueOutboundMessage(jobData: SendMessageJobData): Promise<void> {
  // If in test or queue uninitialized, execute in-process
  if (process.env.NODE_ENV === 'test' || !messagesQueue) {
    await processOutboundMessage(jobData);
    return;
  }

  try {
    await messagesQueue.add('send_message', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    });
  } catch (err: unknown) {
    logger.warn({ err }, 'Failed to enqueue to BullMQ, falling back to direct delivery');
    await processOutboundMessage(jobData);
  }
}

/**
 * Initializes BullMQ queue and worker for message delivery with rate limiting.
 */
export function initMessagesQueue(): { queue: Queue; worker: Worker } {
  const env = getEnv();
  const connection = parseRedisConnection(env.REDIS_URL);

  messagesQueue = new Queue<SendMessageJobData>(MESSAGES_QUEUE_NAME, {
    connection,
  });

  // Global rate limit: 25 jobs per 1 second to respect Telegram's 30/s limit
  messagesWorker = new Worker<SendMessageJobData>(
    MESSAGES_QUEUE_NAME,
    async (job: Job<SendMessageJobData>) => {
      await processOutboundMessage(job.data);
    },
    {
      connection,
      limiter: {
        max: 25,
        duration: 1000,
      },
      concurrency: 5,
    },
  );

  messagesWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Messages queue job failed after retries');
  });

  return { queue: messagesQueue, worker: messagesWorker };
}
