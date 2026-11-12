import { Router, RequestHandler } from 'express';
import { organisationController } from '../controllers/organisation.controller.js';
import { farmerRouter } from './farmer.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

// All organisation routes require authentication
router.use(authMiddleware as unknown as RequestHandler);

router.post('/', organisationController.createOrg);
router.get('/', organisationController.listOrgs);
router.get('/:orgId', organisationController.getOrg);
router.patch('/:orgId', organisationController.updateOrg);

// Member management
router.get('/:orgId/members', organisationController.listMembers);
router.post('/:orgId/members', organisationController.addMember);
router.patch('/:orgId/members/:userId', organisationController.updateMemberRole);
router.delete('/:orgId/members/:userId', organisationController.removeMember);

// Nested farmers under organisation
router.use('/:orgId/farmers', farmerRouter);

export { router as organisationRouter };

