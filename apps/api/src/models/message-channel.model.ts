import mongoose, { Document, Schema, Types } from 'mongoose';

export type MessageChannelProvider = 'telegram' | 'whatsapp';
export type MessageChannelStatus = 'active' | 'deactivated' | 'pending_opt_in';

export interface IQuietHours {
  start: string; // 'HH:MM'
  end: string; // 'HH:MM'
}

export interface IMessageChannel {
  userId: Types.ObjectId;
  provider: MessageChannelProvider;
  externalIdEncrypted: string;
  externalIdHash: string;
  optedIn: boolean;
  optedInAt?: Date;
  lastInboundAt?: Date; // Phase 21: Tracks Meta 24h customer service window
  status: MessageChannelStatus;
  sendTime: string; // 'HH:MM', default '06:30'
  quietHours: IQuietHours;
  dailyCap: number; // default 3
  messagesSentToday: number;
  lastSentDate?: string; // 'YYYY-MM-DD'
  planChangeAlertsEnabled: boolean; // Phase 21: Can be turned on/off by user
  lastPlanChangeNoticeDate?: string; // 'YYYY-MM-DD'
  createdAt: Date;
  updatedAt: Date;
}

export interface IMessageChannelDocument extends IMessageChannel, Document {}

const messageChannelSchema = new Schema<IMessageChannelDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ['telegram', 'whatsapp'],
      default: 'telegram',
      required: true,
    },
    externalIdEncrypted: {
      type: String,
      required: true,
    },
    externalIdHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    optedIn: {
      type: Boolean,
      default: false,
    },
    optedInAt: {
      type: Date,
    },
    lastInboundAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['active', 'deactivated', 'pending_opt_in'],
      default: 'pending_opt_in',
      index: true,
    },
    sendTime: {
      type: String,
      default: '06:30',
      match: /^([01]\d|2[0-3]):[0-5]\d$/,
    },
    quietHours: {
      start: {
        type: String,
        default: '22:00',
        match: /^([01]\d|2[0-3]):[0-5]\d$/,
      },
      end: {
        type: String,
        default: '06:00',
        match: /^([01]\d|2[0-3]):[0-5]\d$/,
      },
    },
    dailyCap: {
      type: Number,
      default: 3,
      min: 1,
      max: 10,
    },
    messagesSentToday: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastSentDate: {
      type: String,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    planChangeAlertsEnabled: {
      type: Boolean,
      default: true,
    },
    lastPlanChangeNoticeDate: {
      type: String,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret.__v;
        // Never expose externalIdEncrypted or externalIdHash to the client
        delete ret.externalIdEncrypted;
        delete ret.externalIdHash;
        return ret;
      },
    },
  },
);

export const MessageChannelModel = mongoose.model<IMessageChannelDocument>(
  'MessageChannel',
  messageChannelSchema,
);

