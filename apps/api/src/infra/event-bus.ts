import { EventEmitter } from 'node:events';
import { getRedisClient } from './redis.js';
import { logger } from '../config/logger.js';

class MoistureEventBus extends EventEmitter {}

export const localEventBus = new MoistureEventBus();
// Increase max listeners for SSE concurrent connections
localEventBus.setMaxListeners(100);

export function getFieldMoistureChannel(fieldId: string): string {
  return `channel:field:${fieldId}:moisture`;
}

/**
 * Publishes a new moisture reading locally and to Redis if connected.
 */
export async function publishFieldMoisture(fieldId: string, reading: unknown): Promise<void> {
  const channel = getFieldMoistureChannel(fieldId);
  const payload = JSON.stringify(reading);

  // 1. Dispatch on local in-process event bus
  localEventBus.emit(channel, reading);

  // 2. Publish to Redis for cross-instance subscribers if Redis is active
  try {
    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      await redis.publish(channel, payload);
    }
  } catch (err: unknown) {
    logger.debug({ err, channel }, 'Redis publish skipped or failed, using local event bus');
  }
}

/**
 * Subscribes an SSE connection to live moisture readings for a field.
 * Returns an unsubscribe callback.
 */
export function subscribeFieldMoisture(
  fieldId: string,
  callback: (reading: unknown) => void,
): () => void {
  const channel = getFieldMoistureChannel(fieldId);

  localEventBus.on(channel, callback);

  return () => {
    localEventBus.off(channel, callback);
  };
}
