import { generateDiagnosticPaper } from '../paperGenerator';
import {
  diagnosticRepository,
  BulkDiagnosticJob,
  LogbookEntry,
} from '../repositories/diagnostic.repository';
import { UserRole } from '../db';

/**
 * Service for the Diagnostic module — Bulk surface only.
 *
 * Faithful port of the legacy `index.ts:1648-1794` handler chain:
 *
 *   POST /api/diagnostic/bulk            -> startBulk()
 *   GET  /api/diagnostic/bulk/:id/...    -> getBulkProgress() / downloadBulk()
 *
 * All business rules (request shape, role gating, logbook write, PDF URL
 * composition, file extension `.zip` for the download Content-Disposition)
 * are kept identical to the legacy implementation so the frontend's
 * `BulkDiagnosticWorkflow.tsx` and `RoleDashboards.tsx` consumers do not
 * need to change. The background generator runs as an inline async IIFE —
 * the same shape as the legacy code — so a single successful POST followed
 * by progress polls continues to work.
 *
 * Field-name bridge between legacy `req.user` (from `getAuthUser`) and the
 * new `authenticate` middleware:
 *
 *   legacy `user.id`        <-> req.user.userId
 *   legacy `user.role`      <-> req.user.role
 *   legacy `user.schoolId`  <-> req.user.schoolId
 *   legacy `user.email`     <-> req.user.email
 *   legacy `user.blockCode` -> not in req.user; only consumed when the
 *                              requesting role is BLOCK_ADMIN. The branch
 *                              remains a faithful port but only fires when
 *                              that field is populated on the request.
 *   legacy `user.assignedSchools` -> not in req.user. Same caveat.
 */

export interface AuthContext {
  /** Maps to legacy `user.id`. */
  userId: string;
  email: string;
  role: string;
  schoolId: string;
  /** Only present when the JWT carries it (BLOCK_ADMIN). */
  blockCode?: string;
  /** Only present when the JWT carries it (VOLUNTEER). */
  assignedSchools?: string[];
}

export interface StartBulkInput {
  classNumber: number | string;
  count: number;
  students?: Array<{ name: string; studentId: string }>;
}

export class DiagnosticService {
  // --- Validation (legacy 400 paths) ---

  /** Returns null on success, or the legacy error message string. */
  validateStartInput(input: StartBulkInput): string | null {
    if (!input.classNumber) return 'classNumber is required.';
    if (input.students && input.students.length > 0) return null;
    const paperCount = Number(input.count) || 0;
    if (paperCount <= 0) return 'count must be a positive number.';
    return null;
  }

  /**
   * Decide which class roster to render. Mirrors the legacy logic:
   * if `students` is provided, use it verbatim; otherwise synthesize
   * `count` placeholder rows (`Student N`, `PLACEHOLDER_<classN>_<i>`).
   */
  resolveStudents(input: StartBulkInput): Array<{ name: string; studentId: string }> {
    if (Array.isArray(input.students) && input.students.length > 0) {
      return input.students;
    }
    const count = Number(input.count) || 0;
    return Array.from({ length: count }, (_, i) => ({
      name: `Student ${i + 1}`,
      studentId: `PLACEHOLDER_${input.classNumber}_${i + 1}`,
    }));
  }

  // --- Authorization (legacy 403 path) ---

  /**
   * Faithful port of `index.ts:1663-1683`. Returns true if the user is
   * permitted to generate bulk diagnostic papers for `classNumber`.
   *
   * Roles covered (same as legacy):
   *   SUPERADMIN / ADMIN       -> always allowed
   *   TEACHER                  -> any class at their school with matching teacherId or schoolId
   *   VOLUNTEER                -> any class whose school is in assignedSchools
   *   SCHOOL                   -> any class at their school
   *   BLOCK_ADMIN              -> any class whose school is in their block
   */
  async isAuthorized(input: {
    classNumber: number;
    user: AuthContext;
  }): Promise<boolean> {
    const { classNumber, user } = input;
    const role = user.role;

    if (role === UserRole.SUPERADMIN || role === UserRole.ADMIN) {
      return true;
    }

    if (role === UserRole.TEACHER) {
      // Legacy: teacher passes if class is theirs OR at their school.
      const matches = await diagnosticRepository.findClassesByTeacherAndSchoolId(
        user.userId,
        user.schoolId
      );
      return matches.some((c: any) => c.className === `Class ${classNumber}`);
    }

    if (role === UserRole.VOLUNTEER) {
      const allowed = user.assignedSchools ?? [];
      const matches = await diagnosticRepository.findClassesForAuthorization(
        classNumber,
        user.schoolId
      );
      return matches.some((c: any) => allowed.includes(c.schoolId));
    }

    if (role === UserRole.SCHOOL) {
      const matches = await diagnosticRepository.findClassesForAuthorization(
        classNumber,
        user.schoolId
      );
      return matches.length > 0;
    }

    if (role === UserRole.BLOCK_ADMIN) {
      if (!user.blockCode) return false;
      const allowedSchools = await diagnosticRepository.findSchoolIdsByBlockCode(user.blockCode);
      const matches = await diagnosticRepository.findClassesForAuthorization(
        classNumber,
        user.schoolId
      );
      return matches.some((c: any) => allowedSchools.includes(c.schoolId));
    }

    return false;
  }

  // --- Start job (legacy POST 202) ---

  async startBulk(user: AuthContext, input: StartBulkInput): Promise<{
    job: BulkDiagnosticJob;
  }> {
    const validationError = this.validateStartInput(input);
    if (validationError) {
      throw new DiagnosticValidationError(validationError);
    }

    const authorized = await this.isAuthorized({
      classNumber: Number(input.classNumber),
      user,
    });
    if (!authorized) {
      throw new DiagnosticAuthorizationError(
        `You are not authorized to generate diagnostic papers for Class ${input.classNumber}.`
      );
    }

    const students = this.resolveStudents(input);
    const totalSets = students.length;

    const job = diagnosticRepository.createJob({
      classNumber: Number(input.classNumber),
      students,
      totalSets,
      owner: {
        userId: user.userId,
        email: user.email,
        role: user.role,
        schoolId: user.schoolId,
      },
    });

    // Background generation. Same shape as legacy `index.ts:1700-1737`:
    //   - onProgress ticks `completed`
    //   - on success: write fileName/filePath/pdfUrl, mark completed, log
    //   - on failure: mark failed with the caught message
    // We do NOT await this — the POST handler returns 202 immediately.
    void this.runGenerator(job);

    return { job };
  }

  /** Internal: runs the diagnostic paper generator and updates the job. */
  private async runGenerator(job: BulkDiagnosticJob): Promise<void> {
    try {
      const result = await generateDiagnosticPaper({
        classNumber: job.classNumber,
        students: job.students.map(s => ({ name: s.name, studentId: s.studentId })),
        onProgress: (setNum /* total */) => {
          diagnosticRepository.updateJob(job.jobId, { completed: setNum });
        },
      });

      diagnosticRepository.updateJob(job.jobId, {
        fileName: result.fileName,
        filePath: result.filePath,
        pdfUrl: `/output/${result.pdfFileName || result.fileName}`,
        status: 'completed',
        completedAt: new Date().toISOString(),
        completed: job.totalSets,
      });

      const log: LogbookEntry = {
        id: 'log_' + Date.now(),
        timestamp: new Date().toISOString(),
        schoolId: job.owner.schoolId || '',
        schoolName: 'GPS', // legacy hardcoded placeholder
        userId: job.owner.userId,
        userEmail: job.owner.email,
        userRole: job.owner.role,
        activityType: 'download',
        status: 'Success',
        details: `Bulk diagnostic generated: Class ${job.classNumber}, ${job.totalSets} papers`,
      };
      await diagnosticRepository.appendLogbook(log);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error during bulk generation';
      diagnosticRepository.updateJob(job.jobId, {
        status: 'failed',
        error: message,
        completedAt: new Date().toISOString(),
      });
      // eslint-disable-next-line no-console
      console.error('Bulk diagnostic job failed:', err);
    }
  }

  // --- Progress (legacy GET progress) ---

  /** Returns null if the job does not exist. */
  getBulkProgress(jobId: string): BulkDiagnosticJob | null {
    return diagnosticRepository.getJob(jobId) ?? null;
  }

  /** Shape returned to the frontend on progress polling. */
  toProgressDto(job: BulkDiagnosticJob): Record<string, unknown> {
    return {
      jobId: job.jobId,
      classNumber: job.classNumber,
      totalStudents: job.totalSets,
      completed: job.completed,
      status: job.status,
      pdfUrl: job.pdfUrl,
      error: job.error,
      downloadUrl:
        job.status === 'completed'
          ? `/api/diagnostic/bulk/${job.jobId}/download`
          : null,
    };
  }

  // --- Download (legacy GET download) ---

  /** Returns the file metadata for the controller to stream. */
  getDownloadTarget(jobId: string):
    | { kind: 'not_found' }
    | { kind: 'not_ready' }
    | { kind: 'file_missing' }
    | { kind: 'ready'; filePath: string; downloadName: string } {
    const job = diagnosticRepository.getJob(jobId);
    if (!job) return { kind: 'not_found' };
    if (job.status !== 'completed') return { kind: 'not_ready' };
    if (!job.filePath) return { kind: 'file_missing' };
    return {
      kind: 'ready',
      filePath: job.filePath,
      downloadName: `class${job.classNumber}_bulk_diagnostic.zip`,
    };
  }
}

// --- Domain errors (kept distinct so the controller can map to legacy status codes) ---

export class DiagnosticValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiagnosticValidationError';
  }
}

export class DiagnosticAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiagnosticAuthorizationError';
  }
}