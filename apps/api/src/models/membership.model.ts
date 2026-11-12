import { Schema, model, Document, Types } from 'mongoose';

export type OrganisationRole = 'admin' | 'agent';

export interface IMembership {
  orgId: Types.ObjectId;
  userId: Types.ObjectId;
  role: OrganisationRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMembershipDocument extends IMembership, Document {
  _id: Types.ObjectId;
}

const MembershipSchema = new Schema<IMembershipDocument>(
  {
    orgId: {
      type: Schema.Types.ObjectId,
      ref: 'Organisation',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['admin', 'agent'],
      required: true,
      default: 'agent',
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

MembershipSchema.index({ orgId: 1, userId: 1 }, { unique: true });

export const MembershipModel = model<IMembershipDocument>('Membership', MembershipSchema);
