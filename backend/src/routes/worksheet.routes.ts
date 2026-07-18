import { Router } from 'express';
import { WorksheetController } from '../controllers/worksheet.controller';
import { authenticate } from '../middlewares/auth';

const router = Router();
const controller = new WorksheetController();

/**
 * Level-Wise Worksheet slice. Mounted at `/api/worksheets` by `app.ts`.
 *
 * Authentication is applied once at the slice boundary so each handler
 * stays focused on its job — matches the legacy
 * `if (!user) return res.status(401).json({error: 'Unauthorized'})`
 * check from `index.ts:1103`, `1149`, `1206` without reimplementing it
 * per handler.
 *
 * Surface area — level-wise generation only (per the migration brief):
 *
 *   POST /generate-level-pdf                         -> controller.generateLevelPdf
 *   POST /generate-level-batch                       -> controller.generateLevelBatch
 *   GET  /download-batch/:batchId                    -> controller.downloadBatchZip
 *
 * Other legacy worksheet endpoints (`/generate`, `/generate-pdf`) are
 * NOT migrated here — they belong to a different slice and are out of
 * scope for this task.
 */
router.use(authenticate);

router.post('/generate-level-pdf', controller.generateLevelPdf);
router.post('/generate-level-batch', controller.generateLevelBatch);
router.get('/download-batch/:batchId', controller.downloadBatchZip);

export default router;