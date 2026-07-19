import apiClient from './api';
import { EvaluationReport } from '../types';

/**
 * Parameters accepted by `list()`. All optional; an empty object fetches
 * every report the caller is allowed to see (role-scoped server-side).
 */
export interface ListReportsParams {
  studentId?: string;
  classGroup?: string;
  section?: string;
}

/**
 * Thin service wrapper around `GET /api/evaluation-reports`.
 *
 * Mirrors the response-unwrapping pattern used by `studentService.ts`:
 * the Reports controller may return either a bare JSON array or an
 * envelope `{ success: true, data: EvaluationReport[] }`; both shapes
 * land on the same `EvaluationReport[]` the UI renders.
 */
function unwrap<T>(payload: any): T {
  if (payload && Array.isArray(payload.data)) return payload.data as T;
  return payload as T;
}

export const evaluationReportService = {
  async list(params: ListReportsParams = {}): Promise<EvaluationReport[]> {
    const search = new URLSearchParams();
    if (params.studentId) search.set('studentId', params.studentId);
    if (params.classGroup) search.set('classGroup', params.classGroup);
    if (params.section) search.set('section', params.section);
    const qs = search.toString();
    // The shared axios instance already has `baseURL: '/api'` (see
    // services/api.ts), so we must NOT prepend '/api' here — doing so
    // produces '/api/api/evaluation-reports' which 404s. The path is
    // resolved against baseURL, so a leading '/' here is fine.
    const path = qs ? `/evaluation-reports?${qs}` : '/evaluation-reports';
    const res = await apiClient.get(path);
    return unwrap<EvaluationReport[]>(res.data);
  },
};