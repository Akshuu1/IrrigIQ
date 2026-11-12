import { Router, RequestHandler } from 'express';
import { agentDashboardController } from '../controllers/agent-dashboard.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { orgMiddleware } from '../middleware/org.middleware.js';

const router = Router({ mergeParams: true });

// All routes require authentication and organisation context
router.use(authMiddleware as unknown as RequestHandler);
router.use(orgMiddleware as unknown as RequestHandler);

router.get('/today', agentDashboardController.getTodayDashboard);
router.post('/bulk-send', agentDashboardController.bulkSendPending);
router.post('/farmers/:id/mark-status', agentDashboardController.markStatus);
router.get('/farmers/:id/timeline', agentDashboardController.getFarmerTimeline);
router.post('/farmers/:id/send-advisory', agentDashboardController.sendFarmerAdvisory);

export { router as agentDashboardRouter };

