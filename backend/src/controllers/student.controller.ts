import { Request, Response, NextFunction } from 'express';
import httpStatus from 'http-status';
import { StudentService } from '../services/student.service';
import { AppError } from '../middlewares/errorHandler';

/**
 * Controller for the Student module.
 *
 * Surface area (Phase 1):
 *   - GET    /api/students    -> getAll
 *   - POST   /api/students    -> create
 *
 * Response shape:
 *   GET returns a raw JSON array (no `sendSuccess` envelope) so the
 *   frontend's `Array.isArray(d)` check in `PanelViews.tsx` line 283
 *   accepts the payload directly. Same convention as `class.controller`.
 *
 *   POST returns a raw JSON object (no envelope) so the frontend's
 *   `handleAddStudent` can read `data.id`, `data.name`, etc. directly.
 *   Same convention as legacy `index.ts` POST /api/students line 470.
 *
 * Role-based Aadhar masking (§13.2 R-6, legacy lines 396-405) is applied
 * at this layer for GET responses: Superadmin sees the raw value stored
 * in `aadharMasked`; all other roles see the `XXXX-XXXX-1234` mask.
 */
const studentService = new StudentService();

export class StudentController {
  /**
   * GET /api/students?classGroup=Class 2&section=A
   *
   * Reads optional query params and forwards them to the service. The
   * caller's school is taken from the verified JWT (`req.user.schoolId`)
   * so a teacher never sees another school's students.
   */
  async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filters: { classGroup?: string; section?: string; schoolId?: string } = {};

      if (typeof req.query.classGroup === 'string' && req.query.classGroup.trim() !== '') {
        filters.classGroup = req.query.classGroup.trim();
      }
      if (typeof req.query.section === 'string' && req.query.section.trim() !== '') {
        filters.section = req.query.section.trim();
      }
      if (req.user?.schoolId) {
        filters.schoolId = req.user.schoolId;
      }

      const students = await studentService.listStudents(filters);

      // Apply role-based Aadhar masking at the response edge so the
      // service / repository stay unaware of role concerns.
      const userRole = req.user?.role;
      const maskedStudents = students.map(s => {
        if (userRole !== 'superadmin') {
          return { ...s, aadharMasked: 'XXXX-XXXX-' + (s.aadharMasked || '').slice(-4) };
        }
        return s;
      });

      res.status(httpStatus.OK).json(maskedStudents);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/students
   *
   * Body: { name, age, classGroup, section, schoolId, aadharNumber }
   *
   * On success returns the freshly created student as a raw JSON object
   * (no envelope) — same shape as the legacy POST response so the
   * frontend's `handleAddStudent` (`RoleDashboards.tsx` line 1856) keeps
   * working unchanged.
   */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { name, age, classGroup, section, schoolId, aadharNumber } = req.body;

      const created = await studentService.registerStudent(
        { name, age, classGroup, section, schoolId, aadharNumber },
        {
          role: req.user?.role || '',
          teacherId: req.user?.teacherId,
        }
      );

      // Echo back the freshly-created student. The frontend's
      // `handleAddStudent` reads `data.id`, `data.name`, etc. directly, so
      // we mirror the legacy POST response shape (raw object, no envelope).
      res.status(httpStatus.CREATED).json(created);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/students/:id
   *
   * Returns the enriched Student Profile shape used by the new Teacher
   * Dashboard "View Profile" modal. Read-only. Same response convention
   * as `getAll`: a raw JSON object (no envelope) so the frontend's
   * fetch-based call sites can read fields directly.
   *
   * Status codes:
   *   200 — profile found and scope-allowed
   *   400 — no id in path
   *   403 — caller's school does not match the student's school (and
   *         caller is not superadmin)
   *   404 — no student with the given id
   *
   * Auth is enforced upstream by `student.routes.ts`'s `router.use(authenticate)`,
   * so `req.user` is guaranteed to be populated when this handler runs.
   */
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const studentId = req.params.id;
      const profile = await studentService.getStudentProfile(studentId || '', {
        role: req.user?.role,
        schoolId: req.user?.schoolId,
      });
      res.status(httpStatus.OK).json(profile);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/students/:id
   *
   * Body: the diff-only editable payload, e.g.
   *   {
   *     name?, age?, gender?, dateOfBirth?, bloodGroup?, disabilityStatus?,
   *     guardianName?, guardianRelation?, contactNumber?, residentialAddress?,
   *     midDayMeal?, busRoute?,
   *   }
   *
   * Read-only fields are never accepted even if the caller sends them
   * (the service whitelist silently drops them). The service is also
   * the single source of truth for school-scope enforcement, 404, and
   * input validation.
   *
   * On success returns the freshly-updated student as a raw JSON object
   * (no envelope), with role-based Aadhar masking applied at the
   * response edge so Superadmin sees the raw value and other roles see
   * `XXXX-XXXX-1234`. Same wire shape as the legacy POST response, so
   * the frontend's `useUpdateStudent` hook can call
   * `queryClient.setQueryData(['students'], …)` or `invalidateQueries`
   * interchangeably.
   *
   * Status codes:
   *   200 — patched
   *   400 — bad id, empty patch, or validation failure
   *   403 — cross-school patch attempt by non-superadmin
   *   404 — no student with the given id
   */
  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const studentId = req.params.id;
      const updated = await studentService.updateStudent(
        studentId || '',
        (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>,
        {
          role: req.user?.role,
          schoolId: req.user?.schoolId,
        }
      );

      const userRole = req.user?.role;
      const masked =
        userRole !== 'superadmin'
          ? {
              ...updated,
              aadharMasked:
                'XXXX-XXXX-' + (updated.aadharMasked || '').slice(-4),
            }
          : updated;

      res.status(httpStatus.OK).json(masked);
    } catch (error) {
      next(error);
    }
  }

  // ====================================================================
  //  Onboarding Diagnostic surface
  //  (extensions to the Student module — no new routes/controllers/services
  //   were created; the existing four files are the only ones touched.)
  // ====================================================================
  //
  // These two handlers preserve the legacy
  // `src/index.ts:497-781` contract:
  //   - 200 + `{ student, diagnosticPaper }` on generate
  //   - 200 + `{ student, evaluation, report }` on submit
  //   - 404 + `{ error: 'Student not found.' }` on missing student
  //   - 401 handled by the slice-level `router.use(authenticate)`
  //
  // We deliberately do NOT delegate to the global `errorHandler` here
  // because it returns an envelope shape
  // (`{ success, message, data }`) that the frontend's
  // `DiagnosticWorkflow.tsx:39` does not read — it expects
  // `data.error`. Translating `AppError` to that legacy envelope
  // locally keeps the wire contract identical to the legacy
  // implementation.

  /**
   * POST /api/students/:id/diagnostic
   * Port of legacy `index.ts:497-556`. No body — the diagnostic paper
   * is derived entirely from the resolved student record.
   *
   * `req.user` is guaranteed to be populated by the slice-level
   * `router.use(authenticate)` middleware in `student.routes.ts`.
   */
  async generateDiagnostic(req: Request, res: Response, _next: NextFunction): Promise<void> {
    try {
      const studentId = (req.params.id || '').toString();
      const actingUser = {
        userId: req.user?.userId || '',
        email: req.user?.email || '',
        role: req.user?.role || '',
        schoolId: req.user?.schoolId || '',
      };

      const result = await studentService.generateDiagnostic(
        studentId,
        actingUser
      );
      res.status(httpStatus.OK).json(result);
    } catch (error) {
      sendLegacyErrorEnvelope(res, error);
    }
  }

  /**
   * POST /api/students/:id/diagnostic/submit
   * Port of legacy `index.ts:591-781`. Body shape:
   *   { questions: Question[]; answers: Record<string,string> }
   */
  async submitDiagnostic(req: Request, res: Response, _next: NextFunction): Promise<void> {
    try {
      const studentId = (req.params.id || '').toString();
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
        questions?: Array<{ question_id: string; answer: string; source_level?: number; [k: string]: unknown }>;
        answers?: Record<string, string>;
      };
      const actingUser = {
        userId: req.user?.userId || '',
        email: req.user?.email || '',
        role: req.user?.role || '',
        schoolId: req.user?.schoolId || '',
      };

      const questions = Array.isArray(body.questions) ? body.questions : [];
      const answers =
        body.answers && typeof body.answers === 'object'
          ? body.answers
          : ({} as Record<string, string>);

      const result = await studentService.submitDiagnostic(
        studentId,
        { questions: questions as any, answers },
        actingUser
      );
      res.status(httpStatus.OK).json(result);
    } catch (error) {
      sendLegacyErrorEnvelope(res, error);
    }
  }
}

/**
 * Emit the legacy `{ error: '…' }` wire envelope directly from the
 * controller, bypassing the global `errorHandler` (which uses a
 * different envelope shape). Mirrors the legacy
 * `res.status(404).json({ error: 'Student not found.' })` calls in
 * `index.ts:506` / `index.ts:601`. Keeps the diagnostic frontend
 * callers' `data.error` reads working unchanged.
 */
function sendLegacyErrorEnvelope(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  // eslint-disable-next-line no-console
  console.error('Unhandled diagnostic error:', err);
  res
    .status(httpStatus.INTERNAL_SERVER_ERROR)
    .json({ error: 'Internal server error' });
}