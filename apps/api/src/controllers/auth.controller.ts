import { Request, Response, NextFunction } from 'express';
import { getEnv } from '../config/env.js';
import { RegisterSchema, LoginSchema, UpdateProfileSchema } from '../schemas/auth.schema.js';
import { authService } from '../services/auth.service.js';
import { AppError } from '../errors/AppError.js';

function getRefreshTokenCookieOptions(req: Request) {
  const env = getEnv();
  const isProd = env.NODE_ENV === 'production';
  const isLocalhost = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
  const sameSite = env.COOKIE_SAME_SITE;

  return {
    httpOnly: true,
    secure: isProd && !isLocalhost,
    sameSite,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/auth',
  };
}

export class AuthController {
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validated = RegisterSchema.parse(req.body);
      const result = await authService.register(validated);

      res.cookie('refreshToken', result.refreshToken, getRefreshTokenCookieOptions(req));
      res.status(201).json({
        status: 'success',
        data: {
          user: result.user.toJSON(),
          accessToken: result.accessToken,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validated = LoginSchema.parse(req.body);
      const result = await authService.login(validated);

      res.cookie('refreshToken', result.refreshToken, getRefreshTokenCookieOptions(req));
      res.status(200).json({
        status: 'success',
        data: {
          user: result.user.toJSON(),
          accessToken: result.accessToken,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = req.cookies?.refreshToken || req.body?.refreshToken;
      if (!token) {
        throw new AppError('Refresh token required', 401, 'TOKEN_REQUIRED');
      }

      const result = await authService.rotateRefreshToken(token);

      res.cookie('refreshToken', result.refreshToken, getRefreshTokenCookieOptions(req));
      res.status(200).json({
        status: 'success',
        data: {
          user: result.user.toJSON(),
          accessToken: result.accessToken,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = req.cookies?.refreshToken || req.body?.refreshToken;
      await authService.logout(token);

      res.clearCookie('refreshToken', { path: '/auth' });
      res.status(200).json({
        status: 'success',
        message: 'Logged out successfully',
      });
    } catch (err) {
      next(err);
    }
  }

  async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      }

      res.status(200).json({
        status: 'success',
        data: {
          user: req.user.toJSON(),
        },
      });
    } catch (err) {
      next(err);
    }
  }

  async updateMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      }

      const validated = UpdateProfileSchema.parse(req.body);
      const updatedUser = await authService.updateMe(req.user.id, validated);

      res.status(200).json({
        status: 'success',
        data: {
          user: updatedUser.toJSON(),
        },
      });
    } catch (err) {
      next(err);
    }
  }

  async deleteMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      }

      const result = await authService.deleteAccount(req.user.id);
      res.clearCookie('refreshToken', { path: '/auth' });
      res.status(200).json({
        status: 'success',
        message: 'Account and all associated personal and operational data permanently deleted',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();
