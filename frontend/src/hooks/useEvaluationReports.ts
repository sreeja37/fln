import { useQuery } from '@tanstack/react-query';
import { evaluationReportService, ListReportsParams } from '../services/evaluationReportService';

/**
 * React Query hook for the EvaluationReports list.
 *
 * Mirrors the `useStudents` cache pattern:
 *   - queryKey: ['evaluation-reports', filters] — reuses the cache when
 *     the same filter set is requested from another panel.
 *   - enabled: only fetch when the hook is actually mounted (the parent
 *     only mounts the Reports panel when `panel === 'reports'`).
 *   - staleTime: 30s — the legacy mock data was static; live data has
 *     a bit more churn (new diagnostics → new reports) but the UI
 *     remains usable on stale data within a session.
 *   - retry: 1 — transient backend hiccups recover on the user trying
 *     the filter again; no aggressive retry loop.
 */
export function useEvaluationReports(filters: ListReportsParams = {}) {
  return useQuery({
    queryKey: ['evaluation-reports', filters],
    queryFn: () => evaluationReportService.list(filters),
    enabled: true,
    staleTime: 30_000,
    retry: 1,
  });
}