import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IPushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface IPushSubscription {
  userId: Types.ObjectId;
  endpoint: string;
  keys: IPushSubscriptionKeys;
  expirationTime?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPushSubscriptionDocument extends IPushSubscription, Document {}

const pushSubscriptionSchema = new Schema<IPushSubscriptionDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    endpoint: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    keys: {
      p256dh: {
        type: String,
        required: true,
      },
      auth: {
        type: String,
        required: true,
      },
    },
    expirationTime: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

export const PushSubscriptionModel = mongoose.model<IPushSubscriptionDocument>(
  'PushSubscription',
  pushSubscriptionSchema,
);

