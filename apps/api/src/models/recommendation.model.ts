import mongoose, { Document, Schema, Types } from 'mongoose';

export type RecommendationAction = 'irrigate' | 'skip';

export interface IRecommendation {
  fieldId: Types.ObjectId;
  userId: Types.ObjectId;
  forDate: string; // YYYY-MM-DD
  action: RecommendationAction;
  netMm: number;
  grossMm: number;
  litres: number;
  runMinutes: number | null;
  splitAcrossDays: boolean;
  pumpCost: number | null;
  pumpMissing: boolean;
  reasonKey: string;
  params: Record<string, number | string>;
  deficitMm: number;
  et0Mm: number;
  kc: number;
  etcMm: number;
  rainMm: number;
  effectiveRainMm: number;
  staleWeather: boolean;
  computedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRecommendationDocument extends IRecommendation, Document {}

const recommendationSchema = new Schema<IRecommendationDocument>(
  {
    fieldId: {
      type: Schema.Types.ObjectId,
      ref: 'Field',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    forDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    action: {
      type: String,
      enum: ['irrigate', 'skip'],
      required: true,
    },
    netMm: {
      type: Number,
      required: true,
      min: 0,
    },
    grossMm: {
      type: Number,
      required: true,
      min: 0,
    },
    litres: {
      type: Number,
      required: true,
      min: 0,
    },
    runMinutes: {
      type: Number,
      default: null,
    },
    splitAcrossDays: {
      type: Boolean,
      default: false,
    },
    pumpCost: {
      type: Number,
      default: null,
    },
    pumpMissing: {
      type: Boolean,
      default: false,
    },
    reasonKey: {
      type: String,
      required: true,
    },
    params: {
      type: Schema.Types.Mixed,
      default: {},
    },
    deficitMm: {
      type: Number,
      required: true,
      min: 0,
    },
    et0Mm: {
      type: Number,
      required: true,
      min: 0,
    },
    kc: {
      type: Number,
      required: true,
      min: 0,
    },
    etcMm: {
      type: Number,
      required: true,
      min: 0,
    },
    rainMm: {
      type: Number,
      required: true,
      min: 0,
    },
    effectiveRainMm: {
      type: Number,
      required: true,
      min: 0,
    },
    staleWeather: {
      type: Boolean,
      default: false,
    },
    computedAt: {
      type: Date,
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

// Unique index: { fieldId: 1, forDate: 1 }
recommendationSchema.index({ fieldId: 1, forDate: 1 }, { unique: true });
recommendationSchema.index({ userId: 1, forDate: -1 });

export const RecommendationModel = mongoose.model<IRecommendationDocument>(
  'Recommendation',
  recommendationSchema,
);
