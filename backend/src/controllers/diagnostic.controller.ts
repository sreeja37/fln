import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import {
  DiagnosticService,
  DiagnosticValidationError,
  DiagnosticAuthorizationError,
} from '../services/diagnostic.service';

/**
 * Controller for the Diagnostic module — Bulk surface only.
 *
 * Three handlers registered by `routes/diagnostic.routes.ts`:
 *   - POST /api/diagnostic/bulk             -> startBulk
 *   - GET  /api/diagnostic/bulk/:id/...     -> getBulkProgress / downloadBulk
 *
 * Wire format on every response is identical to the legacy `index.ts`
 * implementation. The frontend `BulkDiagnosticWorkflow.tsx` does:
 *   - `setJob(data)`           on POST 200/202
 *   - `setJob(data)`           on GET progress 200
 *   - `href={job.downloadUrl}` on GET download
 *   - error fallback: `data.error || '<fallback>'`
 *
 * Error envelopes use `{ error: string }` shape so the frontend's
 * `data.error` reads work. Domain errors from the service are mapped to
 * the legacy status codes (400 / 403 / 404) by this controller.
 *
 * The legacy `res.download(path, name)` is preserved exactly, including
 * the `.zip` suffix on the Content-Disposition filename (the file on disk
 * is a PDF; the legacy handler labelled the download as `.zip` and we
 * keep that contract so any saved-as artifact keeps its current name).
 */

const diagnosticService = new DiagnosticService();

export class DiagnosticController {
  /**
   * POST /api/diagnostic/bulk
   *
   * Returns 202 Accepted with `{ jobId, classNumber, totalStudents,
   * status, progressUrl }` so the frontend can begin polling immediately.
   * The actual paper generation runs in the background inside the service.
   */
  async startBulk(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { classNumber, count, students } = req.body ?? {};

      // `req.user` (from `authenticate` middleware) uses `userId`, not `id`.
      // `blockCode` / `assignedSchools` are optional and only present for
      // BLOCK_ADMIN / VOLUNTEER tokens — the service handles undefined.
      const authContext = {
        userId: req.user.userId ?? '',
        email: req.user.email,
        role: req.user.role ?? '',
        schoolId: req.user.schoolId ?? '',
        blockCode: (req.user as any).blockCode,
        assignedSchools: (req.user as any).assignedSchools,
      };

      const { job } = await diagnosticService.startBulk(authContext, {
        classNumber,
        count,
        students,
      });

      res.status(202).json({
        jobId: job.jobId,
        classNumber: job.classNumber,
        totalStudents: job.totalSets,
        status: job.status,
        progressUrl: `/api/diagnostic/bulk/${job.jobId}/progress`,
      });
    } catch (error) {
      if (error instanceof DiagnosticValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      if (error instanceof DiagnosticAuthorizationError) {
        res.status(403).json({ error: error.message });
        return;
      }
      next(error);
    }
  }

  /**
   * GET /api/diagnostic/bulk/:jobId/progress
   *
   * Returns the legacy progress DTO. The frontend uses `totalStudents` to
   * compute the percent (BulkDiagnosticWorkflow.tsx line ~117) and reads
   * `pdfUrl` / `downloadUrl` / `error` for the running / done / failed
   * states.
   */
  async getBulkProgress(req: Request, res: Response, _next: NextFunction): Promise<void> {
    const jobId = req.params.jobId;
    const job = diagnosticService.getBulkProgress(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    res.status(200).json(diagnosticService.toProgressDto(job));
  }

  /**
   * GET /api/diagnostic/bulk/:jobId/download
   *
   * Streams the generated PDF (legacy behaviour kept: filename advertises
   * `.zip` even though the file on disk is a PDF — preserves the
   * Content-Disposition contract for any existing browser-saved copies).
   */
  async downloadBulk(req: Request, res: Response, _next: NextFunction): Promise<void> {
    const jobId = req.params.jobId;
    const target = diagnosticService.getDownloadTarget(jobId);

    if (target.kind === 'not_found') {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    if (target.kind === 'not_ready') {
      res.status(400).json({ error: 'Job not yet completed.' });
      return;
    }
    if (target.kind === 'file_missing') {
      res.status(404).json({ error: 'PDF file not found on disk.' });
      return;
    }

    if (!fs.existsSync(target.filePath)) {
      res.status(404).json({ error: 'PDF file not found on disk.' });
      return;
    }

    res.download(target.filePath, target.downloadName);
  }
}