import { Types } from 'mongoose';
import {
  ConsentRecordModel,
  ConsentMethod,
  IConsentRecordDocument,
} from '../models/consent-record.model.js';
import { DEFAULT_CONSENT_VERSION } from '../config/consent.js';
import { AppError } from '../errors/AppError.js';

export interface RecordConsentInput {
  farmerId: string | Types.ObjectId;
  language?: string;
  method: ConsentMethod;
  recordedBy: string | Types.ObjectId;
  textVersion?: string;
}

export class ConsentService {
  async recordConsent(input: RecordConsentInput): Promise<IConsentRecordDocument> {
    const farmerObjId = new Types.ObjectId(input.farmerId);
    const recordedByObjId = new Types.ObjectId(input.recordedBy);
    const textVersion = input.textVersion || DEFAULT_CONSENT_VERSION;
    const language = input.language || 'en';

    const validMethods: ConsentMethod[] = ['in-person', 'verbal', 'telegram', 'whatsapp'];
    if (!validMethods.includes(input.method)) {
      throw new AppError(`Invalid consent method: ${input.method}`, 400, 'INVALID_CONSENT_METHOD');
    }

    const record = await ConsentRecordModel.create({
      farmerId: farmerObjId,
      textVersion,
      language,
      method: input.method,
      recordedBy: recordedByObjId,
      recordedAt: new Date(),
      withdrawnAt: null,
    });

    return record;
  }

  async hasActiveConsent(farmerId: string | Types.ObjectId): Promise<boolean> {
    const farmerObjId = typeof farmerId === 'string' ? new Types.ObjectId(farmerId) : farmerId;
    const active = await ConsentRecordModel.findOne({
      farmerId: farmerObjId,
      withdrawnAt: null,
    });
    return Boolean(active);
  }

  async withdrawConsent(farmerId: string | Types.ObjectId): Promise<number> {
    const farmerObjId = typeof farmerId === 'string' ? new Types.ObjectId(farmerId) : farmerId;
    const result = await ConsentRecordModel.updateMany(
      { farmerId: farmerObjId, withdrawnAt: null },
      { withdrawnAt: new Date() },
    );
    return result.modifiedCount;
  }

  async getLatestConsent(
    farmerId: string | Types.ObjectId,
  ): Promise<IConsentRecordDocument | null> {
    const farmerObjId = typeof farmerId === 'string' ? new Types.ObjectId(farmerId) : farmerId;
    return ConsentRecordModel.findOne({ farmerId: farmerObjId }).sort({ recordedAt: -1 });
  }
}

export const consentService = new ConsentService();
