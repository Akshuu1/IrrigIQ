import { Schema, model, Document, Types } from 'mongoose';

export type PumpRunSource = 'chat' | 'agent' | 'web';

export interface IPumpRunLog {
  fieldId: Types.ObjectId;
  farmerId?: Types.ObjectId | null;
  date: string; // YYYY-MM-DD
  minutes: number;
  litres: number;
  source: PumpRunSource;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPumpRunLogDocument extends IPumpRunLog, Document {
  _id: Types.ObjectId;
}

const PumpRunLogSchema = new Schema<IPumpRunLogDocument>(
  {
    fieldId: {
      type: Schema.Types.ObjectId,
      ref: 'Field',
      required: true,
      index: true,
    },
    farmerId: {
      type: Schema.Types.ObjectId,
      ref: 'Farmer',
      default: null,
      index: true,
    },
    date: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'],
      index: true,
    },
    minutes: {
      type: Number,
      required: true,
      min: 1,
      max: 1440,
    },
    litres: {
      type: Number,
      required: true,
      min: 0,
    },
    source: {
      type: String,
      enum: ['chat', 'agent', 'web'],
      required: true,
      default: 'chat',
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

PumpRunLogSchema.index({ fieldId: 1, date: -1 });

export const PumpRunLogModel = model<IPumpRunLogDocument>('PumpRunLog', PumpRunLogSchema);
