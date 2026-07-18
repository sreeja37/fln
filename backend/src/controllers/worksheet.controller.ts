import { Request, Response, NextFunction } from 'express';
import {
  WorksheetService,
  WorksheetValidationError,
  WorksheetNotFoundError,
  UpstreamServiceError,
} from '../services/worksheet.service';


/**
 * Controller for the Worksheet slice — Level-Wise surface only.
 *
 * Three handlers, mounted by `routes/worksheet.routes.ts`:
 *
 *   POST /api/worksheets/generate-level-pdf       -> generateLevelPdf
 *   POST /api/worksheets/generate-level-batch     -> generateLevelBatch
 *   GET  /api/worksheets/download-batch/:batchId  -> downloadBatchZip
 *
 * Wire formats mirror the legacy `index.ts` handlers exactly:
 *   - 200 OK with `{ success, ... }` envelope for happy paths.
 *   - 400 with `{ error: string }` for validation failures.
 *   - 404 with `{ error: string }` for missing students.
 *   - 500 with `{ success: false, error: string }` for unexpected failures
 *     in the batch / single PDF paths (legacy envelopes differ — preserved).
 *   - 502 with `{ error: string }` for upstream Levels_backend failures
 *     on the zip-download path.
 *
 * Authentication is enforced at the slice boundary (in
 * `worksheet.routes.ts`) so each handler focuses on its job — same
 * pattern as the diagnostic slice.
 */

const worksheetService = new WorksheetService();

export class WorksheetController {
  /**
   * POST /api/worksheets/generate-level-pdf
   *
   * Body: `{ studentId: string }`. Returns 200 with `{ success, pdfUrl }`
   * on success, or `{ success: true, pdfUrl, fallback: true }` if the
   * Levels_backend pipeline failed and the local Puppeteer fallback
   * was used instead.
   */
  async generateLevelPdf(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { studentId } = req.body ?? {};
      const outcome = await worksheetService.generateLevelPdf(studentId);
      res.status(200).json(outcome);
    } catch (error) {
      if (error instanceof WorksheetValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      if (error instanceof WorksheetNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      next(error);
    }
  }

  /**
   * POST /api/worksheets/generate-level-batch
   *
   * Body: `{ studentIds: string[] }`. Returns 200 with the legacy shape:
   *   { success, batchId, studentsProcessed, totalFiles, results, skipped }
   *
   * Mirrors `index.ts:1189-1197`. The frontend reads
   * `data.batchId` for the ZIP download button and `data.skipped` to
   * display per-student rejection reasons.
   */
  async generateLevelBatch(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { studentIds } = req.body ?? {};
      const outcome = await worksheetService.generateLevelBatch(studentIds);
      res.status(200).json(outcome);
    } catch (error) {
      if (error instanceof WorksheetValidationError) {
        // Legacy contract: 400 with the raw error string. For the
        // "no eligible students" path the legacy code also embedded
        // the `skipped` list in the body — re-derive from the request
        // and append it.
        if (error.message === 'No eligible (placed) students in this request.') {
          const ids = Array.isArray(req.body?.studentIds)
            ? req.body.studentIds.map(String)
            : [];
          const { skipped } = await worksheetService.partitionTargets(ids);
          res.status(400).json({ error: error.message, skipped });
          return;
        }
        res.status(400).json({ error: error.message });
        return;
      }
      if (error instanceof UpstreamServiceError) {
        res.status(502).json({ error: error.message });
        return;
      }
      next(error);
    }
  }

  /**
   * GET /api/worksheets/download-batch/:batchId
   *
   * Streams the raw batch ZIP straight from Levels_backend. No
   * transformation — pass-through.
   *
   * Returns the legacy headers exactly:
   *   Content-Type: application/zip
   *   Content-Disposition: attachment; filename="batch_<batchId>.zip"
   */
  async downloadBatchZip(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const batchId = req.params.batchId;
      const { buffer, downloadName } = await worksheetService.downloadBatchZip(
        batchId
      );
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${downloadName}"`
      );
      res.status(200).send(buffer);
    } catch (error) {
      if (error instanceof UpstreamServiceError) {
        res.status(502).json({ error: error.message });
        return;
      }
      next(error);
    }
  }
}