import { Schema, model, Document, Types } from 'mongoose';
import { Language, AreaUnit } from '@irrigiq/shared';

export interface IUser {
  email: string;
  passwordHash: string;
  name: string;
  language: Language;
  areaUnit: AreaUnit;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserDocument extends IUser, Document {
  _id: Types.ObjectId;
}

const UserSchema = new Schema<IUserDocument>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    language: {
      type: String,
      enum: ['en', 'hi'],
      default: 'en',
    },
    areaUnit: {
      type: String,
      enum: ['acre', 'ha'],
      default: 'acre',
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = ret._id ? (ret._id as Types.ObjectId).toString() : undefined;
        delete ret._id;
        delete ret.__v;
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

export const UserModel = model<IUserDocument>('User', UserSchema);
