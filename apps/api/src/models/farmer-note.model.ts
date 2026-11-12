import { Schema, model, Document, Types } from 'mongoose';

export type FarmerNoteStatus = 'followed' | 'not followed' | 'note';

export interface IFarmerNote {
  farmerId: Types.ObjectId;
  fieldId?: Types.ObjectId | null;
  orgId: Types.ObjectId;
  agentId: Types.ObjectId;
  status: FarmerNoteStatus;
  reason?: string | null;
  text?: string;
  date: string; // YYYY-MM-DD
  createdAt: Date;
  updatedAt: Date;
}

export interface IFarmerNoteDocument extends IFarmerNote, Document {
  _id: Types.ObjectId;
}

const FarmerNoteSchema = new Schema<IFarmerNoteDocument>(
  {
    farmerId: {
      type: Schema.Types.ObjectId,
      ref: 'Farmer',
      required: true,
      index: true,
    },
    fieldId: {
      type: Schema.Types.ObjectId,
      ref: 'Field',
      default: null,
      index: true,
    },
    orgId: {
      type: Schema.Types.ObjectId,
      ref: 'Organisation',
      required: true,
      index: true,
    },
    agentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['followed', 'not followed', 'note'],
      default: 'note',
      required: true,
      index: true,
    },
    reason: {
      type: String,
      default: null,
      trim: true,
    },
    text: {
      type: String,
      default: '',
      trim: true,
    },
    date: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'],
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

FarmerNoteSchema.index({ farmerId: 1, date: -1 });
FarmerNoteSchema.index({ orgId: 1, date: -1 });

export const FarmerNoteModel = model<IFarmerNoteDocument>('FarmerNote', FarmerNoteSchema);
