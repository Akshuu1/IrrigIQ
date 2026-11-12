import { Router, RequestHandler } from 'express';
import { pilotMetricsController } from '../controllers/pilot-metrics.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { orgMiddleware } from '../middleware/org.middleware.js';

const router = Router({ mergeParams: true });

// All routes require authentication and organisation context
router.use(authMiddleware as unknown as RequestHandler);
router.use(orgMiddleware as unknown as RequestHandler);

router.get('/', pilotMetricsController.getMetrics);
router.post('/query', pilotMetricsController.getMetrics);

router.get('/pdf', pilotMetricsController.getPdfReport);
router.post('/pdf', pilotMetricsController.getPdfReport);

router.get('/csv', pilotMetricsController.getCsvExport);
router.post('/csv', pilotMetricsController.getCsvExport);

export { router as pilotMetricsRouter };
