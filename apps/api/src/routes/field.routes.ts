import { Router, RequestHandler } from 'express';
import { fieldController } from '../controllers/field.controller.js';
import { recommendationController } from '../controllers/recommendation.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { recomputeRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// All field routes require authentication
router.use(authMiddleware as unknown as RequestHandler);

router.post('/', fieldController.create);
router.get('/', fieldController.list);
router.get('/nearby', fieldController.getNearby);
router.get('/:id', fieldController.getById);
router.patch('/:id', fieldController.update);
router.delete('/:id', fieldController.delete);

// Recommendation routes
router.get('/:id/recommendations', recommendationController.getForField);
router.post(
  '/:id/recommendations/recompute',
  recomputeRateLimiter as unknown as RequestHandler,
  recommendationController.recompute,
);

export { router as fieldRouter };
