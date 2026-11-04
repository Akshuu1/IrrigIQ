import { Router, RequestHandler } from 'express';
import { powerScheduleController } from '../controllers/powerSchedule.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

// All power schedule routes require authentication
router.use(authMiddleware as unknown as RequestHandler);

router.post('/', powerScheduleController.create);
router.get('/', powerScheduleController.list);
router.post('/preset/:type', powerScheduleController.ensurePreset);
router.get('/:id', powerScheduleController.getById);
router.patch('/:id', powerScheduleController.update);
router.delete('/:id', powerScheduleController.delete);

export { router as powerScheduleRouter };
