import mongoose, { Document, Schema } from 'mongoose';

export type WeatherSource = 'open-meteo' | 'hargreaves';

export interface IWeatherDay {
  cellKey: string;
  date: string; // YYYY-MM-DD
  tmaxC: number;
  tminC: number;
  rainMm: number;
  et0Mm: number;
  windSpeedMaxKmh?: number;
  source: WeatherSource;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IWeatherDayDocument extends IWeatherDay, Document {}

const weatherDaySchema = new Schema<IWeatherDayDocument>(
  {
    cellKey: {
      type: String,
      required: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    tmaxC: {
      type: Number,
      required: true,
    },
    tminC: {
      type: Number,
      required: true,
    },
    rainMm: {
      type: Number,
      required: true,
      min: 0,
    },
    et0Mm: {
      type: Number,
      required: true,
      min: 0,
      max: 15,
    },
    windSpeedMaxKmh: {
      type: Number,
      default: 0,
    },
    source: {
      type: String,
      enum: ['open-meteo', 'hargreaves'],
      required: true,
    },
    fetchedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = ret._id ? ret._id.toString() : undefined;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

// Unique compound index: { cellKey: 1, date: 1 }
weatherDaySchema.index({ cellKey: 1, date: 1 }, { unique: true });

// TTL index: automatically expire cache entries after 30 days
weatherDaySchema.index({ fetchedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export const WeatherDayModel = mongoose.model<IWeatherDayDocument>('WeatherDay', weatherDaySchema);
