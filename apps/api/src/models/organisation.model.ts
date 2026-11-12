import { Schema, model, Document, Types } from 'mongoose';

export interface IOrganisation {
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IOrganisationDocument extends IOrganisation, Document {
  _id: Types.ObjectId;
}

const OrganisationSchema = new Schema<IOrganisationDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
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

export const OrganisationModel = model<IOrganisationDocument>('Organisation', OrganisationSchema);
