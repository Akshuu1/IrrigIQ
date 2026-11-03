import { Router, RequestHandler } from 'express';
import { reportController } from '../controllers/report.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

// All report routes require authentication
router.use(authMiddleware as unknown as RequestHandler);

router.get('/:id', reportController.getReport);
router.get('/:id/pdf', reportController.getReportPdf);

export { router as reportRouter };
