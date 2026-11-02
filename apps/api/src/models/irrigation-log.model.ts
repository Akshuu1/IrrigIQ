import mongoose, { Document, Schema, Types } from 'mongoose';

export type IrrigationLogSource = 'recommended' | 'manual';

export interface IIrrigationLog {
  fieldId: Types.ObjectId;
  userId: Types.ObjectId;
  date: string; // YYYY-MM-DD
  appliedMm: number; // Gross applied depth in mm
  source: IrrigationLogSource;
  note?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IIrrigationLogDocument extends IIrrigationLog, Document {
  _id: Types.ObjectId;
}

const irrigationLogSchema = new Schema<IIrrigationLogDocument>(
  {
    fieldId: {
      type: Schema.Types.ObjectId,
      ref: 'Field',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'],
    },
    appliedMm: {
      type: Number,
      required: true,
      min: [0, 'Applied mm must be non-negative'],
    },
    source: {
      type: String,
      enum: ['recommended', 'manual'],
      required: true,
    },
    note: {
      type: String,
      trim: true,
      maxlength: [500, 'Note cannot exceed 500 characters'],
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = (ret._id as Types.ObjectId).toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
    },
  },
);

// Indexes for fast lookup by field sorted by date descending, and multi-tenant isolation
irrigationLogSchema.index({ fieldId: 1, date: -1 });
irrigationLogSchema.index({ userId: 1, fieldId: 1 });

export const IrrigationLogModel = mongoose.model<IIrrigationLogDocument>(
  'IrrigationLog',
  irrigationLogSchema,
);
