import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { FieldModel } from '../models/field.model.js';
import { SensorModel, ISensorDocument } from '../models/sensor.model.js';
import { SensorReadingModel } from '../models/sensor-reading.model.js';
import {
  CreateSensorInput,
  IngestReadingInput,
} from '../schemas/sensor.schema.js';
import { recomputeField } from './recommendation.service.js';
import { publishFieldMoisture } from '../infra/event-bus.js';
import { getRedisClient } from '../infra/redis.js';
import { AppError } from '../errors/AppError.js';
import { logger } from '../config/logger.js';

// In-memory debounce set fallback for testing/offline mode
const memoryDebounceSet = new Set<string>();
const memoryPrevMoisture = new Map<string, number>();

export class SensorService {
  /**
   * Hashes a raw API key using SHA-256.
   */
  hashApiKey(apiKey: string): string {
    return crypto.createHash('sha256').update(apiKey.trim()).digest('hex');
  }

  /**
   * Creates a sensor for a field, generating an API key.
   * Returns the raw API key once; only the hash is stored in the database.
   */
  async createSensor(
    userId: string,
    fieldId: string,
    input: CreateSensorInput,
  ): Promise<{ sensor: ISensorDocument; apiKey: string }> {
    if (!Types.ObjectId.isValid(fieldId)) {
      throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
    }

    const field = await FieldModel.findOne({
      _id: new Types.ObjectId(fieldId),
      userId: new Types.ObjectId(userId),
    });

    if (!field) {
      throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
    }

    // Generate random 24-byte API key
    const rawApiKey = `iq_sn_${crypto.randomBytes(24).toString('hex')}`;
    const apiKeyHash = this.hashApiKey(rawApiKey);

    const sensor = await SensorModel.create({
      fieldId: field._id,
      userId: field.userId,
      name: input.name,
      apiKeyHash,
      isSimulated: input.isSimulated ?? true,
    });

    return {
      sensor,
      apiKey: rawApiKey,
    };
  }

  /**
   * Lists sensors for a given field and verified owner.
   */
  async getSensors(userId: string, fieldId: string): Promise<ISensorDocument[]> {
    if (!Types.ObjectId.isValid(fieldId)) {
      throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
    }

    const field = await FieldModel.findOne({
      _id: new Types.ObjectId(fieldId),
      userId: new Types.ObjectId(userId),
    });

    if (!field) {
      throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
    }

    return SensorModel.find({
      fieldId: field._id,
      userId: new Types.ObjectId(userId),
    }).sort({ createdAt: -1 });
  }

  /**
   * Ingests sensor readings authenticated via the sensor API key.
   * Validates values, caches latest reading, publishes SSE event,
   * and triggers debounced recomputeField if thresholds (40% or 80%) are crossed.
   */
  async ingestReadings(
    apiKey: string,
    input: IngestReadingInput,
  ): Promise<{ ingestedCount: number; lastReading: { timestamp: Date; moisturePct: number; tempC: number } }> {
    if (!apiKey) {
      throw new AppError('Sensor API key required', 401, 'INVALID_API_KEY');
    }

    const apiKeyHash = this.hashApiKey(apiKey);
    const sensor = await SensorModel.findOne({ apiKeyHash });

    if (!sensor) {
      throw new AppError('Invalid sensor API key', 401, 'INVALID_API_KEY');
    }

    const readingsList = Array.isArray(input) ? input : [input];
    const now = new Date();

    // Map to time series documents.
    // Note: metadata.fieldId and metadata.sensorId are set from the verified sensor document,
    // ensuring one sensor key can NEVER write to another field.
    const docs = readingsList.map((r) => ({
      timestamp: r.timestamp ? new Date(r.timestamp) : now,
      metadata: {
        sensorId: sensor._id,
        fieldId: sensor.fieldId,
      },
      moisturePct: r.moisturePct,
      tempC: r.tempC,
    }));

    await SensorReadingModel.insertMany(docs);

    // Update sensor's lastSeenAt
    sensor.lastSeenAt = now;
    await sensor.save();

    const lastDoc = docs[docs.length - 1]!;
    const fieldIdStr = sensor.fieldId.toString();

    // Cache latest reading in Redis
    try {
      const redis = getRedisClient();
      if (redis && redis.status === 'ready') {
        await redis.set(
          `field:${fieldIdStr}:latest_moisture`,
          JSON.stringify(lastDoc),
          'EX',
          86400,
        );
      }
    } catch (err: unknown) {
      logger.debug({ err }, 'Redis latest reading cache set failed, continuing');
    }

    // Publish to live SSE stream
    await publishFieldMoisture(fieldIdStr, {
      fieldId: fieldIdStr,
      sensorId: sensor._id.toString(),
      timestamp: lastDoc.timestamp.toISOString(),
      moisturePct: lastDoc.moisturePct,
      tempC: lastDoc.tempC,
    });

    // Check threshold crossings: 40% (water stress) or 80% (saturation)
    await this.handleThresholdCrossing(sensor.fieldId, lastDoc.moisturePct, lastDoc.timestamp);

    return {
      ingestedCount: docs.length,
      lastReading: {
        timestamp: lastDoc.timestamp,
        moisturePct: lastDoc.moisturePct,
        tempC: lastDoc.tempC,
      },
    };
  }

  /**
   * Checks if moisture crossed 40% or 80% and enqueues recomputeField with a 60-second debounce window.
   */
  async handleThresholdCrossing(
    fieldId: Types.ObjectId,
    currentMoisture: number,
    readingTime: Date,
  ): Promise<boolean> {
    const fieldIdStr = fieldId.toString();
    const prevKey = `field:${fieldIdStr}:prev_moisture`;
    const debounceKey = `debounce:recompute:${fieldIdStr}`;

    let prevMoisture: number | null = null;
    let redisAvailable = false;

    try {
      const redis = getRedisClient();
      if (redis && redis.status === 'ready') {
        redisAvailable = true;
        const val = await redis.get(prevKey);
        if (val !== null) {
          prevMoisture = parseFloat(val);
        }
        await redis.set(prevKey, currentMoisture.toString(), 'EX', 86400);
      }
    } catch {
      redisAvailable = false;
    }

    if (!redisAvailable) {
      prevMoisture = memoryPrevMoisture.get(fieldIdStr) ?? null;
      memoryPrevMoisture.set(fieldIdStr, currentMoisture);
    }

    // Determine if threshold (40% or 80%) was crossed
    let crossed = false;
    if (prevMoisture === null) {
      // First reading: trigger if in extreme range
      crossed = currentMoisture <= 40 || currentMoisture >= 80;
    } else {
      const crossed40 =
        (prevMoisture > 40 && currentMoisture <= 40) ||
        (prevMoisture <= 40 && currentMoisture > 40);
      const crossed80 =
        (prevMoisture < 80 && currentMoisture >= 80) ||
        (prevMoisture >= 80 && currentMoisture < 80);
      crossed = crossed40 || crossed80;
    }

    if (!crossed) {
      return false;
    }

    // Enqueue recomputeField (debounced by 60 seconds)
    let acquiredLock = false;
    if (redisAvailable) {
      try {
        const redis = getRedisClient();
        const res = await redis.set(debounceKey, '1', 'EX', 60, 'NX');
        acquiredLock = res === 'OK';
      } catch {
        acquiredLock = true;
      }
    } else {
      if (!memoryDebounceSet.has(debounceKey)) {
        memoryDebounceSet.add(debounceKey);
        setTimeout(() => memoryDebounceSet.delete(debounceKey), 60000).unref();
        acquiredLock = true;
      }
    }

    if (acquiredLock) {
      logger.info(
        { fieldId: fieldIdStr, currentMoisture, prevMoisture },
        'Moisture crossed threshold (40% or 80%), enqueuing recomputeField',
      );
      try {
        await recomputeField(fieldId, {
          sensorReading: {
            moisturePct: currentMoisture,
            recordedAt: readingTime,
          },
        });
      } catch (err: unknown) {
        logger.error({ err, fieldId: fieldIdStr }, 'Recompute failed after sensor threshold crossing');
      }
      return true;
    }

    logger.debug(
      { fieldId: fieldIdStr },
      'Threshold crossed but recompute suppressed by debounce window',
    );
    return false;
  }

  /**
   * Retrieves moisture history, automatically downsampling with aggregation for wide ranges.
   */
  async getMoistureHistory(
    userId: string,
    fieldId: string,
    fromStr?: string,
    toStr?: string,
  ): Promise<Array<{ timestamp: Date; moisturePct: number; tempC: number; count?: number }>> {
    if (!Types.ObjectId.isValid(fieldId)) {
      throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
    }

    const field = await FieldModel.findOne({
      _id: new Types.ObjectId(fieldId),
      userId: new Types.ObjectId(userId),
    });

    if (!field) {
      throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
    }

    const toDate = toStr ? new Date(toStr) : new Date();
    const fromDate = fromStr ? new Date(fromStr) : new Date(toDate.getTime() - 24 * 60 * 60 * 1000);

    const spanHours = (toDate.getTime() - fromDate.getTime()) / (3600 * 1000);

    // If span > 24 hours, downsample via aggregation into 1-hour or daily buckets
    if (spanHours > 24) {
      const bucketUnit = spanHours > 24 * 14 ? 'day' : 'hour';

      const aggregated = await SensorReadingModel.aggregate([
        {
          $match: {
            'metadata.fieldId': field._id,
            timestamp: { $gte: fromDate, $lte: toDate },
          },
        },
        {
          $group: {
            _id: {
              $dateTrunc: {
                date: '$timestamp',
                unit: bucketUnit,
              },
            },
            moisturePct: { $avg: '$moisturePct' },
            tempC: { $avg: '$tempC' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            _id: 0,
            timestamp: '$_id',
            moisturePct: { $round: ['$moisturePct', 1] },
            tempC: { $round: ['$tempC', 1] },
            count: 1,
          },
        },
      ]);

      return aggregated;
    }

    // Short range: return raw points sorted by timestamp asc (max 200)
    const readings = await SensorReadingModel.find({
      'metadata.fieldId': field._id,
      timestamp: { $gte: fromDate, $lte: toDate },
    })
      .sort({ timestamp: 1 })
      .limit(200);

    return readings.map((r) => ({
      timestamp: r.timestamp,
      moisturePct: r.moisturePct,
      tempC: r.tempC,
    }));
  }

  /**
   * Retrieves the latest reading for a field.
   */
  async getLatestReading(
    fieldId: Types.ObjectId | string,
  ): Promise<{ timestamp: Date; moisturePct: number; tempC: number } | null> {
    const fieldObjectId = typeof fieldId === 'string' ? new Types.ObjectId(fieldId) : fieldId;
    const reading = await SensorReadingModel.findOne({
      'metadata.fieldId': fieldObjectId,
    }).sort({ timestamp: -1 });

    if (!reading) return null;

    return {
      timestamp: reading.timestamp,
      moisturePct: reading.moisturePct,
      tempC: reading.tempC,
    };
  }
}

export const sensorService = new SensorService();
