import httpStatus from 'http-status';
import { StudentRepository } from '../repositories/student.repository';
import { ClassRepository } from '../repositories/class.repository';
import { SchoolRepository } from '../repositories/school.repository';
import { IStudent, IStudentDocument } from '../interfaces/student.interface';
import { AppError } from '../middlewares/errorHandler';

/**
 * Profile response shape returned by `getStudentProfile`.
 *
 * Surface area is intentionally explicit (not a re-export of `IStudent`)
 * so the profile endpoint stays stable even if the underlying Student
 * shape grows new internal fields. `gender` and `enrollmentDate` are
 * declared optional; the service is the single source of truth for
 * deciding whether to populate them (currently neither field exists in
 * the seeded `students` collection, so both end up `null` and the
 * frontend renders "Not Available" per requirement #6).
 *
 * `schoolName` is `null` when the lookup cannot resolve the school
 * (deleted, missing seed, etc.). The frontend renders this as
 * "Not Available" as well.
 */
export interface IStudentProfile {
  id: string;
  name: string;
  age: number;
  gender?: string | null;
  classGroup: string;
  section: string;
  schoolId: string;
  schoolName?: string | null;
  currentLevel: number;
  currentSubLevel?: number | null;
  enrollmentDate?: string | null;
}

/**
 * Service for the Student module.
 *
 * Mirrors `ClassService`'s minimal shape (constructor-injected repository,
 * thin pass-through methods) but adds the registration flow from legacy
 * `index.ts` POST /api/students (line 420-472):
 *
 *   - Required-field validation (controller-layer, mirrored from legacy)
 *   - Aadhar formatting (`rawAadhar = aadharNumber.replace(/[^0-9]/g, '')`)
 *   - Aadhar-length validation (>=4 digits)
 *   - Uniqueness check via repository
 *   - ID generation: `'STD_' + Math.floor(10000 + Math.random() * 90000)`
 *     (legacy `index.ts` line 444 — inlined here to match the legacy
 *     pattern, not a new shared helper)
 *   - Default level state: currentLevel=1, currentSubLevel=0,
 *     targetLevel=2, levelHistory=[], streak=0
 *   - teacherId is set from the JWT claim when the registering user is a
 *     teacher; left undefined for school admin / superadmin (legacy
 *     line 446: `teacherId: user.role === UserRole.TEACHER ? user.id : undefined`)
 */
export class StudentService {
  private repository: StudentRepository;
  private classRepository: ClassRepository;
  private schoolRepository: SchoolRepository;

  constructor() {
    this.repository = new StudentRepository();
    // ClassRepository is injected only for a future validation that the
    // (classGroup, section) pair is real in the `classes` collection. For
    // now we keep it in scope so Phase 2 can validate without widening the
    // constructor signature again.
    this.classRepository = new ClassRepository();
    // SchoolRepository handles the school-name enrichment for the profile
    // endpoint (read-only look-up by business id). No mutation path here.
    this.schoolRepository = new SchoolRepository();
  }

  /**
   * List students, optionally filtered by classGroup and/or section. The
   * optional `schoolId` is used to scope to the calling teacher's school
   * when the controller pulls it from `req.user.schoolId`.
   */
  async listStudents(filters: {
    classGroup?: string;
    section?: string;
    schoolId?: string;
  }): Promise<IStudentDocument[]> {
    const filter: Record<string, unknown> = {};
    if (filters.classGroup) filter.classGroup = filters.classGroup;
    if (filters.section) filter.section = filters.section;
    if (filters.schoolId) filter.schoolId = filters.schoolId;
    return this.repository.findAll(filter);
  }

  /**
   * Register a new student.
   *
   * `payload` is the validated request body (already coerced: `age` as
   * number, `aadharNumber` as the raw user-entered string). `actingUser`
   * carries the verified JWT identity so the service can stamp `teacherId`
   * when the registering user is a teacher — same behaviour as legacy
   * `index.ts` line 446.
   */
  async registerStudent(
    payload: {
      name: string;
      age: number;
      classGroup: string;
      section: string;
      schoolId: string;
      aadharNumber: string;
    },
    actingUser: { role: string; teacherId?: string }
  ): Promise<IStudentDocument> {
    const { name, age, classGroup, section, schoolId, aadharNumber } = payload;

    // Required-fields check. Legacy returns 400 with a flat error string;
    // we surface the same message via AppError so the global errorHandler
    // produces the matching JSON shape.
    if (!name || !age || !classGroup || !section || !schoolId || !aadharNumber) {
      throw new AppError('Missing required student details.', httpStatus.BAD_REQUEST);
    }

    // Aadhar formatting & length check (legacy `index.ts` lines 431-435).
    const rawAadhar = aadharNumber.replace(/[^0-9]/g, '');
    if (rawAadhar.length < 4) {
      throw new AppError('Invalid identity document.', httpStatus.BAD_REQUEST);
    }

    // Uniqueness check (legacy `index.ts` lines 437-441).
    const isDuplicate = await this.repository.existsByAadhar(rawAadhar);
    if (isDuplicate) {
      throw new AppError(
        'A student with this Aadhar / ID number is already registered.',
        httpStatus.BAD_REQUEST
      );
    }

    // ID generation. Legacy `index.ts` line 444: `'STD_' + Math.floor(10000
    // + Math.random() * 90000)`. We inline the same expression for parity.
    const generatedId = 'STD_' + Math.floor(10000 + Math.random() * 90000);

    // Build the document, applying the legacy defaults and the teacherId
    // stamping rule from legacy `index.ts` line 446.
    const newStudent: IStudent = {
      id: generatedId,
      name,
      age,
      classGroup,
      section,
      schoolId,
      teacherId: actingUser.role === 'teacher' ? actingUser.teacherId : undefined,
      currentLevel: 1, // Start at level 1 before diagnostic (legacy line 447)
      currentSubLevel: 0,
      targetLevel: 2,
      // Store raw Aadhar in DB; Superadmin sees it, others see the masked
      // form at the controller response edge (legacy line 448).
      aadharMasked: rawAadhar,
      levelHistory: [],
      streak: 0,
    };

    return this.repository.create(newStudent);
  }

  /**
   * Fetch a single student profile enriched with the school's human-
   * readable name. Read-only path (no mutation, no create). Implements
   * the `GET /api/students/:id` endpoint surface.
   *
   * Auth & scoping:
   *  - `callingUser.schoolId` is enforced on the student. A teacher can
   *    only see profiles for students at their own school. If the
   *    student's `schoolId` does not match the caller's, a 403 is
   *    returned (consistent with the `getAll` school-scope filter).
   *  - `superadmin` is exempted from the school check so they can
   *    inspect profiles across all schools (matches the role bypass in
   *    `auth.ts`).
   *
   * Missing fields:
   *  - The seeded `students` collection does not include `gender` or
   *    `enrollmentDate`. Both are returned as `null` so the frontend
   *    can render "Not Available" per requirement #6.
   *  - `schoolName` is `null` when the school lookup does not resolve
   *    (e.g. orphaned `schoolId`). Same fallback contract.
   *
   * Throws `AppError(404)` when the student does not exist.
   */
  async getStudentProfile(
    studentId: string,
    callingUser: { role?: string; schoolId?: string }
  ): Promise<IStudentProfile> {
    if (!studentId || typeof studentId !== 'string' || studentId.trim() === '') {
      throw new AppError('Student id is required.', httpStatus.BAD_REQUEST);
    }

    const student = await this.repository.findById(studentId.trim());
    if (!student) {
      throw new AppError('Student not found.', httpStatus.NOT_FOUND);
    }

    // School-scope enforcement. Skip for superadmin (role-bypass parity
    // with the rest of the API).
    const role = (callingUser.role || '').toLowerCase();
    if (role !== 'superadmin') {
      if (callingUser.schoolId && student.schoolId !== callingUser.schoolId) {
        throw new AppError(
          'You are not authorized to view this student.',
          httpStatus.FORBIDDEN
        );
      }
    }

    // School-name enrichment. Null on lookup failure so the frontend can
    // render "Not Available" gracefully.
    const school = await this.schoolRepository.findByBusinessId(student.schoolId);

    return {
      id: student.id,
      name: student.name,
      age: student.age,
      // Seeded docs do not carry a `gender` field yet. Surface as null so
      // the display layer can render "Not Available".
      gender: null,
      classGroup: student.classGroup,
      section: student.section,
      schoolId: student.schoolId,
      schoolName: school?.name ?? null,
      currentLevel: student.currentLevel,
      currentSubLevel: student.currentSubLevel ?? null,
      // Seeded docs do not carry an `enrollmentDate` field yet. Surface
      // as null so the display layer can render "Not Available".
      enrollmentDate: null,
    };
  }
}