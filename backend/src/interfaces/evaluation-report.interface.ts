import { Document } from 'mongoose';

/**
 * EvaluationReport data shape.
 *
 * Mirrors the legacy `index.ts:752-764` constructor for diagnostic
 * evaluations exactly, so reports written by either path land in the
 * same `evaluationReports` collection with the same fields. The Mongoose
 * `Document` wrapper lets the repository return typed lean objects.
 *
 * Fields:
 *   - id              — business id string ('rep_diag_<timestamp>' for
 *                       diagnostic evaluations, or 'rep_lvl_<batch>' for
 *                       level-batch runs). Unique across the collection.
 *   - studentId       — foreign key into `students.id`. Indexed for the
 *                       per-student history query (GET /api/evaluation-reports?studentId=…).
 *   - worksheetId     — id of the source worksheet/assessment that
 *                       generated this report (e.g. 'diagnostic', or a
 *                       worksheet id).
 *   - score           — number of correct answers out of `totalQuestions`.
 *   - totalQuestions  — denominator for the percentage shown in the UI.
 *   - conceptMastery  — map of topic name → mastery level
 *                       ('Strong' | 'Satisfactory' | 'Needs Practice').
 *   - narrative       — free-form text written by the scanner pipeline,
 *                       surfaced verbatim in the Reports list.
 *   - recommendedLevel / recommendedSubLevel — placement guidance from
 *                       the diagnostic, surfaced in the recommended-focus
 *                       card on the Reports list.
 *   - timestamp       — ISO-8601 string. Sorts the per-student history
 *                       newest-first.
 */
export type ConceptMastery = 'Strong' | 'Satisfactory' | 'Needs Practice';

export interface IEvaluationReport {
  id: string;
  studentId: string;
  worksheetId: string;
  score: number;
  totalQuestions: number;
  conceptMastery: { [topic: string]: ConceptMastery };
  narrative: string;
  recommendedLevel: number;
  recommendedSubLevel?: number;
  timestamp: string;
}

export interface IEvaluationReportDocument extends IEvaluationReport, Document {}