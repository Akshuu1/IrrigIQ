import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IPump {
  userId: Types.ObjectId;
  name: string;
  dischargeLph: number;
  measuredOn: Date;
  costPerHour?: number | null;
  scheduleId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPumpDocument extends IPump, Document {}

const pumpSchema = new Schema<IPumpDocument>(
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
    dischargeLph: {
      type: Number,
      required: true,
      min: 500,
      max: 200000,
    },
    measuredOn: {
      type: Date,
      default: Date.now,
    },
    costPerHour: {
      type: Number,
      min: 0,
      default: null,
    },
    scheduleId: {
      type: Schema.Types.ObjectId,
      ref: 'PowerSchedule',
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

pumpSchema.index({ userId: 1, createdAt: -1 });

export const PumpModel = mongoose.model<IPumpDocument>('Pump', pumpSchema);

