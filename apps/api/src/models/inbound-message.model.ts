import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IInboundMessage {
  provider: string;
  updateId: number;
  channelId?: Types.ObjectId;
  rawUpdate: Record<string, unknown>;
  replyAction?: string;
  processed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IInboundMessageDocument extends IInboundMessage, Document {}

const inboundMessageSchema = new Schema<IInboundMessageDocument>(
  {
    provider: {
      type: String,
      default: 'telegram',
      required: true,
    },
    updateId: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    channelId: {
      type: Schema.Types.ObjectId,
      ref: 'MessageChannel',
      index: true,
    },
    rawUpdate: {
      type: Schema.Types.Mixed,
      required: true,
    },
    replyAction: {
      type: String,
    },
    processed: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

export const InboundMessageModel = mongoose.model<IInboundMessageDocument>(
  'InboundMessage',
  inboundMessageSchema,
);

