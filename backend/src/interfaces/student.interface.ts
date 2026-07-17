import { Document } from 'mongoose';

/**
 * Student business shape. Mirrors the seeded `students` collection exactly.
 *
 * Notes:
 * - All IDs are plain strings (no ObjectId relationships). The seeded
 *   collection uses business IDs: `id` is the student ID, `schoolId` is the
 *   school business code, `teacherId` is the teacher business ID.
 * - `aadharMasked` stores the raw digits server-side so Superadmin sees the
 *   full value; masking is applied at the controller response edge for
 *   non-Superadmin roles (per legacy §13.2 R-6).
 * - `classGroup` is the human-readable label ("Class 2" | "Class 3" |
 *   "Class 4"), not a numeric index — same convention as `IClass.className`.
 * - `currentLevel` / `targetLevel` are integers (1..59); `currentSubLevel`
 *   is optional because seeded docs may have it undefined.
 * - `levelHistory` is a heterogeneous array of placement/diagnostic events.
 */
export interface IStudent {
  id: string;
  name: string;
  age: number;
  classGroup: string; // e.g. "Class 2", "Class 3", "Class 4"
  section: string; // e.g. "A", "B"
  schoolId: string;
  teacherId?: string;
  currentLevel: number;
  currentSubLevel?: number;
  targetLevel: number;
  aadharMasked: string;
  levelHistory: { level: number; subLevel?: number; date: string; reason: string }[];
  streak: number;
}

// Mongoose's `Document` already declares an `id` getter (typed as `any`).
// Our seeded business `id` (plain string) collides with it. Use Omit to
// re-declare it cleanly. The repository uses `.find()` / `.insertOne`-style
// flows — it never calls `.save()` on these documents — so the lean shape
// is safe (same convention as `IClassDocument`).
export type IStudentDocument = Omit<Document<unknown, Record<string, unknown>, IStudent>, 'id'> & IStudent;