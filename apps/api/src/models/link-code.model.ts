import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ILinkCode {
  codeHash: string;
  userId: Types.ObjectId;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILinkCodeDocument extends ILinkCode, Document {}

const linkCodeSchema = new Schema<ILinkCodeDocument>(
  {
    codeHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      // MongoDB TTL index: automatically deletes document once expiresAt is reached
      expires: 0,
    },
    used: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

export const LinkCodeModel = mongoose.model<ILinkCodeDocument>('LinkCode', linkCodeSchema);

