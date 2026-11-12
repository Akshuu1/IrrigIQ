import { Schema, model, Document, Types } from 'mongoose';

export type UsageLogType = 'message' | 'storage' | 'request';

export interface IUsageLog {
  orgId: Types.ObjectId;
  farmerId?: Types.ObjectId | null;
  fieldId?: Types.ObjectId | null;
  date: string; // YYYY-MM-DD
  type: UsageLogType;
  quantity: number; // e.g. 1 message, 100 requests, or MB/GB
  unit?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUsageLogDocument extends IUsageLog, Document {
  _id: Types.ObjectId;
}

const UsageLogSchema = new Schema<IUsageLogDocument>(
  {
    orgId: {
      type: Schema.Types.ObjectId,
      ref: 'Organisation',
      required: true,
      index: true,
    },
    farmerId: {
      type: Schema.Types.ObjectId,
      ref: 'Farmer',
      default: null,
      index: true,
    },
    fieldId: {
      type: Schema.Types.ObjectId,
      ref: 'Field',
      default: null,
      index: true,
    },
    date: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'],
      index: true,
    },
    type: {
      type: String,
      enum: ['message', 'storage', 'request'],
      required: true,
      index: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    unit: {
      type: String,
      default: 'unit',
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

UsageLogSchema.index({ orgId: 1, type: 1, date: 1 });

export const UsageLogModel = model<IUsageLogDocument>('UsageLog', UsageLogSchema);
