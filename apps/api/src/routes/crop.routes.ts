import { Router } from 'express';
import { cropController } from '../controllers/crop.controller.js';

const router = Router();

router.get('/', cropController.list);

export { router as cropRouter };
