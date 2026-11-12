import { Schema, model, Document, Types } from 'mongoose';

export interface IWhatsAppShareLog {
  orgId: Types.ObjectId;
  farmerId: Types.ObjectId;
  agentId: Types.ObjectId;
  url: string;
  sharedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IWhatsAppShareLogDocument extends IWhatsAppShareLog, Document {
  _id: Types.ObjectId;
}

const WhatsAppShareLogSchema = new Schema<IWhatsAppShareLogDocument>(
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
      required: true,
      index: true,
    },
    agentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    url: {
      type: String,
      required: true,
    },
    sharedAt: {
      type: Date,
      required: true,
      default: Date.now,
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

WhatsAppShareLogSchema.index({ orgId: 1, farmerId: 1, sharedAt: -1 });

export const WhatsAppShareLogModel = model<IWhatsAppShareLogDocument>(
  'WhatsAppShareLog',
  WhatsAppShareLogSchema,
);
