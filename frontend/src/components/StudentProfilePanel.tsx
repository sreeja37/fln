import React, { useEffect, useState } from 'react';
import { UserCheck } from 'lucide-react';
import type { ClassGroup, Student } from '../types';
import { TeacherClassSelector } from './TeacherClassSelector';

interface StudentProfilePanelProps {
  classes: ClassGroup[];
  activeClass: ClassGroup | null;
  students: Student[];
  teacherClassId: string;
  onTeacherClassIdChange: (id: string) => void;
  token: string;
  onStudentUpdated: (student: Student) => void;
}

type StudentProfileForm = {
  fullName: string;
  age: string;
  gender: Student['gender'];
  currentLevel: string;
  currentSubLevel: string;
  targetLevel: string;
  fatherName: string;
  motherName: string;
  guardianName: string;
  phone: string;
  village: string;
  mandalBlock: string;
  district: string;
  state: string;
  pinCode: string;
};

const toForm = (student: Student): StudentProfileForm => ({
  fullName: student.name,
  age: String(student.age ?? ''),
  gender: student.gender ?? '',
  currentLevel: String(student.currentLevel ?? ''),
  currentSubLevel: String(student.currentSubLevel ?? 0),
  targetLevel: String(student.targetLevel ?? ''),
  fatherName: student.fatherName ?? '',
  motherName: student.motherName ?? '',
  guardianName: student.guardianName ?? '',
  phone: student.phone ?? '',
  village: student.village ?? '',
  mandalBlock: student.address ?? '',
  district: student.district ?? '',
  state: student.state ?? '',
  pinCode: student.pinCode ?? '',
});

function PageHeader({ title, desc, icon }: { title: string; desc: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
      {icon && <div className="text-slate-500">{icon}</div>}
      <div>
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500">{desc}</p>
      </div>
    </div>
  );
}

export const StudentProfilePanel: React.FC<StudentProfilePanelProps> = ({
  classes,
  activeClass,
  students,
  teacherClassId,
  onTeacherClassIdChange,
  token,
  onStudentUpdated,
}) => {
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<StudentProfileForm | null>(null);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const selectedStudent = students.find(student => student.id === selectedStudentId) ?? null;

  useEffect(() => {
    setSelectedStudentId('');
    setIsEditing(false);
    setForm(null);
    setStatus(null);
  }, [teacherClassId]);

  useEffect(() => {
    setForm(selectedStudent ? toForm(selectedStudent) : null);
  }, [selectedStudent]);

  const updateField = (field: keyof StudentProfileForm, value: string) => {
    setForm(prev => prev ? { ...prev, [field]: value } : prev);
  };

  const handleCancel = () => {
    setForm(selectedStudent ? toForm(selectedStudent) : null);
    setIsEditing(false);
    setStatus(null);
  };

  const handleSave = async () => {
    if (!selectedStudent || !form) return;
    setStatus(null);
    try {
      const res = await fetch(`/api/students/${selectedStudent.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          fullName: form.fullName,
          age: form.age,
          gender: form.gender,
          currentLevel: form.currentLevel,
          currentSubLevel: form.currentSubLevel,
          targetLevel: form.targetLevel,
          fatherName: form.fatherName,
          motherName: form.motherName,
          guardianName: form.guardianName,
          phone: form.phone,
          village: form.village,
          address: form.mandalBlock,
          district: form.district,
          state: form.state,
          pinCode: form.pinCode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ type: 'error', message: data.error || 'Failed to save student profile.' });
        return;
      }
      onStudentUpdated(data);
      setIsEditing(false);
      setStatus({ type: 'success', message: 'Student profile saved.' });
    } catch {
      setStatus({ type: 'error', message: 'Network error saving student profile.' });
    }
  };

  const Field = ({ label, field, type = 'text', readOnlyValue }: { label: string; field: keyof StudentProfileForm; type?: string; readOnlyValue?: string }) => (
    <div>
      <label className="block text-[10px] font-mono font-bold uppercase text-slate-400 mb-1">{label}</label>
      {isEditing && readOnlyValue === undefined ? (
        field === 'gender' ? (
          <select
            value={form?.gender ?? ''}
            onChange={(e) => updateField('gender', e.target.value)}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-slate-500 bg-white"
          >
            <option value="">Not set</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
          </select>
        ) : (
          <input
            type={type}
            value={form?.[field] ?? ''}
            onChange={(e) => updateField(field, e.target.value)}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-slate-500 bg-white"
          />
        )
      ) : (
        <div className="min-h-[38px] rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800">
          {readOnlyValue || form?.[field] || 'N/A'}
        </div>
      )}
    </div>
  );

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-5">
      <PageHeader
        title="Student Profile"
        desc={activeClass ? `${activeClass.className}${activeClass.section ? ` - ${activeClass.section}` : ''}` : 'Select a grade and student to view profile.'}
        icon={<UserCheck className="h-5 w-5" />}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(240px,320px)] gap-4">
        <TeacherClassSelector
          classes={classes}
          value={teacherClassId}
          onChange={onTeacherClassIdChange}
          label="Active Grade"
        />
        <div>
          <label htmlFor="student-profile-selector" className="block text-xs font-mono font-bold uppercase text-slate-500 mb-2">
            Student
          </label>
          <select
            id="student-profile-selector"
            value={selectedStudentId}
            onChange={(e) => {
              setSelectedStudentId(e.target.value);
              setIsEditing(false);
              setStatus(null);
            }}
            disabled={!activeClass || students.length === 0}
            className="w-full appearance-none bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium text-slate-800 focus:outline-none focus:border-slate-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">{students.length === 0 ? 'No students in this grade' : 'Select student...'}</option>
            {students.map(student => (
              <option key={student.id} value={student.id}>{student.name}</option>
            ))}
          </select>
        </div>
      </div>

      {!selectedStudent || !form ? (
        <div className="p-8 text-center text-slate-500 font-medium text-sm border border-slate-200 rounded-lg bg-slate-50">
          Select a student to view profile.
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900">{selectedStudent.name}</h3>
              <p className="text-xs text-slate-500 font-mono">ID: {selectedStudent.id} | {selectedStudent.classGroup} - {selectedStudent.section}</p>
            </div>
            <div className="flex gap-2">
              {isEditing ? (
                <>
                  <button type="button" onClick={handleSave} className="bg-slate-900 text-white text-xs font-mono font-bold px-4 py-2 rounded-lg hover:bg-slate-800">Save</button>
                  <button type="button" onClick={handleCancel} className="bg-white border border-slate-200 text-slate-700 text-xs font-mono font-bold px-4 py-2 rounded-lg hover:bg-slate-50">Cancel</button>
                </>
              ) : (
                <button type="button" onClick={() => setIsEditing(true)} className="bg-slate-900 text-white text-xs font-mono font-bold px-4 py-2 rounded-lg hover:bg-slate-800">Edit</button>
              )}
            </div>
          </div>

          {status && (
            <div className={`p-3 rounded-lg border text-xs font-medium ${status.type === 'success' ? 'bg-green-50 text-green-700 border-green-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
              {status.message}
            </div>
          )}

          <section className="space-y-3">
            <h4 className="text-xs font-mono font-bold uppercase text-slate-500">Academic Information</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <Field label="Name" field="fullName" />
              <Field label="Grade" field="fullName" readOnlyValue={selectedStudent.classGroup} />
              <Field label="Section" field="fullName" readOnlyValue={selectedStudent.section || 'N/A'} />
              <Field label="Roll Number" field="fullName" readOnlyValue={selectedStudent.id} />
              <Field label="Age" field="age" type="number" />
              <Field label="Gender" field="gender" />
              <Field label="Current Level" field="currentLevel" type="number" />
              <Field label="Current Sub Level" field="currentSubLevel" type="number" />
              <Field label="Target Level" field="targetLevel" type="number" />
              <Field label="Aadhar (masked)" field="fullName" readOnlyValue={selectedStudent.aadharMasked} />
            </div>
          </section>

          <section className="space-y-3">
            <h4 className="text-xs font-mono font-bold uppercase text-slate-500">Family Information</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <Field label="Father Name" field="fatherName" />
              <Field label="Mother Name" field="motherName" />
              <Field label="Guardian Name" field="guardianName" />
              <Field label="Parent Mobile" field="phone" />
            </div>
          </section>

          <section className="space-y-3">
            <h4 className="text-xs font-mono font-bold uppercase text-slate-500">Address</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
              <Field label="Village" field="village" />
              <Field label="Mandal / Block" field="mandalBlock" />
              <Field label="District" field="district" />
              <Field label="State" field="state" />
              <Field label="PIN Code" field="pinCode" />
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
