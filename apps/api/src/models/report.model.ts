import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IReportData {
  field: {
    id: string;
    name: string;
    farmerName: string;
    cropKey: string;
    cropNameEn: string;
    cropNameHi: string;
    cropNameMr?: string;
    cropNamePa?: string;
    cropNameTe?: string;
    cropName: string;
    sowingDate: string;
    soilType: string;
    irrigationMethod: string;
    areaHa: number;
  };
  assumptions: {
    method: string;
    efficiency: number;
    areaHa: number;
    baselineEveryDays: number;
    baselineDepthMm: number;
    dataSources: string;
    baselineNote: string;
    disclaimer: string;
  };
  totals: {
    baseline: {
      count: number;
      depthMm: number;
      totalMm: number;
      litres: number;
    };
    recommended: {
      count: number;
      totalMm: number;
      litres: number;
    };
    actual: {
      count: number;
      totalMm: number;
      litres: number;
    };
    potentialSaved: {
      mm: number;
      litres: number;
      pct: number;
    };
    realisedSaved: {
      mm: number;
      litres: number;
      pct: number;
    };
  };
  dailyTable: Array<{
    date: string;
    et0Mm: number;
    etcMm: number;
    rainMm: number;
    recommendedAction: 'irrigate' | 'skip' | '-';
    recommendedGrossMm: number;
    recommendedLitres: number;
    reasonText: string;
    actualGrossMm: number;
    actualLitres: number;
    logSource: string | null;
  }>;
  chartData: Array<{
    date: string;
    etcMm: number;
    rainMm: number;
    recommendedGrossMm: number;
    actualGrossMm: number;
  }>;
}

export interface IReportDocument extends Document {
  _id: Types.ObjectId;
  fieldId: Types.ObjectId;
  userId: Types.ObjectId;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  from: string;
  to: string;
  language: 'en' | 'hi' | 'mr' | 'pa' | 'te';
  data: IReportData;
  pdfBuffer?: Buffer;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const reportSchema = new Schema<IReportDocument>(
  {
    fieldId: { type: Schema.Types.ObjectId, ref: 'Field', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'processing',
      required: true,
    },
    from: { type: String, required: true },
    to: { type: String, required: true },
    language: { type: String, enum: ['en', 'hi', 'mr', 'pa', 'te'], default: 'en', required: true },
    data: { type: Schema.Types.Mixed, default: {} },
    pdfBuffer: { type: Buffer },
    error: { type: String },
  },
  {
    timestamps: true,
  },
);

reportSchema.index({ userId: 1, fieldId: 1 });
reportSchema.index({ fieldId: 1, createdAt: -1 });

export const ReportModel = mongoose.model<IReportDocument>('Report', reportSchema);

