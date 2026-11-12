import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { authRateLimiter } from '../middleware/rateLimiter.js';

export const authRouter = Router();

authRouter.post('/register', authRateLimiter, (req, res, next) =>
  authController.register(req, res, next),
);
authRouter.post('/login', authRateLimiter, (req, res, next) =>
  authController.login(req, res, next),
);
authRouter.post('/refresh', authRateLimiter, (req, res, next) =>
  authController.refresh(req, res, next),
);
authRouter.post('/logout', (req, res, next) => authController.logout(req, res, next));
authRouter.get('/me', authMiddleware, (req, res, next) => authController.getMe(req, res, next));
authRouter.patch('/me', authMiddleware, (req, res, next) =>
  authController.updateMe(req, res, next),
);
authRouter.delete('/me', authMiddleware, (req, res, next) =>
  authController.deleteMe(req, res, next),
);
