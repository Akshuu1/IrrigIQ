import { Router } from 'express';
import { SyncController } from '../controllers/sync.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();
const syncController = new SyncController();

router.use(authMiddleware);
router.post('/', syncController.batchSync);

export { router as syncRouter };

