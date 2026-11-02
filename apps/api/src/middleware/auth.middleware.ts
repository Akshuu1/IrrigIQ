import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getEnv } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { userRepository } from '../repositories/user.repository.js';
import { IUserDocument } from '../models/user.model.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: IUserDocument;
    }
  }
}

interface JwtPayload {
  sub: string;
  email: string;
}

export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.header('authorization');
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (typeof req.query.token === 'string' && req.query.token.trim()) {
    // Support token query parameter for Server-Sent Events (EventSource)
    token = req.query.token.trim();
  }

  if (!token) {
    next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
    return;
  }

  const env = getEnv();

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    if (!decoded.sub) {
      next(new AppError('Invalid token payload', 401, 'INVALID_TOKEN'));
      return;
    }

    const user = await userRepository.findById(decoded.sub);
    if (!user) {
      next(new AppError('User not found or deleted', 401, 'USER_NOT_FOUND'));
      return;
    }

    req.user = user;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      next(new AppError('Access token expired', 401, 'TOKEN_EXPIRED'));
      return;
    }
    next(new AppError('Invalid access token', 401, 'INVALID_TOKEN'));
  }
}
