import { Types } from 'mongoose';
import { RefreshTokenModel, IRefreshTokenDocument } from '../models/refreshToken.model.js';

export interface CreateRefreshTokenDto {
  userId: Types.ObjectId | string;
  tokenHash: string;
  expiresAt: Date;
}

export class RefreshTokenRepository {
  async create(data: CreateRefreshTokenDto): Promise<IRefreshTokenDocument> {
    const token = new RefreshTokenModel({
      userId: new Types.ObjectId(data.userId.toString()),
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
    });
    return await token.save();
  }

  async findByTokenHash(tokenHash: string): Promise<IRefreshTokenDocument | null> {
    return await RefreshTokenModel.findOne({ tokenHash });
  }

  async revoke(id: Types.ObjectId | string, replacedByTokenHash?: string): Promise<void> {
    await RefreshTokenModel.findByIdAndUpdate(id, {
      $set: {
        revokedAt: new Date(),
        ...(replacedByTokenHash ? { replacedByTokenHash } : {}),
      },
    });
  }

  async revokeAllForUser(userId: Types.ObjectId | string): Promise<void> {
    await RefreshTokenModel.updateMany(
      {
        userId: new Types.ObjectId(userId.toString()),
        revokedAt: null,
      },
      {
        $set: { revokedAt: new Date() },
      },
    );
  }
}

export const refreshTokenRepository = new RefreshTokenRepository();
