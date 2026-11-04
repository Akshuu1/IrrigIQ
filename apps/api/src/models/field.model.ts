import mongoose, { Document, Schema, Types } from 'mongoose';
import type { GeoJSONPolygon, GeoJSONPoint } from '@irrigiq/shared';

export type SoilType = 'sandy' | 'loam' | 'clay';
export type IrrigationMethod = 'drip' | 'sprinkler' | 'flood';

export interface IFieldBaseline {
  everyDays: number;
  depthMm: number;
}

export interface IField {
  userId: Types.ObjectId;
  name: string;
  geometry: GeoJSONPolygon;
  centroid: GeoJSONPoint;
  areaHa: number;
  cropKey: string;
  sowingDate: Date;
  soilType: SoilType;
  method: IrrigationMethod;
  baseline: IFieldBaseline;
  pumpId?: Types.ObjectId | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IFieldDocument extends IField, Document {}

const polygonSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['Polygon'],
      required: true,
      default: 'Polygon',
    },
    coordinates: {
      type: [[[Number]]],
      required: true,
    },
  },
  { _id: false },
);

const pointSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['Point'],
      required: true,
      default: 'Point',
    },
    coordinates: {
      type: [Number],
      required: true,
    },
  },
  { _id: false },
);

const baselineSchema = new Schema(
  {
    everyDays: { type: Number, required: true, min: 1 },
    depthMm: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const fieldSchema = new Schema<IFieldDocument>(
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
    geometry: {
      type: polygonSchema,
      required: true,
    },
    centroid: {
      type: pointSchema,
      required: true,
    },
    areaHa: {
      type: Number,
      required: true,
      min: 0.01,
      max: 500,
    },
    cropKey: {
      type: String,
      required: true,
    },
    sowingDate: {
      type: Date,
      required: true,
    },
    soilType: {
      type: String,
      enum: ['sandy', 'loam', 'clay'],
      required: true,
    },
    method: {
      type: String,
      enum: ['drip', 'sprinkler', 'flood'],
      required: true,
    },
    baseline: {
      type: baselineSchema,
      required: true,
    },
    pumpId: {
      type: Schema.Types.ObjectId,
      ref: 'Pump',
      default: null,
    },
    version: {
      type: Number,
      required: true,
      default: 1,
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

// Indexes
fieldSchema.index({ geometry: '2dsphere' });
fieldSchema.index({ userId: 1, updatedAt: -1 });
fieldSchema.index({ pumpId: 1 });

export const FieldModel = mongoose.model<IFieldDocument>('Field', fieldSchema);
