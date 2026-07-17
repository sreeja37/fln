import { Document } from 'mongoose';

export interface IClass {
  id: string;
  schoolId: string;
  className: string;
  section: string;
  teacherId: string;
}

// Mongoose's `Document` already declares an `id` getter (typed as `any`).
// Our seeded business `id` (plain string) collides with it. Use Omit to
// re-declare it cleanly. We do not call .save() / .populate() anywhere on
// these documents — the repository only does .find().exec() — so the lean
// shape is safe.
export type IClassDocument = Omit<Document<unknown, Record<string, unknown>, IClass>, 'id'> & IClass;