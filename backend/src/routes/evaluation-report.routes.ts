import { Router } from 'express';
import { EvaluationReportController } from '../controllers/evaluation-report.controller';
import { authenticate } from '../middlewares/auth';

/**
 * Routes for the Evaluation Report module.
 *
 * Phase 1 surface area: a single GET endpoint at
 * `/api/evaluation-reports` with optional `studentId`, `classGroup`,
 * `section` query params. All filtering is server-side via the
 * service; the controller is intentionally thin.
 *
 * Auth: same `authenticate` middleware as the rest of the modular
 * surface. The legacy `index.ts:1395` route (`/api/evaluation/:studentId/
 * history`) is left untouched so any existing callers continue to work
 * — the new path is purely additive.
 */
const router = Router();
const controller = new EvaluationReportController();

router.use(authenticate);

router.get('/', controller.list);

export default router;