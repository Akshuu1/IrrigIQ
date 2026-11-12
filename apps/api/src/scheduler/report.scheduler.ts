import { Queue, Worker, QueueEvents, Job } from 'bullmq';
import { reportService } from '../services/report.service.js';
import { ReportModel, IReportDocument } from '../models/report.model.js';
import { getEnv } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getRedisClient } from '../infra/redis.js';

export const REPORT_QUEUE_NAME = 'reports';

let reportQueue: Queue | null = null;
let reportQueueEvents: QueueEvents | null = null;
let reportWorker: Worker | null = null;

function parseRedisConnection(redisUrl: string) {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname || '127.0.0.1',
    port: parsed.port ? parseInt(parsed.port, 10) : 6379,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    maxRetriesPerRequest: null,
  };
}

export function initReportQueue(): {
  queue: Queue;
  worker: Worker;
  events: QueueEvents;
} | null {
  try {
    const env = getEnv();
    const connection = parseRedisConnection(env.REDIS_URL);

    if (!reportQueue) {
      reportQueue = new Queue(REPORT_QUEUE_NAME, {
        connection,
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      });
    }

    if (!reportQueueEvents) {
      reportQueueEvents = new QueueEvents(REPORT_QUEUE_NAME, { connection });
    }

    if (!reportWorker) {
      reportWorker = new Worker(
        REPORT_QUEUE_NAME,
        async (job: Job<{ reportId: string }>) => {
          logger.info({ reportId: job.data.reportId, jobId: job.id }, 'Processing report job');
          return await reportService.processReportGeneration(job.data.reportId);
        },
        {
          connection,
          concurrency: 2,
        },
      );

      reportWorker.on('completed', (job) => {
        logger.info({ jobId: job?.id }, 'Report job completed successfully');
      });

      reportWorker.on('failed', (job, err) => {
        logger.error({ jobId: job?.id, err }, 'Report job failed');
      });
    }

    return { queue: reportQueue, worker: reportWorker, events: reportQueueEvents };
  } catch (err) {
    logger.warn({ err }, 'Failed to initialize BullMQ report queue (falling back to in-process)');
    return null;
  }
}

/**
 * Enqueues a report generation job and waits up to 2 seconds for completion.
 * If generation completes within 2s, returns the completed report.
 * Otherwise returns the processing report so the caller can poll.
 */
export async function scheduleOrRunReportGeneration(reportId: string): Promise<IReportDocument> {
  const env = getEnv();
  const redis = getRedisClient();

  if (redis.status !== 'ready' || env.NODE_ENV === 'test') {
    // In-process generation when Redis is unavailable or in test mode
    return await reportService.processReportGeneration(reportId);
  }

  const queueObj = initReportQueue();
  if (!queueObj) {
    return await reportService.processReportGeneration(reportId);
  }

  try {
    const { queue, events } = queueObj;
    const job = await queue.add('generate-report', { reportId });

    try {
      // Wait up to 2000 ms for completion per requirement
      await job.waitUntilFinished(events, 2000);
      const finished = await ReportModel.findById(reportId);
      if (finished && finished.status === 'completed') {
        return finished;
      }
    } catch {
      logger.info({ reportId }, 'Report generation taking >2s, continuing asynchronously in BullMQ');
    }

    const current = await ReportModel.findById(reportId);
    return current!;
  } catch (err) {
    logger.warn({ err, reportId }, 'BullMQ unavailable or failed, falling back to in-process report generation');
    return await reportService.processReportGeneration(reportId);
  }
}

export async function closeReportQueue(): Promise<void> {
  if (reportWorker) {
    await reportWorker.close();
    reportWorker = null;
  }
  if (reportQueueEvents) {
    await reportQueueEvents.close();
    reportQueueEvents = null;
  }
  if (reportQueue) {
    await reportQueue.close();
    reportQueue = null;
  }
}

