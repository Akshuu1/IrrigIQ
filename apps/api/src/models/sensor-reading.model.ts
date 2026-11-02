import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ISensorReadingMetadata {
  sensorId: Types.ObjectId;
  fieldId: Types.ObjectId;
}

export interface ISensorReading {
  timestamp: Date;
  metadata: ISensorReadingMetadata;
  moisturePct: number;
  tempC: number;
}

export interface ISensorReadingDocument extends ISensorReading, Document {
  _id: Types.ObjectId;
}

const sensorReadingMetadataSchema = new Schema<ISensorReadingMetadata>(
  {
    sensorId: {
      type: Schema.Types.ObjectId,
      ref: 'Sensor',
      required: true,
      index: true,
    },
    fieldId: {
      type: Schema.Types.ObjectId,
      ref: 'Field',
      required: true,
      index: true,
    },
  },
  { _id: false },
);

const sensorReadingSchema = new Schema<ISensorReadingDocument>(
  {
    timestamp: {
      type: Date,
      required: true,
    },
    metadata: {
      type: sensorReadingMetadataSchema,
      required: true,
    },
    moisturePct: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    tempC: {
      type: Number,
      required: true,
      min: -10,
      max: 60,
    },
  },
  {
    timeseries: {
      timeField: 'timestamp',
      metaField: 'metadata',
      granularity: 'seconds',
    },
    expireAfterSeconds: 90 * 24 * 60 * 60, // 90 days TTL
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id ? (ret._id as Types.ObjectId).toString() : undefined;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

export const SensorReadingModel = mongoose.model<ISensorReadingDocument>(
  'SensorReading',
  sensorReadingSchema,
);
