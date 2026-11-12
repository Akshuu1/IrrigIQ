import { Router, RequestHandler } from 'express';
import { farmerController } from '../controllers/farmer.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { orgMiddleware, requireRole } from '../middleware/org.middleware.js';

const router = Router({ mergeParams: true });

// All farmer routes require authentication and organisation context
router.use(authMiddleware as unknown as RequestHandler);
router.use(orgMiddleware as unknown as RequestHandler);

router.post('/import', farmerController.importFarmers);
router.post('/', farmerController.createFarmer);
router.get('/', farmerController.listFarmers);
router.get('/:id', farmerController.getFarmer);
router.patch('/:id', farmerController.updateFarmer);
router.delete('/:id', requireRole('admin') as unknown as RequestHandler, farmerController.deleteFarmer);

// Consent & WhatsApp share
router.post('/:id/consent', farmerController.recordConsent);
router.get('/:id/consent', farmerController.getConsent);
router.delete('/:id/consent', farmerController.withdrawConsent);
router.post('/:id/share-whatsapp', farmerController.shareWhatsApp);
router.post('/:id/whatsapp-share', farmerController.shareWhatsApp);

export { router as farmerRouter };

