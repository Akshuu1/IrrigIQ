import { Router, RequestHandler } from 'express';
import { pumpController } from '../controllers/pump.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

// All pump routes require authentication
router.use(authMiddleware as unknown as RequestHandler);

router.post('/', pumpController.create);
router.get('/', pumpController.list);
router.get('/:id', pumpController.getById);
router.patch('/:id', pumpController.update);
router.delete('/:id', pumpController.delete);

export { router as pumpRouter };

