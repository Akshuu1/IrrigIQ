import mongoose, { Document, Schema, Types } from 'mongoose';
import type { PowerWindow, ScheduleRotation } from '@irrigiq/shared';

export interface IPowerSchedule {
  userId: Types.ObjectId;
  name: string;
  type: 'night' | 'day' | 'custom';
  windows: PowerWindow[];
  rotation?: ScheduleRotation | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPowerScheduleDocument extends IPowerSchedule, Document {}

const powerWindowSchema = new Schema(
  {
    days: {
      type: [Number],
      required: true,
      validate: {
        validator: (v: number[]) => v.every((d) => d >= 0 && d <= 6),
        message: 'Days must be between 0 (Sunday) and 6 (Saturday)',
      },
    },
    start: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):([0-5]\d)$/,
    },
    end: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]|24):([0-5]\d)$/,
    },
  },
  { _id: false },
);

const scheduleRotationSchema = new Schema(
  {
    weekA: {
      type: [powerWindowSchema],
      required: true,
    },
    weekB: {
      type: [powerWindowSchema],
      required: true,
    },
    anchorDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
  },
  { _id: false },
);

const powerScheduleSchema = new Schema<IPowerScheduleDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },
    type: {
      type: String,
      enum: ['night', 'day', 'custom'],
      default: 'custom',
      required: true,
    },
    windows: {
      type: [powerWindowSchema],
      default: [],
    },
    rotation: {
      type: scheduleRotationSchema,
      default: null,
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

powerScheduleSchema.index({ userId: 1, createdAt: -1 });

export const PowerScheduleModel = mongoose.model<IPowerScheduleDocument>(
  'PowerSchedule',
  powerScheduleSchema,
);
