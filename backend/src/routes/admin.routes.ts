import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { authenticate } from '../middlewares/auth';

const router = Router();
const controller = new AdminController();

// Mounted at /api/admin by app.ts. Authentication is enforced uniformly
// across the slice — matches the legacy `if (!user) return 401` check from
// index.ts line 1514 without reimplementing it per handler.
//
// Phase-1 surface area: only the coordinators index endpoint. Future admin
// endpoints (revive-teacher, restore-school, etc.) can be appended here
// without changing app.ts again.
router.use(authenticate);

router.get('/coordinators', controller.getCoordinators);

export default router;