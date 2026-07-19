import { StudentRepository } from '../repositories/student.repository';
import { EvaluationReportRepository } from '../repositories/evaluation-report.repository';
import { IEvaluationReport } from '../interfaces/evaluation-report.interface';

/**
 * Service for the Evaluation Report module.
 *
 * Phase 1 surface area: a single read endpoint (`listReports`) that
 * resolves role-based school scope via the Student module. The Teacher
 * Dashboard's "Reports" panel drives off this listing, filtered down to
 * the currently-selected class+section+student in the UI.
 *
 * Why role-scope lives here (not in the controller):
 *   - The legacy `index.ts` had the same scope logic inline at line 1396
 *     (a teacher gets only reports for students at their school); we
 *     lift the equivalent check into the service so the controller stays
 *     thin and the scope is testable in isolation.
 *   - Other roles (BLOCK_ADMIN, DISTRICT_ADMIN, ADMIN, SUPERADMIN) can
 *     be added here incrementally when their Reports panels need them;
 *     for Phase 1 we honour `role === 'teacher'` and let every other
 *     role see whatever the repository returns.
 *
 * Repositories are instantiated as fields (not module-level singletons)
 * to mirror the Student module's `StudentService` pattern exactly — it
 * also stores its repository as a class field.
 */
export interface ListReportsFilters {
  /** Optional student filter; when set, only that student's reports come back. */
  studentId?: string;
  /** Optional class filter; resolved against the live roster (so seeded data without a class is excluded). */
  classGroup?: string;
  /** Optional section filter; resolved against the live roster. */
  section?: string;
  /** Acting user's school — applied automatically for non-superadmin roles. */
  schoolId?: string;
}

export interface ListReportsContext {
  role?: string;
  schoolId?: string;
}

export class EvaluationReportService {
  private readonly studentRepo = new StudentRepository();
  private readonly reportRepo = new EvaluationReportRepository();

  /**
   * List reports visible to the calling user, optionally narrowed by
   * studentId / classGroup / section.
   *
   * Resolution order:
   *   1. Start with the full collection (or the per-student slice if
   *      `studentId` is set — that's an indexed lookup).
   *   2. If the caller is a non-superadmin, restrict to reports whose
   *      `studentId` belongs to a student at the caller's school. We
   *      cross-check via the Student module so the seeded `students`
   *      collection stays the single source of truth for school scope.
   *   3. If `classGroup` / `section` are set, narrow further via the
   *      same Student cross-check.
   *
   * Returns an empty array `[]` when nothing matches — no fabrication,
   * no demo data. The frontend renders a friendly empty state in that
   * case.
   */
  async listReports(
    filters: ListReportsFilters,
    ctx: ListReportsContext
  ): Promise<IEvaluationReport[]> {
    // Step 1: base slice.
    let reports: IEvaluationReport[];
    if (filters.studentId) {
      reports = await this.reportRepo.findByStudentId(filters.studentId);
    } else {
      reports = await this.reportRepo.findAll();
    }

    if (reports.length === 0) return [];

    // Step 2: school-scope filter (non-superadmin only).
    const isSuperadmin = ctx.role === 'superadmin';
    const callerSchoolId = filters.schoolId ?? ctx.schoolId;

    // Build a quick lookup of studentId -> { schoolId, classGroup, section }
    // for the reports we actually have. One pass through `findAll()` is
    // enough — the seeded collection is small enough to keep in memory
    // here, and we only need fields for students referenced by the
    // reports.
    const referencedStudentIds = Array.from(new Set(reports.map((r) => r.studentId)));
    const referencedStudents = await this.studentRepo.findAll({
      id: { $in: referencedStudentIds },
    });
    const studentIndex = new Map(
      referencedStudents.map((s) => [s.id, s] as const)
    );

    let scoped = reports.filter((r) => {
      const stu = studentIndex.get(r.studentId);
      if (!stu) return false; // orphan report referencing a deleted student
      if (!isSuperadmin && callerSchoolId && stu.schoolId !== callerSchoolId) {
        return false;
      }
      return true;
    });

    // Step 3: class + section narrowing (live data only).
    if (filters.classGroup) {
      scoped = scoped.filter((r) => {
        const stu = studentIndex.get(r.studentId);
        return stu && stu.classGroup === filters.classGroup;
      });
    }
    if (filters.section) {
      scoped = scoped.filter((r) => {
        const stu = studentIndex.get(r.studentId);
        return stu && stu.section === filters.section;
      });
    }

    return scoped;
  }
}