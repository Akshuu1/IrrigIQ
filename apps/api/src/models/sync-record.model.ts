import mongoose, { Document, Schema, Types } from 'mongoose';
import { SyncResultStatus, SyncMutationType } from '@irrigiq/shared';

export interface ISyncRecord extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  clientId: string;
  type: SyncMutationType;
  fieldId: Types.ObjectId;
  status: SyncResultStatus;
  response: Record<string, unknown>;
  createdAt: Date;
}

const syncRecordSchema = new Schema<ISyncRecord>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    clientId: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      required: true,
      enum: ['create_irrigation_log', 'update_field'],
    },
    fieldId: {
      type: Schema.Types.ObjectId,
      ref: 'Field',
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['applied', 'conflict', 'error'],
    },
    response: {
      type: Schema.Types.Mixed,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 2592000, // 30 days TTL
    },
  },
  {
    timestamps: false,
    versionKey: false,
  },
);

syncRecordSchema.index({ userId: 1, clientId: 1 }, { unique: true });

export const SyncRecord = mongoose.model<ISyncRecord>('SyncRecord', syncRecordSchema);

