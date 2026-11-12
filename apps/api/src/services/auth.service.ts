import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { getEnv } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { logger } from '../config/logger.js';
import { UserRepository, userRepository } from '../repositories/user.repository.js';
import {
  RefreshTokenRepository,
  refreshTokenRepository,
} from '../repositories/refreshToken.repository.js';
import { RegisterInput, LoginInput, UpdateProfileInput } from '../schemas/auth.schema.js';
import { IUserDocument, UserModel } from '../models/user.model.js';
import { FieldModel } from '../models/field.model.js';
import { IrrigationLogModel } from '../models/irrigation-log.model.js';
import { RecommendationModel } from '../models/recommendation.model.js';
import { SensorModel } from '../models/sensor.model.js';
import { SensorReadingModel } from '../models/sensor-reading.model.js';
import { ReportModel } from '../models/report.model.js';
import { PumpModel } from '../models/pump.model.js';
import { PowerScheduleModel } from '../models/powerSchedule.model.js';
import { MessageChannelModel } from '../models/message-channel.model.js';
import { LinkCodeModel } from '../models/link-code.model.js';
import { InboundMessageModel } from '../models/inbound-message.model.js';
import { OutboundMessageModel } from '../models/outbound-message.model.js';
import { PushSubscriptionModel } from '../models/push-subscription.model.js';
import { RefreshTokenModel } from '../models/refreshToken.model.js';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult {
  user: IUserDocument;
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  private readonly bcryptRounds = 12;

  constructor(
    private readonly userRepo: UserRepository = userRepository,
    private readonly tokenRepo: RefreshTokenRepository = refreshTokenRepository,
  ) {}

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  generateAccessToken(userId: string, email: string): string {
    const env = getEnv();
    return jwt.sign(
      {
        sub: userId,
        email,
      },
      env.JWT_SECRET,
      {
        expiresIn: '15m',
      },
    );
  }

  generateRefreshToken(): string {
    return randomBytes(40).toString('hex');
  }

  async register(input: RegisterInput): Promise<AuthResult> {
    const existing = await this.userRepo.findByEmail(input.email);
    if (existing) {
      throw new AppError('Email already in use', 409, 'EMAIL_EXISTS');
    }

    const passwordHash = await bcrypt.hash(input.password, this.bcryptRounds);
    const user = await this.userRepo.create({
      ...input,
      passwordHash,
    });

    const env = getEnv();
    const accessToken = this.generateAccessToken(user.id, user.email);
    const rawRefreshToken = this.generateRefreshToken();
    const tokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000);

    await this.tokenRepo.create({
      userId: user._id,
      tokenHash,
      expiresAt,
    });

    logger.info({ userId: user.id }, 'User registered successfully');

    return {
      user,
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.userRepo.findByEmail(input.email);
    if (!user) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const isMatch = await bcrypt.compare(input.password, user.passwordHash);
    if (!isMatch) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const env = getEnv();
    const accessToken = this.generateAccessToken(user.id, user.email);
    const rawRefreshToken = this.generateRefreshToken();
    const tokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000);

    await this.tokenRepo.create({
      userId: user._id,
      tokenHash,
      expiresAt,
    });

    logger.info({ userId: user.id }, 'User logged in successfully');

    return {
      user,
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  async rotateRefreshToken(rawRefreshToken: string): Promise<AuthResult> {
    if (!rawRefreshToken || rawRefreshToken.trim() === '') {
      throw new AppError('Refresh token required', 401, 'TOKEN_REQUIRED');
    }

    const tokenHash = this.hashToken(rawRefreshToken);
    const tokenDoc = await this.tokenRepo.findByTokenHash(tokenHash);

    if (!tokenDoc) {
      throw new AppError('Invalid refresh token', 401, 'INVALID_TOKEN');
    }

    // Reuse detection: If token was already revoked, revoke all active sessions for this user
    if (tokenDoc.revokedAt !== null) {
      logger.warn(
        { userId: tokenDoc.userId.toString() },
        'SECURITY ALERT: Refresh token reuse detected! Revoking all sessions.',
      );
      await this.tokenRepo.revokeAllForUser(tokenDoc.userId);
      throw new AppError('Refresh token reuse detected. All sessions revoked.', 401, 'TOKEN_REUSE');
    }

    // Expiry check
    if (tokenDoc.expiresAt.getTime() < Date.now()) {
      throw new AppError('Refresh token expired', 401, 'TOKEN_EXPIRED');
    }

    const user = await this.userRepo.findById(tokenDoc.userId);
    if (!user) {
      throw new AppError('User not found', 401, 'USER_NOT_FOUND');
    }

    // Generate new token pair
    const env = getEnv();
    const newRawRefreshToken = this.generateRefreshToken();
    const newTokenHash = this.hashToken(newRawRefreshToken);
    const newExpiresAt = new Date(
      Date.now() + env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
    );

    // Revoke old token and link to new one
    await this.tokenRepo.revoke(tokenDoc._id, newTokenHash);

    // Persist new refresh token
    await this.tokenRepo.create({
      userId: user._id,
      tokenHash: newTokenHash,
      expiresAt: newExpiresAt,
    });

    const newAccessToken = this.generateAccessToken(user.id, user.email);

    return {
      user,
      accessToken: newAccessToken,
      refreshToken: newRawRefreshToken,
    };
  }

  async logout(rawRefreshToken?: string): Promise<void> {
    if (rawRefreshToken && rawRefreshToken.trim() !== '') {
      const tokenHash = this.hashToken(rawRefreshToken);
      const tokenDoc = await this.tokenRepo.findByTokenHash(tokenHash);
      if (tokenDoc && tokenDoc.revokedAt === null) {
        await this.tokenRepo.revoke(tokenDoc._id);
      }
    }
  }

  async getMe(userId: string | Types.ObjectId): Promise<IUserDocument> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }
    return user;
  }

  async updateMe(
    userId: string | Types.ObjectId,
    data: UpdateProfileInput,
  ): Promise<IUserDocument> {
    const user = await this.userRepo.update(userId, data);
    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }
    return user;
  }

  async deleteAccount(
    userId: string | Types.ObjectId,
  ): Promise<{ success: boolean; deletedCounts: Record<string, number> }> {
    const uid = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    // 1. Gather fields owned by user
    const fields = await FieldModel.find({ userId: uid }).select('_id');
    const fieldIds = fields.map((f) => f._id);

    // 2. Gather message channels
    const channels = await MessageChannelModel.find({ userId: uid }).select('_id');
    const channelIds = channels.map((c) => c._id);

    // 3. Cascade deletions across all associated personal and operational models
    const [
      sensorReadings,
      sensors,
      logs,
      recommendations,
      reports,
      fieldsResult,
      pumps,
      powerSchedules,
      inboundMsgs,
      outboundMsgs,
      linkCodes,
      channelsResult,
      pushSubs,
      tokens,
      userResult,
    ] = await Promise.all([
      SensorReadingModel.deleteMany({ 'metadata.fieldId': { $in: fieldIds } }),
      SensorModel.deleteMany({ userId: uid }),
      IrrigationLogModel.deleteMany({ $or: [{ userId: uid }, { fieldId: { $in: fieldIds } }] }),
      RecommendationModel.deleteMany({ $or: [{ userId: uid }, { fieldId: { $in: fieldIds } }] }),
      ReportModel.deleteMany({ userId: uid }),
      FieldModel.deleteMany({ userId: uid }),
      PumpModel.deleteMany({ userId: uid }),
      PowerScheduleModel.deleteMany({ userId: uid }),
      InboundMessageModel.deleteMany({ channelId: { $in: channelIds } }),
      OutboundMessageModel.deleteMany({
        $or: [{ userId: uid }, { channelId: { $in: channelIds } }],
      }),
      LinkCodeModel.deleteMany({ userId: uid }),
      MessageChannelModel.deleteMany({ userId: uid }),
      PushSubscriptionModel.deleteMany({ userId: uid }),
      RefreshTokenModel.deleteMany({ userId: uid }),
      UserModel.deleteOne({ _id: uid }),
    ]);

    logger.info(
      {
        userId: uid.toString(),
        deletedFields: fieldsResult.deletedCount,
        deletedChannels: channelsResult.deletedCount,
      },
      'User account and all personal and operational data successfully deleted (DELETE /me)',
    );

    return {
      success: true,
      deletedCounts: {
        fields: fieldsResult.deletedCount,
        logs: logs.deletedCount,
        recommendations: recommendations.deletedCount,
        sensors: sensors.deletedCount,
        readings: sensorReadings.deletedCount,
        reports: reports.deletedCount,
        pumps: pumps.deletedCount,
        powerSchedules: powerSchedules.deletedCount,
        channels: channelsResult.deletedCount,
        linkCodes: linkCodes.deletedCount,
        inboundMessages: inboundMsgs.deletedCount,
        outboundMessages: outboundMsgs.deletedCount,
        pushSubscriptions: pushSubs.deletedCount,
        tokens: tokens.deletedCount,
        user: userResult.deletedCount,
      },
    };
  }
}

export const authService = new AuthService();
