import { Schema, model, Document, Types } from 'mongoose';

export type ConsentMethod = 'in-person' | 'verbal' | 'telegram' | 'whatsapp';

export interface IConsentRecord {
  farmerId: Types.ObjectId;
  textVersion: string;
  language: string;
  method: ConsentMethod;
  recordedBy: Types.ObjectId;
  recordedAt: Date;
  withdrawnAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IConsentRecordDocument extends IConsentRecord, Document {
  _id: Types.ObjectId;
}

const ConsentRecordSchema = new Schema<IConsentRecordDocument>(
  {
    farmerId: {
      type: Schema.Types.ObjectId,
      ref: 'Farmer',
      required: true,
      index: true,
    },
    textVersion: {
      type: String,
      required: true,
      default: '1.0',
    },
    language: {
      type: String,
      enum: ['en', 'hi', 'mr', 'pa', 'te'],
      required: true,
      default: 'en',
    },
    method: {
      type: String,
      enum: ['in-person', 'verbal', 'telegram', 'whatsapp'],
      required: true,
    },
    recordedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    recordedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    withdrawnAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = ret._id ? (ret._id as Types.ObjectId).toString() : undefined;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

ConsentRecordSchema.index({ farmerId: 1, withdrawnAt: 1 });

export const ConsentRecordModel = model<IConsentRecordDocument>('ConsentRecord', ConsentRecordSchema);

