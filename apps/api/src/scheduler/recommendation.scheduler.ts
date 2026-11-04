import { Queue, Worker, Job } from 'bullmq';
import { FieldModel } from '../models/field.model.js';
import { weatherCellKey, getWeatherForCell } from '../services/weather.service.js';
import { recomputeField } from '../services/recommendation.service.js';
import { getEnv } from '../config/env.js';
import { logger } from '../config/logger.js';

export const RECOMMENDATION_QUEUE_NAME = 'recommendations';
export const DAILY_RECOMMENDATION_JOB_NAME = 'daily-recommendations';

let recommendationQueue: Queue | null = null;
let recommendationWorker: Worker | null = null;

function parseRedisConnection(redisUrl: string) {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname || '127.0.0.1',
    port: parsed.port ? parseInt(parsed.port, 10) : 6379,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    maxRetriesPerRequest: null,
  };
}

/**
 * Core business logic: refreshes weather for all distinct cells,
 * then recomputes recommendations for all fields in batches of 50.
 * Resilient: an error in one field is logged and skipped, never halting the batch.
 */
export async function processDailyRecommendations(): Promise<{
  distinctCells: number;
  processedFields: number;
  failedFields: number;
}> {
  logger.info('Starting daily recommendations job at 05:00 IST');

  // Step 1: Collect all distinct weather grid cells from all fields
  const fields = await FieldModel.find({}, 'centroid');
  const distinctCellKeys = new Set<string>();

  for (const field of fields) {
    const coords = field.centroid?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const lon = coords[0];
      const lat = coords[1];
      if (typeof lat === 'number' && typeof lon === 'number') {
        distinctCellKeys.add(weatherCellKey(lat, lon));
      }
    }
  }

  logger.info(
    { count: distinctCellKeys.size },
    'Refreshing weather forecast for distinct grid cells',
  );

  // Step 2: Refresh weather for each distinct cell
  for (const cellKey of distinctCellKeys) {
    try {
      await getWeatherForCell(cellKey);
    } catch (err: unknown) {
      logger.warn(
        { err, cellKey },
        'Weather refresh failed for cell, will use fallback during field recompute',
      );
    }
  }

  // Step 3: Recompute all fields in batches of 50
  const BATCH_SIZE = 50;
  let skip = 0;
  let hasMore = true;
  let processedFields = 0;
  let failedFields = 0;

  while (hasMore) {
    const batch = await FieldModel.find({}, '_id name').skip(skip).limit(BATCH_SIZE);
    if (batch.length === 0) {
      hasMore = false;
      break;
    }

    for (const field of batch) {
      try {
        await recomputeField(field._id);
        processedFields++;
      } catch (fieldErr: unknown) {
        // One failing field is logged and skipped; it never stops the batch
        failedFields++;
        logger.error(
          { err: fieldErr, fieldId: field._id.toString(), fieldName: field.name },
          'Failed to recompute field, skipping field and continuing batch',
        );
      }
    }

    skip += batch.length;
    if (batch.length < BATCH_SIZE) {
      hasMore = false;
    }
  }

  logger.info(
    { distinctCells: distinctCellKeys.size, processedFields, failedFields },
    'Daily recommendations processing finished',
  );

  // Phase 20: Dispatch daily messaging digests to active farmer channels
  try {
    const { dispatchDailyDigests } = await import('../services/messaging/digest.service.js');
    await dispatchDailyDigests();
  } catch (err: unknown) {
    logger.warn({ err }, 'Failed to dispatch daily messaging digests');
  }

  return {
    distinctCells: distinctCellKeys.size,
    processedFields,
    failedFields,
  };
}

/**
 * Initializes the BullMQ Queue and Worker with the 05:00 Asia/Kolkata daily cron job.
 */
export async function initRecommendationScheduler(): Promise<{
  queue: Queue;
  worker: Worker;
}> {
  const env = getEnv();
  const connection = parseRedisConnection(env.REDIS_URL);

  recommendationQueue = new Queue(RECOMMENDATION_QUEUE_NAME, {
    connection,
  });

  // Schedule daily repeatable job at 05:00 IST (Asia/Kolkata) using BullMQ 6 job scheduler
  await recommendationQueue.upsertJobScheduler(
    DAILY_RECOMMENDATION_JOB_NAME,
    {
      pattern: '0 5 * * *',
      tz: 'Asia/Kolkata',
    },
    {
      name: DAILY_RECOMMENDATION_JOB_NAME,
      opts: {
        removeOnComplete: true,
        removeOnFail: false,
      },
    },
  );

  recommendationWorker = new Worker(
    RECOMMENDATION_QUEUE_NAME,
    async (job: Job) => {
      logger.info({ jobId: job.id, jobName: job.name }, 'BullMQ executing recommendation job');
      return processDailyRecommendations();
    },
    {
      connection,
      concurrency: 1,
    },
  );

  recommendationWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Recommendation job failed');
  });

  recommendationWorker.on('completed', (job) => {
    logger.info({ jobId: job?.id }, 'Recommendation job completed successfully');
  });

  return {
    queue: recommendationQueue,
    worker: recommendationWorker,
  };
}

export async function stopRecommendationScheduler(): Promise<void> {
  if (recommendationWorker) {
    await recommendationWorker.close();
    recommendationWorker = null;
  }
  if (recommendationQueue) {
    await recommendationQueue.close();
    recommendationQueue = null;
  }
}
