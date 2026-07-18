import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import { Class } from '../models/class.model';

/**
 * Repository for the Diagnostic module (Bulk-only in Phase 1).
 *
 * Responsibilities split into two surfaces:
 *   1. **Job bookkeeping** — keeps the in-memory `Map<jobId, BulkDiagnosticJob>`
 *      that backs the three Phase-1 endpoints. The legacy `index.ts:1646`
 *      declared this `Map` next to its inline handler; here we lift it into
 *      the repository so the controller / service stay free of process-
 *      level state.
 *   2. **Authorization data access** — reads the `classes` collection
 *      (Class Mongoose model) and the `schools` collection (raw, via
 *      `mongoose.connection.db`) to evaluate role-based bulk generation
 *      permission, exactly as the legacy handler did.
 *
 * Why direct `mongoose.connection.db.collection('schools')` for schools:
 *   The Mongoose `School` model defined in `models/school.model.ts` uses
 *   its own schema (state/district/block as ObjectIds, timestamps, etc.)
 *   that does NOT match the seeded `schools` collection, which carries
 *   the legacy shape with `id, schoolName, blockCode, ...`. Running a
 *   Mongoose `School.find({ blockCode })` would not return rows that
 *   satisfy the legacy filter `s.blockCode === user.blockCode`. We
 *   therefore query the collection directly with the raw driver — the
 *   same approach the Admin slice uses — and explicitly request a lean
 *   projection of `id` so memory stays small.
 *
 * Surface area (Phase 1):
 *   - createJob, getJob, updateJob                          (job map)
 *   - findClassesForAuthorization(classNumber, schoolId?)  (Class.find)
 *   - findSchoolIdsByBlockCode(blockCode)                  (raw collection)
 *   - appendLogbook(entry)                                 (raw collection)
 */

// ----- Types -----

export interface BulkDiagnosticJob {
  jobId: string;
  classNumber: number;
  students: Array<{ name: string; studentId: string }>;
  totalSets: number;
  completed: number;
  status: 'running' | 'completed' | 'failed';
  fileName: string;
  filePath: string;
  pdfUrl: string;
  error: string;
  startedAt: string;
  completedAt: string;
  /** Tracks the requesting user for the logbook entry; populated at create. */
  owner: {
    userId: string;
    email: string;
    role: string;
    schoolId: string;
  };
}

export interface LogbookEntry {
  id: string;
  timestamp: string;
  schoolId: string;
  schoolName: string;
  userId: string;
  userEmail: string;
  userRole: string;
  activityType: string;
  status: string;
  details: string;
}

// ----- Repository -----

export class DiagnosticRepository {
  /** Process-level job store. Same scope as the legacy in-index Map. */
  private readonly jobs = new Map<string, BulkDiagnosticJob>();

  // --- Job state ---

  /** Insert a fresh job and return it. */
  createJob(input: {
    classNumber: number;
    students: Array<{ name: string; studentId: string }>;
    totalSets: number;
    owner: BulkDiagnosticJob['owner'];
  }): BulkDiagnosticJob {
    const jobId = 'bulk_' + randomUUID();
    const job: BulkDiagnosticJob = {
      jobId,
      classNumber: Number(input.classNumber),
      students: input.students,
      totalSets: input.totalSets,
      completed: 0,
      status: 'running',
      fileName: '',
      filePath: '',
      pdfUrl: '',
      error: '',
      startedAt: new Date().toISOString(),
      completedAt: '',
      owner: input.owner,
    };
    this.jobs.set(jobId, job);
    return job;
  }

  getJob(jobId: string): BulkDiagnosticJob | undefined {
    return this.jobs.get(jobId);
  }

  /** Shallow-merge a partial patch into the stored job. No-op if not found. */
  updateJob(jobId: string, patch: Partial<BulkDiagnosticJob>): BulkDiagnosticJob | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    Object.assign(job, patch);
    this.jobs.set(jobId, job);
    return job;
  }

  // --- Authorization data ---

  /**
   * Return the classes that back a `Class ${classNumber}` enrollment and that
   * the requesting user is allowed to act on. Matches the legacy TEACHER /
   * SCHOOL check by filtering classes whose `schoolId` matches the user's
   * school. The richer "teacherId matches too" check the legacy code did for
   * teachers is preserved at the service layer where the role context lives.
   */
  async findClassesForAuthorization(classNumber: number, schoolId: string): Promise<unknown[]> {
    return Class.find({
      className: `Class ${classNumber}`,
      schoolId,
    })
      .lean()
      .exec();
  }

  /** Same shape as TEACHER branch but for any matching teacher at the school. */
  async findClassesByTeacherAndSchoolId(teacherId: string, schoolId: string): Promise<unknown[]> {
    return Class.find({
      $or: [{ teacherId }, { schoolId }],
    })
      .lean()
      .exec();
  }

  /**
   * For BLOCK_ADMIN authorization. Returns the set of schoolIds belonging to
   * the block, exactly mirroring the legacy `schools.filter(s => s.blockCode
   * === user.blockCode).map(s => s.id)`.
   */
  async findSchoolIdsByBlockCode(blockCode: string): Promise<string[]> {
    const db = mongoose.connection.db;
    if (!db) return [];
    const docs = await db.collection('schools').find({ blockCode }).project({ id: 1 }).toArray();
    return docs.map(d => d.id).filter((id): id is string => typeof id === 'string');
  }

  // --- Logging ---

  /** Insert a logbook row using the legacy shape. */
  async appendLogbook(entry: LogbookEntry): Promise<void> {
    const db = mongoose.connection.db;
    if (!db) return;
    await db.collection('logbook').insertOne(entry);
  }
}

/**
 * Singleton. The job map must survive across requests, so we share one
 * instance across the controller. Mirrors the legacy single-Map pattern.
 */
export const diagnosticRepository = new DiagnosticRepository();
