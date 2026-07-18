import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { Student } from '../models/student.model';
import { IStudent } from '../interfaces/student.interface';
import { LevelWorksheet } from '../db';

/**
 * Repository for the worksheet slice.
 *
 * Owns three concerns:
 *
 *   1. Student lookup — uses the existing `Student` Mongoose model
 *      (collection: `students`). Same convention as
 *      `repositories/student.repository.ts`.
 *
 *   2. Local filesystem writes — PDFs and sidecar JSONs (answer key,
 *      coords, question paper) under `process.cwd()/output`. The Express
 *      static middleware in `app.ts` mounts this directory at `/output`,
 *      so the resulting `pdfUrl` paths are directly addressable from
 *      the browser (and from the legacy Teacher Dashboard anchor that
 *      already opens `data.pdfUrl` in a new tab).
 *
 *   3. `levelWorksheets` collection writes — uses the raw Mongoose
 *      connection (`mongoose.connection.db.collection`) because there is
 *      no `LevelWorksheet` Mongoose model and the shape comes from
 *      `db.ts`'s `LevelWorksheet` interface (legacy seeded collection
 *      shape). Same pattern used by `admin.repository.ts` and
 *      `diagnostic.repository.ts`.
 */
export class WorksheetRepository {
  /**
   * Resolve a set of student IDs into lean Student documents. Missing
   * IDs are simply absent from the returned array — the caller is
   * responsible for surfacing a "skipped" record per missing id.
   *
   * Returns plain JS objects (`.lean()`) — same convention as
   * `StudentRepository.findAll`. The service layer consumes the
   * `currentLevel` / `currentSubLevel` / `id` / `name` fields, so the
   * full IStudent shape is preserved.
   */
  async findStudentsByIds(studentIds: string[]): Promise<IStudent[]> {
    if (!studentIds || studentIds.length === 0) return [];
    const docs = await Student.find({ id: { $in: studentIds } })
      .lean()
      .exec();
    return docs as unknown as IStudent[];
  }

  /**
   * Returns the absolute path of the local output directory (creating it
   * if necessary). Mirrors the legacy `path.join(ROOT_DIR, 'output')` +
   * `fs.mkdirSync(..., { recursive: true })` bootstrap from `index.ts`.
   * Uses `process.cwd()` to stay consistent with `app.ts`'s static
   * middleware (`path.join(process.cwd(), "output")`).
   */
  ensureOutputDir(): string {
    const outputDir = path.join(process.cwd(), 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    return outputDir;
  }

  /**
   * Persist a single rendered worksheet's PDF (and optional sidecar
   * JSONs) to disk and return the public URL path
   * (`/output/<fileName>`). The static middleware in `app.ts` serves
   * these files directly, so the returned URL is wire-ready.
   */
  async saveRenderedFile(input: {
    student: IStudent;
    sublevelId: string;
    setNum: number;
    pdfBuffer: Buffer;
    answerKey?: unknown;
    coords?: unknown;
    questionPaper?: unknown;
  }): Promise<{ fileName: string; filePath: string; pdfUrl: string }> {
    const { student, sublevelId, setNum, pdfBuffer } = input;
    const outputDir = this.ensureOutputDir();

    const fileName = `level_${student.currentLevel}_${sublevelId}_set${setNum}_${student.id}_${randomUUID()}.pdf`;
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, pdfBuffer);

    const baseName = fileName.replace(/\.pdf$/, '');
    if (input.answerKey !== undefined) {
      fs.writeFileSync(
        path.join(outputDir, `${baseName}_answer_key.json`),
        JSON.stringify(input.answerKey, null, 2)
      );
    }
    if (input.coords !== undefined) {
      fs.writeFileSync(
        path.join(outputDir, `${baseName}_coords.json`),
        JSON.stringify(input.coords, null, 2)
      );
    }
    if (input.questionPaper !== undefined) {
      fs.writeFileSync(
        path.join(outputDir, `${baseName}_question_paper.json`),
        JSON.stringify(input.questionPaper, null, 2)
      );
    }

    return { fileName, filePath, pdfUrl: `/output/${fileName}` };
  }

  /**
   * Insert a `LevelWorksheet` document. Mirrors
   * `dbStore.addLevelWorksheet(record)` from legacy `index.ts:1083` —
   * the new modular backend does not use `dbStore` (its `mongoDb` field
   * is null under `server.ts` because `dbStore.init()` is never called),
   * so we write to the same underlying collection via Mongoose's live
   * connection.
   */
  async addLevelWorksheet(record: LevelWorksheet): Promise<void> {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('MongoDB connection is not available.');
    }
    await db.collection('levelWorksheets').insertOne(record);
  }
}

export const worksheetRepository = new WorksheetRepository();