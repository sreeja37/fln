import { Schema, model } from 'mongoose';
import { IClassDocument } from '../interfaces/class.interface';

const classSchema = new Schema<IClassDocument>(
  {
    id:        { type: String, trim: true },
    schoolId:  { type: String, trim: true },
    className: { type: String, trim: true },
    section:   { type: String, trim: true },
    teacherId: { type: String, trim: true },
  },
  {
    // Seeded collection has no createdAt/updatedAt. Do not introduce them.
    // Do not declare Mongoose indexes either — the existing collection is read-only here.
    toJSON: {
      transform(_doc, ret) {
        // Seeded `id` is the business ID. Do NOT overwrite it with `_id`.
        // Strip only Mongoose's internal `__v` if present.
        if ('__v' in ret) delete (ret as Record<string, unknown>).__v;
        return ret;
      },
    },
  }
);

// Bind explicitly to the existing seeded collection so Mongoose doesn't try
// to pluralize "Class" → "classes" (it would collide anyway, but be explicit).
classSchema.set('collection', 'classes');

export const Class = model<IClassDocument>('Class', classSchema);
