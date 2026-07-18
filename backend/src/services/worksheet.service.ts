import { randomUUID } from 'crypto';
import * as levelsBackendClient from '../levelsBackendClient';
import { worksheetRepository } from '../repositories/worksheet.repository';
import { IStudent } from '../interfaces/student.interface';
import { LevelWorksheet } from '../db';

/**
 * Service for the Worksheet slice — Level-Wise surface only.
 *
 * Faithful port of the legacy `index.ts` handlers + helper:
 *
 *   POST /api/worksheets/generate-level-batch   -> generateLevelBatch()
 *   POST /api/worksheets/generate-level-pdf     -> generateLevelPdf()
 *   GET  /api/worksheets/download-batch/:batchId -> downloadBatchZip()
 *
 * Plus the private `generateLevelWorksheetsViaLevelsBackend` helper
 * (lines 997-1093 of `index.ts`) that the two POST handlers share.
 *
 * The pipeline is unchanged:
 *   1. Build a roster from placed students (currentLevel != null).
 *   2. POST /api/generate-batch to Levels_backend -> get batchId.
 *   3. Poll /api/batch-status until completed.
 *   4. GET /api/download-batch/<batchId> -> raw ZIP.
 *   5. Unpack via JSZip, group by student folder x sublevel x set.
 *   6. Persist each rendered PDF + sidecar JSONs to local /output.
 *   7. Insert a LevelWorksheet record into the `levelWorksheets` Mongo
 *      collection, mapped back to the original Student via the
 *      manifest's `rollNumber` field (which we deliberately set to the
 *      student's stable internal id).
 *
 * The single-student path (`generate-level-pdf`) additionally has a
 * deterministic Puppeteer fallback (`paperGenerator.generateLevelWorksheet`)
 * if Levels_backend is unreachable — preserved exactly.
 *
 * Error mapping (kept identical to legacy `index.ts`):
 *   401 — no authenticated user  (handled by authenticate middleware)
 *   400 — invalid input or no eligible students
 *   404 — student not found
 *   500 — unexpected internal error
 *   502 — Levels_backend zip download failed
 *
 * Domain errors are thrown here and mapped to status codes by the
 * controller. No HTTP concepts leak into this layer.
 */

export class WorksheetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorksheetValidationError';
  }
}

export class WorksheetNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorksheetNotFoundError';
  }
}

export class UpstreamServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamServiceError';
  }
}

/**
 * Shape returned to the frontend for the batch POST.
 * Mirrors `index.ts:1189-1197` exactly:
 *   { success, batchId, studentsProcessed, totalFiles, results, skipped }
 */
export interface BatchResultEntry {
  studentId: string;
  studentName: string;
  sublevelId: string;
  setNum: number;
  pdfUrl: string;
}

export interface SkippedEntry {
  studentId: string;
  reason: string;
}

export interface BatchOutcome {
  success: true;
  batchId: string | null;
  studentsProcessed: number;
  totalFiles: number;
  results: BatchResultEntry[];
  skipped: SkippedEntry[];
}

/**
 * Shape returned to the frontend for the single-student POST.
 * Mirrors `index.ts:1135` / `1133`:
 *   { success: true, pdfUrl }   OR   { success: true, pdfUrl, fallback: true }
 */
export interface SinglePdfOutcome {
  success: true;
  pdfUrl: string;
  fallback?: boolean;
}

export class WorksheetService {
  // --- Validation ---

  /** Throws WorksheetValidationError when the input is unusable. */
  validateBatchInput(studentIds: unknown): string[] {
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      throw new WorksheetValidationError('studentIds must be a non-empty array.');
    }
    return studentIds.map(String);
  }

  validateSingleInput(studentId: unknown): string {
    if (!studentId || typeof studentId !== 'string') {
      throw new WorksheetValidationError('studentId is required.');
    }
    return studentId;
  }

  // --- Filter placed students ---

  /**
   * Split the requested IDs into (a) eligible Students with
   * `currentLevel != null` and (b) a list of `SkippedEntry` records for
   * each missing/unplaced id. Mirrors `index.ts:1162-1175`.
   *
   * Public so the controller can re-derive `skipped` for the
   * "no eligible students" 400 path, which the legacy wire format
   * embeds in the response body.
   */
  async partitionTargets(studentIds: string[]): Promise<{
    targets: IStudent[];
    skipped: SkippedEntry[];
  }> {
    const students = await worksheetRepository.findStudentsByIds(studentIds);
    const byId = new Map(students.map((s) => [s.id, s]));
    const targets: IStudent[] = [];
    const skipped: SkippedEntry[] = [];

    for (const id of studentIds) {
      const student = byId.get(id);
      if (!student) {
        skipped.push({ studentId: id, reason: 'Student not found.' });
        continue;
      }
      if (student.currentLevel == null) {
        skipped.push({
          studentId: id,
          reason: 'Student has not completed their diagnostic test.',
        });
        continue;
      }
      targets.push(student);
    }
    return { targets, skipped };
  }

  // --- Shared pipeline (faithful port of generateLevelWorksheetsViaLevelsBackend) ---

  /**
   * Internal pipeline. Returns a per-file result entry that the
   * controller maps to the wire shape. Throws UpstreamServiceError if
   * Levels_backend or local IO fails.
   */
  private async generateLevelWorksheetsViaLevelsBackend(
    students: IStudent[]
  ): Promise<
    Array<{
      studentId: string;
      studentName: string;
      batchId: string;
      sublevelId: string;
      setNum: number;
      pdfUrl: string;
    }>
  > {
    const roster: levelsBackendClient.RosterEntry[] = students.map((s) => ({
      studentName: s.name,
      rollNumber: s.id,
      levelId: s.currentLevel,
      sublevelId:
        s.currentSubLevel != null ? `${s.currentLevel}.${s.currentSubLevel}` : 'all',
      setsPerSub: 1,
      studentData: {
        age: s.age,
        classGroup: s.classGroup,
        section: s.section,
        schoolId: s.schoolId,
        currentLevel: s.currentLevel,
        currentSubLevel: s.currentSubLevel,
        targetLevel: s.targetLevel,
        streak: s.streak,
      },
    }));

    const batchResult = await levelsBackendClient.generateBatch(roster);
    await levelsBackendClient.waitForBatch(batchResult.batchId);
    const zipBuffer = await levelsBackendClient.downloadBatchZip(batchResult.batchId);
    const { manifest, files } = await levelsBackendClient.extractBatchZip(zipBuffer);

    // groupKey ("<studentFolder>/<sublevelId>_set<n>") -> original rollNumber (== studentId)
    const rollNumberByGroupKey = new Map<string, string>();
    if (manifest && Array.isArray(manifest.students)) {
      for (const ms of manifest.students) {
        if (!Array.isArray(ms.files)) continue;
        for (const f of ms.files) {
          rollNumberByGroupKey.set(f.folder, ms.rollNumber);
        }
      }
    }

    const studentsById = new Map(students.map((s) => [s.id, s]));

    const out: Array<{
      studentId: string;
      studentName: string;
      batchId: string;
      sublevelId: string;
      setNum: number;
      pdfUrl: string;
    }> = [];

    for (const file of files) {
      const groupKey = `${file.studentFolder}/${file.sublevelId}_set${file.setNum}`;
      const studentId = rollNumberByGroupKey.get(groupKey);
      const student = studentId ? studentsById.get(studentId) : undefined;
      if (!student) {
        // eslint-disable-next-line no-console
        console.warn(`[levels-backend] Could not map rendered file back to a student: ${groupKey}`);
        continue;
      }

      const { pdfUrl } = await worksheetRepository.saveRenderedFile({
        student,
        sublevelId: file.sublevelId,
        setNum: file.setNum,
        pdfBuffer: file.pdfBuffer,
        answerKey: file.answerKey,
        coords: file.coords,
        questionPaper: file.questionPaper,
      });

      const record: LevelWorksheet = {
        id: 'LW_' + randomUUID(),
        batchId: batchResult.batchId,
        studentId: student.id,
        studentName: student.name,
        rollNumber: student.id,
        levelId: student.currentLevel,
        sublevelId: file.sublevelId,
        setNum: file.setNum,
        pdfUrl,
        answerKey: file.answerKey,
        coords: file.coords,
        generatedAt: new Date().toISOString(),
      };
      await worksheetRepository.addLevelWorksheet(record);

      out.push({
        studentId: student.id,
        studentName: student.name,
        batchId: batchResult.batchId,
        sublevelId: file.sublevelId,
        setNum: file.setNum,
        pdfUrl,
      });
    }

    return out;
  }

  // --- Batch (POST /api/worksheets/generate-level-batch) ---

  async generateLevelBatch(studentIds: unknown): Promise<BatchOutcome> {
    const ids = this.validateBatchInput(studentIds);
    const { targets, skipped } = await this.partitionTargets(ids);

    if (targets.length === 0) {
      throw new WorksheetValidationError(
        'No eligible (placed) students in this request.'
      );
    }

    const generated = await this.generateLevelWorksheetsViaLevelsBackend(targets);

    const results: BatchResultEntry[] = generated.map((g) => ({
      studentId: g.studentId,
      studentName: g.studentName,
      sublevelId: g.sublevelId,
      setNum: g.setNum,
      pdfUrl: g.pdfUrl,
    }));

    return {
      success: true,
      batchId: generated[0]?.batchId ?? null,
      studentsProcessed: targets.length,
      totalFiles: generated.length,
      results,
      skipped,
    };
  }

  // --- Single (POST /api/worksheets/generate-level-pdf) ---

  /**
   * Single-student path with deterministic Puppeteer fallback. Mirrors
   * `index.ts:1102-1146` exactly, including the `fallback: true` flag
   * when the local generator is used.
   */
  async generateLevelPdf(studentId: unknown): Promise<SinglePdfOutcome> {
    const id = this.validateSingleInput(studentId);
    const students = await worksheetRepository.findStudentsByIds([id]);
    const student = students[0];
    if (!student) {
      throw new WorksheetNotFoundError('Student not found.');
    }
    if (student.currentLevel == null) {
      throw new WorksheetValidationError(
        'Student has not completed their diagnostic test.'
      );
    }

    try {
      const generated = await this.generateLevelWorksheetsViaLevelsBackend([student]);
      if (generated.length === 0) {
        throw new Error('Levels_backend returned no files for this student.');
      }
      return { success: true, pdfUrl: generated[0].pdfUrl };
    } catch (levelsBackendErr) {
      const message =
        levelsBackendErr instanceof Error
          ? levelsBackendErr.message
          : 'Unknown Levels_backend error.';
      // eslint-disable-next-line no-console
      console.error(
        'Levels_backend generation failed, falling back to local generator:',
        message
      );
      // Deterministic fallback: the in-process Puppeteer generator.
      // Same import as legacy `index.ts:1130` (dynamic import — preserved).
      const { generateLevelWorksheet } = await import('../paperGenerator');
      const result = await generateLevelWorksheet({
        studentId: student.id,
        studentName: student.name,
        levelId: student.currentLevel,
        subIdx: student.currentSubLevel || 0,
      });
      return { success: true, pdfUrl: result.pdfUrl, fallback: true };
    }
  }

  // --- ZIP download (GET /api/worksheets/download-batch/:batchId) ---

  /**
   * Streams the raw batch ZIP straight from Levels_backend, with the
   * legacy Content-Type / Content-Disposition headers preserved. Any
   * upstream Levels_backend failure is re-thrown as
   * `UpstreamServiceError` so the controller maps it to HTTP 502
   * (mirroring `index.ts:1215`).
   */
  async downloadBatchZip(batchId: string): Promise<{
    buffer: Buffer;
    downloadName: string;
  }> {
    let buffer: Buffer;
    try {
      buffer = await levelsBackendClient.downloadBatchZip(batchId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown upstream error.';
      // eslint-disable-next-line no-console
      console.error('Batch ZIP download failed:', message);
      throw new UpstreamServiceError(message);
    }
    return { buffer, downloadName: `batch_${batchId}.zip` };
  }
}