import { Types } from 'mongoose';
import { FarmerModel } from '../models/farmer.model.js';
import { WhatsAppShareLogModel, IWhatsAppShareLogDocument } from '../models/whatsapp-share-log.model.js';
import { decryptExternalId } from '../utils/crypto.js';
import { buildDigest } from './messaging/digest.service.js';
import { AppError } from '../errors/AppError.js';

export interface GenerateShareUrlResult {
  url: string;
  digestText: string;
  shareLog: IWhatsAppShareLogDocument;
}

export function formatWaMePhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return `91${digits.slice(1)}`;
  }
  return digits;
}

export class WhatsAppShareService {
  async generateShareUrl(
    orgId: Types.ObjectId,
    agentId: Types.ObjectId,
    farmerId: string | Types.ObjectId,
    customDigestText?: string,
  ): Promise<GenerateShareUrlResult> {
    const farmerObjId = typeof farmerId === 'string' ? new Types.ObjectId(farmerId) : farmerId;

    const farmer = await FarmerModel.findOne({
      _id: farmerObjId,
      orgId,
      status: { $ne: 'deleted' },
    });

    if (!farmer) {
      throw new AppError('Farmer not found in this organisation', 404, 'FARMER_NOT_FOUND');
    }

    let phone = '';
    if (farmer.phoneEncrypted) {
      try {
        phone = decryptExternalId(farmer.phoneEncrypted);
      } catch {
        phone = '';
      }
    }

    if (!phone) {
      throw new AppError('Farmer does not have a valid phone number', 400, 'PHONE_REQUIRED');
    }

    const cleanPhone = formatWaMePhone(phone);

    let digestText = customDigestText;
    if (!digestText) {
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      try {
        const digest = await buildDigest(
          {
            _id: farmer.userId || farmer._id,
            name: farmer.name,
            language: farmer.language,
          },
          todayStr,
        );
        digestText = digest.text;
      } catch {
        digestText = `🌾 IrrigIQ Daily Advisory for ${farmer.name}`;
      }
    }

    const encodedText = encodeURIComponent(digestText);
    const url = `https://wa.me/${cleanPhone}?text=${encodedText}`;

    const shareLog = await WhatsAppShareLogModel.create({
      orgId,
      farmerId: farmer._id,
      agentId,
      url,
      sharedAt: new Date(),
    });

    return {
      url,
      digestText,
      shareLog,
    };
  }
}

export const whatsappShareService = new WhatsAppShareService();

