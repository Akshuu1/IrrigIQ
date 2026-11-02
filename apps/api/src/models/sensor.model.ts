import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ISensor {
  fieldId: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  apiKeyHash: string;
  isSimulated: boolean;
  lastSeenAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ISensorDocument extends ISensor, Document {
  _id: Types.ObjectId;
}

const sensorSchema = new Schema<ISensorDocument>(
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
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    apiKeyHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    isSimulated: {
      type: Boolean,
      default: true,
    },
    lastSeenAt: {
      type: Date,
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
        delete ret.apiKeyHash; // NEVER expose hash in responses
        return ret;
      },
    },
    toObject: {
      virtuals: true,
    },
  },
);

sensorSchema.index({ userId: 1, fieldId: 1 });

export const SensorModel = mongoose.model<ISensorDocument>('Sensor', sensorSchema);
