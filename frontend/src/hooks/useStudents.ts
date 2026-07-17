import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchStudents, createStudent, CreateStudentPayload } from '../services/studentService';
import { Student } from '../types';

/**
 * Single source of truth for the students collection.
 *
 * Reuses the project's existing TanStack Query architecture
 * (see hooks/useCoordinator.ts + main.tsx QueryClientProvider).
 *
 * The bearer token is injected automatically by the axios interceptor in
 * services/api.ts — no need to thread `token` through this hook.
 *
 * Both TeacherDashboard and PanelViews call this hook with the same
 * queryKey `['students']`, so React Query returns a single cached array
 * to both. `useCreateStudent` invalidates `['students']` on success, so
 * every consumer re-renders with the freshly registered student.
 */
export function useStudents() {
  return useQuery<Student[]>({
    queryKey: ['students'],
    queryFn: fetchStudents,
    staleTime: 30 * 1000,
  });
}

export function useCreateStudent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateStudentPayload) => createStudent(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] });
    },
  });
}

/**
 * Manual refresh of the students query cache.
 * Used by workflows (diagnostic, baseline, bulk, ICR, worksheet) that mutate
 * student state on the server side and need the roster to re-render without
 * a full reload.
 */
export function useRefreshStudents() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['students'] });
}
