import mongoose, { Document, Schema, Types } from 'mongoose';

export type OutboundMessageStatus =
  | 'queued'
  | 'sent'
  | 'failed'
  | 'skipped_quiet_hours'
  | 'skipped_cap';

export interface IOutboundMessage {
  channelId: Types.ObjectId;
  userId: Types.ObjectId;
  provider: string;
  text: string;
  payload?: Record<string, unknown>;
  status: OutboundMessageStatus;
  sentAt?: Date;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IOutboundMessageDocument extends IOutboundMessage, Document {}

const outboundMessageSchema = new Schema<IOutboundMessageDocument>(
  {
    channelId: {
      type: Schema.Types.ObjectId,
      ref: 'MessageChannel',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    provider: {
      type: String,
      default: 'telegram',
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    payload: {
      type: Schema.Types.Mixed,
    },
    status: {
      type: String,
      enum: ['queued', 'sent', 'failed', 'skipped_quiet_hours', 'skipped_cap'],
      default: 'queued',
      index: true,
    },
    sentAt: {
      type: Date,
    },
    error: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

export const OutboundMessageModel = mongoose.model<IOutboundMessageDocument>(
  'OutboundMessage',
  outboundMessageSchema,
);

