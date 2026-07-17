import api from './api';
import { Student } from '../types';

/**
 * Backend response shape (mirrors coordinatorService.ts pattern):
 *   { success: true, data: Student[] }   → unwrapped to Student[]
 *   Student[]                            → returned as-is
 */
function unwrap<T>(payload: any): T {
  if (payload && Array.isArray(payload.data)) return payload.data as T;
  return payload as T;
}

export interface CreateStudentPayload {
  name: string;
  age: number;
  classGroup: string;
  section: string;
  schoolId: string;
  aadharNumber?: string;
}

export async function fetchStudents(): Promise<Student[]> {
  const res = await api.get('/students');
  return unwrap<Student[]>(res.data);
}

export async function createStudent(payload: CreateStudentPayload): Promise<Student> {
  const res = await api.post('/students', payload);
  return unwrap<Student>(res.data);
}
