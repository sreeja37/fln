import { Schema, model } from 'mongoose';
import {
  IEvaluationReport,
  IEvaluationReportDocument,
  ConceptMastery,
} from '../interfaces/evaluation-report.interface';

/**
 * Mongoose schema for the `evaluationReports` collection.
 *
 * The collection is seeded by the legacy diagnostic pipeline
 * (`index.ts:765` writes via `dbStore.addEvaluationReport`) and consumed
 * by the new modular Reports panel. Same schema is used by both paths
 * so anything written by one can be read by the other.
 *
 * Only fields that are indexed/queried are marked unique/indexed:
 *   - id (unique business id)
 *   - studentId (indexed for per-student history)
 *   - timestamp (indexed for newest-first ordering)
 *
 * Mastery enum is a literal `'Strong' | 'Satisfactory' | 'Needs Practice'`.
 * Unknown values are allowed through (the legacy pipeline writes the same
 * string set; the frontend falls back to a neutral color if it sees
 * something new).
 */
const conceptMasterySchema = new Schema<{ [topic: string]: ConceptMastery }>(
  {
    type: Map,
    of: String,
    default: {},
  },
  { _id: false }
);

const evaluationReportSchema = new Schema<IEvaluationReportDocument>(
  {
    id: { type: String, required: true, unique: true, trim: true },
    studentId: { type: String, required: true, trim: true, index: true },
    worksheetId: { type: String, required: true, trim: true },
    score: { type: Number, required: true, min: 0 },
    totalQuestions: { type: Number, required: true, min: 0 },
    conceptMastery: { type: conceptMasterySchema, default: {} },
    narrative: { type: String, default: '' },
    recommendedLevel: { type: Number, required: true, min: 0 },
    recommendedSubLevel: { type: Number, required: false, min: 0 },
    timestamp: { type: String, required: true, index: true },
  },
  {
    // Strict off keeps the seeders / legacy writers (which may add
    // extra fields in the future) from throwing on unknown keys.
    strict: false,
    timestamps: false,
    versionKey: false,
  }
);

/**
 * Mongoose model. Same shape across both reads (modular GET endpoint)
 * and writes (legacy `dbStore.addEvaluationReport`) — they share the
 * same physical collection.
 */
export const EvaluationReport = model<IEvaluationReportDocument>(
  'EvaluationReport',
  evaluationReportSchema,
  'evaluationReports'
);