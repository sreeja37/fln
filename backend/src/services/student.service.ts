import httpStatus from 'http-status';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import mongoose from 'mongoose';
import { StudentRepository } from '../repositories/student.repository';
import { ClassRepository } from '../repositories/class.repository';
import { SchoolRepository } from '../repositories/school.repository';
import { IStudent, IStudentDocument } from '../interfaces/student.interface';
import { IEvaluationReport } from '../interfaces/evaluation-report.interface';
import { Question } from '../db';
import { AppError } from '../middlewares/errorHandler';
import { generateDiagnosticPaper } from '../paperGenerator';
import { evaluateAIDiagnostic } from '../gemini';
import { generateQuestionsForLevel } from '../levelGenerator';
import { EvaluationReport } from '../models/evaluation-report.model';

// ----- Diagnostic submission response shapes (legacy parity) -----

/** Identical to the legacy handler's `evaluation` triple (index.ts:771). */
export interface IDiagnosticEvaluation {
  score: number;
  recommendedLevel: number;
  narrative: string;
}

/** Identical to the legacy handler's `diagnosticPaper` object (index.ts:540). */
export interface IDiagnosticPaper {
  id: string;
  studentId: string;
  studentName: string;
  questions: Question[];
  pdfUrl: string;
}

/** Single-shape logbook row. Matches the legacy `dbStore.addLog` envelope. */
interface IDiagnosticLogEntry {
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

/**
 * Acting-user shape used by the diagnostic methods. Mirrors the slice of
 * `req.user` (AuthPayload in `middlewares/auth.ts`) that the legacy
 * `getAuthUser` exposed (`{ id, email, role, schoolId }`). The legacy
 * `user.id` maps to `req.user.userId` in the modular auth middleware.
 */
interface IDiagnosticActingUser {
  userId: string;
  email: string;
  role: string;
  schoolId: string;
}

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
  // Phase 3: Editable personal / contact fields. Surfaced through
  // GET /api/students/:id so the Teacher Dashboard "View Profile"
  // modal reflects whatever the teacher has edited via PATCH. None of
  // these existed in the seeded docs at the time this interface was
  // extended, so all of them are `?: string | null` (or `boolean | null`
  // for midDayMeal) and the display layer falls back to "Not Available".
  dateOfBirth?: string | null;
  bloodGroup?: string | null;
  disabilityStatus?: string | null;
  guardianName?: string | null;
  guardianRelation?: string | null;
  contactNumber?: string | null;
  residentialAddress?: string | null;
  midDayMeal?: boolean | null;
  busRoute?: string | null;
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
      // Phase 3: `gender` is editable via PATCH /api/students/:id, so
      // we now read it straight off the stored document. Seeded docs
      // (and any future doc without a `gender` field) fall back to
      // `null` so the display layer can render "Not Available".
      gender: student.gender ?? null,
      classGroup: student.classGroup,
      section: student.section,
      schoolId: student.schoolId,
      schoolName: school?.name ?? null,
      currentLevel: student.currentLevel,
      currentSubLevel: student.currentSubLevel ?? null,
      // `enrollmentDate` is not yet exposed via PATCH, so seeded docs
      // (and any doc without the field) continue to surface as `null`.
      // Once that field becomes editable, this line should follow the
      // `student.fieldName ?? null` pattern used for the Phase 3
      // personal / contact fields below.
      enrollmentDate: null,
      // Phase 3: Editable personal / contact fields. Any field that is
      // absent on the stored document comes back as `null` so the
      // Teacher Dashboard modal can show "Not Available" exactly the
      // same way it does for `gender` and `enrollmentDate`. Once the
      // teacher saves via PATCH, the field round-trips through this
      // endpoint on the next View Profile click.
      dateOfBirth: student.dateOfBirth ?? null,
      bloodGroup: student.bloodGroup ?? null,
      disabilityStatus: student.disabilityStatus ?? null,
      guardianName: student.guardianName ?? null,
      guardianRelation: student.guardianRelation ?? null,
      contactNumber: student.contactNumber ?? null,
      residentialAddress: student.residentialAddress ?? null,
      midDayMeal: student.midDayMeal ?? null,
      busRoute: student.busRoute ?? null,
    };
  }

  /**
   * Patch the editable personal fields of a single student.
   *
   * Wire shape (caller-controlled, must already be the diff-only payload):
   *   {
   *     name?, age?, gender?, dateOfBirth?, bloodGroup?, disabilityStatus?,
   *     guardianName?, guardianRelation?, contactNumber?, residentialAddress?,
   *     midDayMeal?, busRoute?,
   *   }
   *
   * Out-of-bounds fields are silently dropped here; the controller is
   * responsible for whitelisting what the caller is allowed to change
   * before forwarding to this method. Read-only fields
   * (`id`, `schoolId`, `classGroup`, `section`, `currentLevel`,
   * `targetLevel`, `streak`, `levelHistory`, `aadharMasked`, etc.) are
   * never accepted by this method even if the caller puts them in the
   * patch.
   *
   * Auth & scoping:
   *  - superadmin: bypasses school-scope so they can patch any student.
   *  - any other role: must match `actingUser.schoolId` against the
   *    student's `schoolId`; otherwise 403.
   *
   * Status codes (via `AppError`):
   *  - 400 when the patch is empty or no editable fields are present.
   *  - 403 on cross-school patch attempts by non-superadmin callers.
   *  - 404 when no student matches `studentId`.
   *
   * Returns the freshly-updated student (plain object, lean) so the
   * controller can pipe it straight to the wire. Role-based Aadhar
   * masking (superadmin sees raw, others see `XXXX-XXXX-1234`) is
   * applied at the controller layer, not here.
   */
  async updateStudent(
    studentId: string,
    patch: Record<string, unknown>,
    actingUser: { role?: string; schoolId?: string }
  ): Promise<IStudent> {
    if (!studentId || typeof studentId !== 'string' || studentId.trim() === '') {
      throw new AppError('Student id is required.', httpStatus.BAD_REQUEST);
    }

    // Whitelist of editable fields. Anything else in the patch is
    // silently dropped — read-only fields (id, schoolId, classGroup,
    // section, currentLevel, targetLevel, streak, levelHistory,
    // aadharMasked, teacherId) cannot be modified from this endpoint.
    const EDITABLE: readonly string[] = [
      'name',
      'age',
      'gender',
      'dateOfBirth',
      'bloodGroup',
      'disabilityStatus',
      'guardianName',
      'guardianRelation',
      'contactNumber',
      'residentialAddress',
      'midDayMeal',
      'busRoute',
    ];

    const sanitized: Record<string, unknown> = {};
    for (const key of EDITABLE) {
      if (key in patch) sanitized[key] = patch[key];
    }

    if (Object.keys(sanitized).length === 0) {
      throw new AppError(
        'No editable fields provided.',
        httpStatus.BAD_REQUEST
      );
    }

    // Light validation of well-known constraints. Failures here produce
    // 400s; the controller does not add its own validation layer.
    if ('name' in sanitized) {
      const name = sanitized.name;
      if (typeof name !== 'string' || name.trim() === '') {
        throw new AppError('Name cannot be empty.', httpStatus.BAD_REQUEST);
      }
      sanitized.name = name.trim();
    }
    if ('age' in sanitized) {
      const age = sanitized.age;
      const ageNum = typeof age === 'number' ? age : Number(age);
      if (!Number.isFinite(ageNum) || ageNum < 3 || ageNum > 25) {
        throw new AppError('Age must be between 3 and 25.', httpStatus.BAD_REQUEST);
      }
      sanitized.age = ageNum;
    }
    if ('contactNumber' in sanitized) {
      const contact = sanitized.contactNumber;
      if (contact != null && contact !== '') {
        const digits = String(contact).replace(/[^0-9]/g, '');
        if (digits.length < 7 || digits.length > 15) {
          throw new AppError(
            'Contact number must contain between 7 and 15 digits.',
            httpStatus.BAD_REQUEST
          );
        }
        // Preserve the user-entered format (e.g. "+91-9876543210") in the
        // DB so the frontend can display it the way the teacher typed it.
        // Only the digit count is validated; sanitization is left to the
        // view layer.
        sanitized.contactNumber = String(contact).trim();
      }
    }
    if ('dateOfBirth' in sanitized) {
      const dob = sanitized.dateOfBirth;
      if (dob != null && dob !== '') {
        const d = new Date(dob as string);
        if (isNaN(d.getTime())) {
          throw new AppError('Date of birth is not a valid date.', httpStatus.BAD_REQUEST);
        }
      }
    }

    // Scope check. Read the student first so we know its school before
    // we attempt the update — same auth pattern as `getStudentProfile`.
    const existing = await this.repository.findById(studentId.trim());
    if (!existing) {
      throw new AppError('Student not found.', httpStatus.NOT_FOUND);
    }

    const role = (actingUser.role || '').toLowerCase();
    if (role !== 'superadmin') {
      if (actingUser.schoolId && existing.schoolId !== actingUser.schoolId) {
        throw new AppError(
          'You are not authorized to edit this student.',
          httpStatus.FORBIDDEN
        );
      }
    }

    const updated = await this.repository.updateById(studentId.trim(), sanitized);
    if (!updated) {
      // Defensive: the doc disappeared between findById and updateById.
      throw new AppError('Student not found.', httpStatus.NOT_FOUND);
    }

    return updated;
  }

  // ====================================================================
  //  Onboarding Diagnostic surface
  //  (ports of legacy src/index.ts:497-781 — POST /api/students/:id/diagnostic
  //   and POST /api/students/:id/diagnostic/submit)
  // ====================================================================
  //
  // These methods do not change the existing Student CRUD behaviour; they
  // add two new endpoints that the frontend already calls from
  // `components/DiagnosticWorkflow.tsx` and `components/IcrScanner.tsx`.
  //
  // Persistence layout is intentionally unchanged from the legacy
  // implementation:
  //   - student update: routed through `StudentRepository.updateById`
  //     (the one Student-specific repository, already in the module).
  //   - evaluation report: written via the existing `EvaluationReport`
  //     Mongoose model (same physical collection the modular Reports
  //     panel reads via `EvaluationReportRepository.findAll`).
  //   - logbook row: written via the existing raw-collection
  //     `db.collection('logbook').insertOne(...)` mechanism, identical
  //     to `repositories/diagnostic.repository.ts:appendLogbook` \u2014
  //     we don't duplicate that one-liner in the Student repository.
  //
  // Error handling: this service throws `AppError(404, 'Student not found.')`
  // to match the legacy handler's `res.status(404).json({ error: 'Student not found.' })`
  // contract. The controller translates the AppError into the `{ error }`
  // wire envelope the frontend expects (see
  // `frontend/src/components/DiagnosticWorkflow.tsx:39`).
  //
  // Auth: both endpoints sit behind the existing
  // `router.use(authenticate)` in `student.routes.ts`, so `req.user` is
  // always populated and we just read `userId/email/role/schoolId` from
  // the `actingUser` shape that the controller forwards.

  /**
   * Faithful port of legacy `index.ts:497-556` —
   * POST /api/students/:id/diagnostic.
   *
   * Tries the Puppeteer-rendered PDF worksheet generator first; on any
   * failure (e.g. Chromium not installed in CI), falls back to a 12-question
   * mock paper drawn from `generateQuestionsForLevel` over the class's
   * level band. Either path produces the same wire shape.
   *
   * Returns the student (echo of the lookup) plus the freshly-generated
   * `diagnosticPaper` object the frontend consumes in
   * `DiagnosticWorkflow.tsx`. Identical to legacy lines 540-558.
   *
   * Throws `AppError(404)` when the student does not exist.
   */
  async generateDiagnostic(
    studentId: string,
    _actingUser: IDiagnosticActingUser
  ): Promise<{ student: IStudent; diagnosticPaper: IDiagnosticPaper }> {
    const student = await this.repository.findById(studentId);
    if (!student) {
      throw new AppError('Student not found.', httpStatus.NOT_FOUND);
    }

    const classNumber = this.parseClassNumber(student.classGroup);

    let questions: Question[] = [];
    let pdfUrl = '';

    try {
      // Generate the official PDF worksheet paper via Puppeteer
      // (legacy `index.ts:507-525`).
      const result = await generateDiagnosticPaper({
        classNumber,
        students: [
          {
            name: student.name,
            studentId: student.id,
            qrData: {
              age: student.age,
              classGroup: student.classGroup,
              section: student.section,
              schoolId: student.schoolId,
              currentLevel: student.currentLevel,
              currentSubLevel: student.currentSubLevel ?? 0,
              targetLevel: student.targetLevel,
              streak: student.streak ?? 0,
            },
          },
        ],
      });
      questions = (result.questions as Question[]) || [];
      pdfUrl = `/output/${result.fileName}`;
    } catch (err) {
      // Puppeteer unavailable / Chromium not installed -> mock questions
      // from the level generator (legacy `index.ts:533-547`).
      // eslint-disable-next-line no-console
      console.error(
        'Puppeteer paper generation failed, using level generator mock:',
        err
      );
      const startLevel = (classNumber - 1) * 12 + 1;
      questions = [];
      for (let lvl = startLevel; lvl < startLevel + 8; lvl++) {
        const lvlQuestions = generateQuestionsForLevel(Math.min(lvl, 59), 0);
        lvlQuestions.forEach(q => {
          questions.push({
            ...q,
            question_id: `DIAG_${lvl}_${q.question_id}`,
            source_level: Math.min(lvl, 59),
          });
        });
      }
      questions = questions.slice(0, 12);
    }

    return {
      student,
      diagnosticPaper: {
        id: 'diag_' + student.id + '_' + Date.now(),
        studentId: student.id,
        studentName: student.name,
        questions,
        pdfUrl,
      },
    };
  }

  /**
   * Faithful port of legacy `index.ts:591-781` —
   * POST /api/students/:id/diagnostic/submit.
   *
   * Pipeline (legacy verbatim):
   *   1. Resolve student (404 if missing).
   *   2. Write the per-student `student_responses/class_<n>/phrase_1/<id>.json`
   *      file under `backend/evaluation_metrics/...` (the same layout
   *      legacy `index.ts:606-628` produced).
   *   3. Run `python run_pipeline.py <n> phrase_1 <id>` followed by the
   *      best-effort `python personalized_evaluation_pipeline.py ...`.
   *   4. Read `<id>_evaluation_<date>.json` and `<id>_report_<date>.txt`
   *      to derive the score, recommendedLevel, and narrative.
   *   5. On any pipeline failure, fall back to `evaluateAIDiagnostic`
   *      from the existing `gemini.ts` helper (legacy `index.ts:678-685`).
   *   6. Compute the `subLevel` (Mastery=0 / Easier=1 / Remedial=2) from
   *      the `source_level === recommendedLevel` question outcomes.
   *   7. Update the student via `StudentRepository.updateById` with the
   *      new `currentLevel`, `currentSubLevel`, `targetLevel =
   *      Math.min(59, recommendedLevel + 1)`, and `levelHistory` push.
   *   8. Build the `conceptMastery` map from defaults + the optional
   *      `topics_to_focus` overlay in the pipeline eval JSON.
   *   9. Insert the report via the existing `EvaluationReport` Mongoose
   *      model (`db.collection('evaluationReports')`).
   *  10. Append a logbook row via the existing raw `logbook` collection
   *      write pattern (same one-liner as the bulk diagnostic
   *      `appendLogbook` helper).
   *
   * Returns the legacy wire envelope `{ student, evaluation: { score,
   * recommendedLevel, narrative }, report }` (legacy `index.ts:771`).
   *
   * Auth: the request must already have been authenticated upstream by
   * the slice-level `router.use(authenticate)` so `actingUser` is
   * populated.
   */
  async submitDiagnostic(
    studentId: string,
    body: { questions: Question[]; answers: Record<string, string> },
    actingUser: IDiagnosticActingUser
  ): Promise<{
    student: IStudent;
    evaluation: IDiagnosticEvaluation;
    report: IEvaluationReport;
  }> {
    const student = await this.repository.findById(studentId);
    if (!student) {
      throw new AppError('Student not found.', httpStatus.NOT_FOUND);
    }

    const { questions, answers } = body;
    const classNumber = this.parseClassNumber(student.classGroup);

    // Connect to Python Evaluation Metrics Pipeline (legacy 606-628)
    const dateStr = new Date().toISOString().split('T')[0];
    const pipelineDir = path.join(this.backendRoot(), 'evaluation_metrics');
    const responseDir = path.join(
      pipelineDir,
      'student_responses',
      `class_${classNumber}`,
      'phrase_1'
    );
    fs.mkdirSync(responseDir, { recursive: true });

    // Map answers sequentially (any question_id -> Q1, Q2, Q3...)
    const pipelineAnswers: { [qId: string]: { answer: string; confidence: number } } = {};
    questions.forEach((q, idx) => {
      const qNum = idx + 1;
      const pipelineQId = `Q${qNum}`;
      const submitted = (answers[q.question_id] || '').trim();
      pipelineAnswers[pipelineQId] = {
        answer: String(submitted),
        confidence: 0.95,
      };
    });

    const studentResponse = {
      student_id: student.id,
      student_name: student.name,
      enrolled_class: classNumber,
      test_date: dateStr,
      phrase: 'phrase_1',
      exam_id: `C${classNumber}_WORKSHEET_PHRASE_1`,
      answers: pipelineAnswers,
    };

    const responsePath = path.join(responseDir, `${student.id}.json`);
    fs.writeFileSync(responsePath, JSON.stringify(studentResponse, null, 2));

    let score = 0;
    let recommendedLevel = 1;
    let narrative = '';

    try {
      // eslint-disable-next-line no-console
      console.log(`Running evaluation pipeline for student ${student.id}...`);

      // Run the comparison, evaluation, and report card generation
      // pipeline (legacy 635-650).
      execSync(`python run_pipeline.py ${classNumber} phrase_1 ${student.id}`, {
        cwd: pipelineDir,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });

      // Personalized exam pipeline too (best-effort; legacy 652-660).
      try {
        execSync(
          `python personalized_evaluation_pipeline.py ${student.id} ${classNumber} phrase_1`,
          {
            cwd: pipelineDir,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
          }
        );
      } catch (pexErr) {
        // eslint-disable-next-line no-console
        console.warn('Personalized exam generation skipped or failed:', pexErr);
      }

      // Read evaluation result JSON and report text (legacy 663-680).
      const evalReportPath = path.join(
        pipelineDir,
        'evaluation_reports',
        `class_${classNumber}`,
        'phrase_1',
        'evaluation',
        `${student.id}_evaluation_${dateStr}.json`
      );
      const reportTxtPath = path.join(
        pipelineDir,
        'evaluation_reports',
        `class_${classNumber}`,
        'phrase_1',
        'reports',
        `${student.id}_report_${dateStr}.txt`
      );

      if (fs.existsSync(evalReportPath)) {
        const evalData = JSON.parse(fs.readFileSync(evalReportPath, 'utf-8'));
        score = evalData.total_questions - (evalData.wrong_count || 0);

        const levelStr = String(evalData.demonstrated_level || '1');
        const lvlMatch = levelStr.match(/\d+/);
        if (lvlMatch) {
          const matchedNum = parseInt(lvlMatch[0], 10);
          if (levelStr.toLowerCase().includes('class')) {
            recommendedLevel = (matchedNum - 1) * 10 + 1;
          } else {
            recommendedLevel = matchedNum;
          }
        } else {
          recommendedLevel = 1;
        }
      }

      if (fs.existsSync(reportTxtPath)) {
        narrative = fs.readFileSync(reportTxtPath, 'utf-8');
      }
    } catch (pipelineErr) {
      // Fallback to Gemini AI if Python pipeline fails
      // (legacy 687-693).
      // eslint-disable-next-line no-console
      console.error(
        'Python evaluation pipeline failed, falling back to Gemini AI:',
        pipelineErr
      );
      const evaluation = await evaluateAIDiagnostic(
        student.name,
        questions,
        answers
      );
      score = evaluation.score;
      recommendedLevel = evaluation.recommendedLevel;
      narrative = evaluation.narrative;
    }

    // Determine the subLevel based on weakest-level mapping questions
    // (legacy 700-720).
    let subLevel = 0; // default Mastery
    const levelQuestions = questions.filter(
      q => q.source_level === recommendedLevel
    );
    if (levelQuestions.length > 0) {
      let failedCount = 0;
      levelQuestions.forEach(q => {
        const submitted = (answers[q.question_id] || '').trim().toLowerCase();
        const correct = q.answer.trim().toLowerCase();
        if (submitted !== correct) {
          failedCount++;
        }
      });

      if (failedCount === levelQuestions.length) {
        subLevel = 2; // Remedial (failed all)
      } else if (failedCount > 0) {
        subLevel = 1; // Easier (failed some)
      } else {
        subLevel = 0; // Mastery
      }
    }

    // Update Student placing levels (legacy 723-737).
    const levelHistory = [
      ...(student.levelHistory || []),
      {
        level: recommendedLevel,
        subLevel,
        date: new Date().toISOString().split('T')[0],
        reason: 'Onboarding Diagnostic Evaluation Placement',
      },
    ];

    const updatedStudent = await this.repository.updateById(student.id, {
      currentLevel: recommendedLevel,
      currentSubLevel: subLevel,
      targetLevel: Math.min(59, recommendedLevel + 1),
      levelHistory: levelHistory as unknown as IStudent['levelHistory'],
    });

    // Build the concept-mastery map (legacy 740-757) with the optional
    // `topics_to_focus` overlay from the pipeline evaluation JSON.
    const conceptMastery: {
      [topic: string]: 'Strong' | 'Needs Practice' | 'Satisfactory';
    } = {
      'Number Sense': recommendedLevel >= 15 ? 'Strong' : 'Needs Practice',
      Shapes: recommendedLevel >= 25 ? 'Strong' : 'Needs Practice',
      Fractions: recommendedLevel >= 35 ? 'Strong' : 'Needs Practice',
      Operations: recommendedLevel >= 12 ? 'Strong' : 'Needs Practice',
    };

    try {
      const evalReportPath = path.join(
        pipelineDir,
        'evaluation_reports',
        `class_${classNumber}`,
        'phrase_1',
        'evaluation',
        `${student.id}_evaluation_${dateStr}.json`
      );
      if (fs.existsSync(evalReportPath)) {
        const evalData = JSON.parse(fs.readFileSync(evalReportPath, 'utf-8'));
        if (evalData.topics_to_focus && Array.isArray(evalData.topics_to_focus)) {
          evalData.topics_to_focus.forEach((t: string) => {
            conceptMastery[t] = 'Needs Practice';
          });
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Failed to parse dynamic concept mastery:', e);
    }

    const report: IEvaluationReport = {
      id: 'rep_diag_' + Date.now(),
      studentId: student.id,
      worksheetId: 'diagnostic',
      score,
      totalQuestions: questions.length,
      conceptMastery,
      narrative,
      recommendedLevel,
      recommendedSubLevel: subLevel,
      timestamp: new Date().toISOString(),
    };

    // Write to the same physical collection as the existing modular
    // Reports panel reads from (EvaluationReport Mongoose model).
    await EvaluationReport.create(report as any);

    // Logbook write: use the same raw-collection pattern that the bulk
    // diagnostic slice already uses via `diagnosticRepository.appendLogbook`.
    // We inline the one-liner here (instead of importing across modules)
    // so the Student module stays self-contained.
    const logEntry: IDiagnosticLogEntry = {
      id: 'log_' + Date.now(),
      timestamp: new Date().toISOString(),
      schoolId: student.schoolId,
      schoolName: 'GPS',
      userId: actingUser.userId,
      userEmail: actingUser.email,
      userRole: actingUser.role,
      activityType: 'scan',
      status: 'Success',
      details: `Submitted and scored diagnostic for ${student.name}. Placed at Level ${recommendedLevel}`,
    };
    const mongoConn = mongoose.connection;
    if (mongoConn && mongoConn.db) {
      await mongoConn.db.collection('logbook').insertOne(logEntry);
    }

    return {
      student: updatedStudent ?? student,
      evaluation: { score, recommendedLevel, narrative },
      report,
    };
  }

  // ------------------------------------------------------------------
  //  Diagnostic helpers (private)
  // ------------------------------------------------------------------

  /**
   * Parse the integer class number out of `"Class 2"`-style strings.
   * Identical to legacy `index.ts:500-501`.
   */
  private parseClassNumber(classGroup: string): number {
    const match = (classGroup || '').match(/\d+/);
    return match ? parseInt(match[0], 10) : 1;
  }

  /**
   * Resolve the on-disk backend root. Legacy `index.ts:16` used
   * `ROOT_DIR = path.resolve(__dirname, '..')` because that file lives
   * in `src/`; this service is reached either as `src/services/...ts`
   * (tsx/dev) or `dist/services/...js` (compiled CJS). Either way, two
   * `..` hops land on `backend/`, the same place as legacy.
   *
   * Mirrors the dual-path pattern that `paperGenerator.ts:11-13` uses
   * for the same purpose — `import.meta.url` for ESM, `__dirname` for
   * compiled CJS. The package is `"type": "module"` so ESM is the
   * primary; CJS is only used after esbuild compiles the bundle.
   */
  private backendRoot(): string {
    // ESM path (dev/tsx keeps `import.meta.url` populated). Works
    // because the package is `"type": "module"`. Try first since it's
    // the most reliable — dev mode is what runs the actual diagnostic
    // endpoint on this branch.
    try {
      // Guard: `import.meta.url` may be empty when esbuild compiles this
      // file to CJS (the build emits an "empty-import-meta" warning).
      // Skip the call in that case and fall through to the CJS branch.
      const metaUrl = import.meta.url as unknown;
      if (typeof metaUrl === 'string' && metaUrl.length > 0) {
        const here = fileURLToPath(metaUrl);
        return path.resolve(path.dirname(here), '..', '..');
      }
    } catch {
      // Fall through.
    }
    // CJS fallback. `__dirname` is provided by the CJS runtime for
    // every module; `process.cwd()` lands on `backend/` for both
    // `npm run dev` and `npm run start`.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const here = (globalThis as any).__dirname as string | undefined;
      if (here) return path.resolve(here, '..', '..');
    } catch {
      // ignore
    }
    return path.resolve(process.cwd());
  }
}