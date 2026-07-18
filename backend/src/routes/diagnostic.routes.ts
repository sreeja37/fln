import { Router } from 'express';
import { DiagnosticController } from '../controllers/diagnostic.controller';
import { authenticate } from '../middlewares/auth';

const router = Router();
const controller = new DiagnosticController();

/**
 * Bulk-diagnostic slice. Mounted at `/api/diagnostic` by `app.ts`.
 *
 * Authentication is applied once at the slice boundary so each handler
 * stays focused on its job — matches the legacy `if (!user) return 401`
 * check from `index.ts:1649` without reimplementing it per handler.
 *
 * Phase-1 surface area (per the migration brief — do not add the
 * `/api/diagnostic/single` endpoint or any other siblings in this slice):
 *
 *   POST /bulk                -> controller.startBulk
 *   GET  /bulk/:jobId/progress -> controller.getBulkProgress
 *   GET  /bulk/:jobId/download -> controller.downloadBulk
 *
 * The `:jobId` param is not validated here — handlers return 404 with
 * `{ error: 'Job not found.' }` for unknown ids, mirroring the legacy
 * contract.
 */
router.use(authenticate);

router.post('/bulk', controller.startBulk);
router.get('/bulk/:jobId/progress', controller.getBulkProgress);
router.get('/bulk/:jobId/download', controller.downloadBulk);

export default router;