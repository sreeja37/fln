import { Request, Response, NextFunction } from 'express';
import httpStatus from 'http-status';
import {
  EvaluationReportService,
  ListReportsContext,
  ListReportsFilters,
} from '../services/evaluation-report.service';

/**
 * Controller for the Evaluation Report module.
 *
 * Surface area (Phase 1):
 *   - GET /api/evaluation-reports?studentId=…&classGroup=…&section=…
 *
 * Response shape:
 *   Returns a raw JSON array (no `sendSuccess` envelope) so the
 *   frontend's `Array.isArray(d)` check in the React Query hook accepts
 *   the payload directly. Same convention as the Student module's GET.
 *
 * Query params:
 *   - studentId (optional) — restricts to one student's history.
 *   - classGroup (optional) — restricts to reports for students in this
 *     class. Resolved via the live Student collection.
 *   - section (optional) — restricts to reports for students in this
 *     section. Always combined with `classGroup` on the frontend.
 *
 * Auth:
 *   Routes mount `router.use(authenticate)` so `req.user` is populated
 *   when this handler runs. The service uses `req.user.role` and
 *   `req.user.schoolId` to apply school-scope filtering.
 */
const service = new EvaluationReportService();

export class EvaluationReportController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filters: ListReportsFilters = {};
      if (typeof req.query.studentId === 'string' && req.query.studentId.trim() !== '') {
        filters.studentId = req.query.studentId.trim();
      }
      if (typeof req.query.classGroup === 'string' && req.query.classGroup.trim() !== '') {
        filters.classGroup = req.query.classGroup.trim();
      }
      if (typeof req.query.section === 'string' && req.query.section.trim() !== '') {
        filters.section = req.query.section.trim();
      }

      const ctx: ListReportsContext = {
        role: req.user?.role,
        schoolId: req.user?.schoolId,
      };

      const reports = await service.listReports(filters, ctx);
      res.status(httpStatus.OK).json(reports);
    } catch (error) {
      next(error);
    }
  }
}