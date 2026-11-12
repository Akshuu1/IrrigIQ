import { Schema, model, Document, Types } from 'mongoose';

export type FarmerStatus = 'active' | 'stopped' | 'deleted';

export interface IFarmer {
  orgId: Types.ObjectId;
  name: string;
  phoneEncrypted?: string;
  phoneHash?: string;
  language: string;
  village?: string;
  assignedAgentId?: Types.ObjectId | null;
  status: FarmerStatus;
  userId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IFarmerDocument extends IFarmer, Document {
  _id: Types.ObjectId;
}

const FarmerSchema = new Schema<IFarmerDocument>(
  {
    orgId: {
      type: Schema.Types.ObjectId,
      ref: 'Organisation',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phoneEncrypted: {
      type: String,
      default: '',
    },
    phoneHash: {
      type: String,
      default: '',
      index: true,
    },
    language: {
      type: String,
      enum: ['en', 'hi', 'mr', 'pa', 'te'],
      default: 'en',
    },
    village: {
      type: String,
      default: '',
      trim: true,
    },
    assignedAgentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'stopped', 'deleted'],
      default: 'active',
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
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

// Compound indexes for RBAC and scoped lookups
FarmerSchema.index({ orgId: 1, status: 1 });
FarmerSchema.index({ orgId: 1, assignedAgentId: 1, status: 1 });

export const FarmerModel = model<IFarmerDocument>('Farmer', FarmerSchema);
