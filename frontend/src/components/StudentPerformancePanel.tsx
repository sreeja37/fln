import React, { useEffect, useMemo, useState } from 'react';
import { Award, BarChart3, BookOpen, Calendar, CheckCircle2, FileText, ShieldAlert, Target, TrendingUp } from 'lucide-react';
import type { ClassGroup, EvaluationReport, Student } from '../types';
import { TeacherClassSelector } from './TeacherClassSelector';

interface WorksheetSummary {
  id: string;
  cycle: string;
  class: string;
  date: string;
  questions: number;
  status: string;
  avgScore: string;
}

interface DiagnosticHistoryItem {
  id: string;
  student: string;
  date: string;
  score: number;
  total: number;
  placedLevel: number;
  evaluator: string;
}

interface StudentPerformancePanelProps {
  classes: ClassGroup[];
  activeClass: ClassGroup | null;
  students: Student[];
  teacherClassId: string;
  onTeacherClassIdChange: (id: string) => void;
  reports: EvaluationReport[];
  worksheets: WorksheetSummary[];
  diagnosticHistory: DiagnosticHistoryItem[];
}

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

const formatLevel = (level: number, subLevel?: number) => `L${level}.${subLevel ?? 0}`;

export const StudentPerformancePanel: React.FC<StudentPerformancePanelProps> = ({
  classes,
  activeClass,
  students,
  teacherClassId,
  onTeacherClassIdChange,
  reports,
  worksheets,
  diagnosticHistory,
}) => {
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const selectedStudent = students.find(student => student.id === selectedStudentId) ?? null;

  useEffect(() => {
    setSelectedStudentId('');
  }, [teacherClassId]);

  const classMetrics = useMemo(() => {
    const totalStudents = students.length;
    const avgLevel = totalStudents > 0
      ? `L${Math.round(students.reduce((sum, student) => sum + student.currentLevel, 0) / totalStudents)}`
      : 'Not Available';
    const certified = students.filter(student => student.currentLevel >= 5).length;
    const pendingDiagnostic = students.filter(student => student.levelHistory.length === 0).length;
    const topStudents = [...students].sort((a, b) => b.currentLevel - a.currentLevel).slice(0, 5);

    return { totalStudents, avgLevel, certified, pendingDiagnostic, topStudents };
  }, [students]);

  const performance = useMemo(() => {
    if (!selectedStudent) return null;

    const studentReports = reports
      .filter(report => report.studentId === selectedStudent.id)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const latestReport = studentReports[0];
    const diagnostic = diagnosticHistory.find(item => item.student === selectedStudent.name);
    const studentWorksheetHistory = studentReports.map(report => {
      const worksheet = worksheets.find(item => item.id === report.worksheetId);
      return {
        id: report.worksheetId,
        cycle: worksheet?.cycle || 'Worksheet',
        date: report.timestamp,
        questions: report.totalQuestions,
        status: 'Evaluated',
        score: `${report.score}/${report.totalQuestions}`,
        accuracy: `${Math.round((report.score / report.totalQuestions) * 100)}%`,
      };
    });
    const completedWorksheets = studentWorksheetHistory;
    const worksheetScores = studentReports.map(report => Math.round((report.score / report.totalQuestions) * 100));

    const worksheetAverage = worksheetScores.length > 0
      ? `${Math.round(worksheetScores.reduce((sum, score) => sum + score, 0) / worksheetScores.length)}%`
        : 'Not Available';
    const diagnosticStatus = selectedStudent.levelHistory.length > 0 ? 'Placed' : 'Pending Diagnostic';
    const missingPlacedDiagnostic = diagnosticStatus === 'Placed' && !diagnostic;
    const diagnosticScore = diagnosticStatus === 'Pending Diagnostic'
      ? 'Not Available'
      : diagnostic
        ? `${diagnostic.score}/${diagnostic.total}`
        : 'Diagnostic record unavailable';
    const diagnosticAccuracy = diagnosticStatus === 'Pending Diagnostic'
      ? 'Not Available'
      : diagnostic
        ? `${Math.round((diagnostic.score / diagnostic.total) * 100)}%`
        : 'Diagnostic record unavailable';
    const testHistory = studentReports.length > 0
      ? studentReports.map(report => ({
        id: report.id,
        title: report.worksheetId,
        date: report.timestamp,
        score: `${report.score}/${report.totalQuestions}`,
        detail: `Recommended ${formatLevel(report.recommendedLevel, report.recommendedSubLevel)}`,
      }))
      : diagnostic
        ? [{ id: diagnostic.id, title: 'Diagnostic', date: diagnostic.date, score: `${diagnostic.score}/${diagnostic.total}`, detail: `Placed L${diagnostic.placedLevel}` }]
        : [];
    const levelProgression = diagnosticStatus === 'Pending Diagnostic'
      ? []
      : diagnostic
        ? [{ level: diagnostic.placedLevel, subLevel: undefined, date: diagnostic.date, reason: 'Diagnostic placement' }]
        : [];

    const masteryEntries = latestReport ? Object.entries(latestReport.conceptMastery) : [];
    const strengths = masteryEntries
      .filter(([, mastery]) => mastery === 'Strong')
      .map(([topic]) => topic);
    const improvements = masteryEntries
      .filter(([, mastery]) => mastery !== 'Strong')
      .map(([topic]) => topic);

    const remarks = latestReport?.narrative
      || 'Not Available';

    return {
      studentWorksheetHistory,
      completedWorksheets,
      worksheetAverage,
      diagnosticScore,
      diagnosticAccuracy,
      diagnosticStatus,
      missingPlacedDiagnostic,
      testHistory,
      levelProgression,
      strengths,
      improvements,
      recommendations: improvements,
      remarks,
    };
  }, [diagnosticHistory, reports, selectedStudent, worksheets]);

  const Metric = ({ title, value, subtext, icon }: { title: string; value: string | number; subtext: string; icon: React.ReactNode }) => (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-mono font-bold uppercase text-slate-400">{title}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{subtext}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-2 text-slate-500 border border-slate-100">{icon}</div>
      </div>
    </div>
  );

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-5">
      <PageHeader
        title="Student Performance"
        desc={activeClass ? `${activeClass.className}${activeClass.section ? ` - ${activeClass.section}` : ''}` : 'Select a grade and student to view performance.'}
        icon={<BarChart3 className="h-5 w-5" />}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(240px,320px)] gap-4">
        <TeacherClassSelector
          classes={classes}
          value={teacherClassId}
          onChange={onTeacherClassIdChange}
          label="Active Grade"
        />
        <div>
          <label htmlFor="student-performance-selector" className="block text-xs font-mono font-bold uppercase text-slate-500 mb-2">
            Student
          </label>
          <select
            id="student-performance-selector"
            value={selectedStudentId}
            onChange={(e) => setSelectedStudentId(e.target.value)}
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Metric title="Total Students" value={classMetrics.totalStudents} subtext={activeClass ? `${activeClass.className} roster` : 'Active roster'} icon={<BookOpen className="h-5 w-5" />} />
        <Metric title="Avg Level" value={classMetrics.avgLevel} subtext="Class average" icon={<BarChart3 className="h-5 w-5" />} />
        <Metric title="Certified" value={classMetrics.certified} subtext="Level 5+ achieved" icon={<Award className="h-5 w-5" />} />
        <Metric title="Pending Diagnostic" value={classMetrics.pendingDiagnostic} subtext="Need placement" icon={<ShieldAlert className="h-5 w-5" />} />
      </div>

      {!selectedStudent || !performance ? (
        <div className="p-8 text-center text-slate-500 font-medium text-sm border border-slate-200 rounded-lg bg-slate-50">
          Select a student
        </div>
      ) : (
        <div className="space-y-5">
          <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-xs font-mono font-bold uppercase text-slate-500 mb-3">Student Summary</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
              <div><span className="block text-[10px] font-mono uppercase text-slate-400">Name</span><strong className="text-slate-900">{selectedStudent.name}</strong></div>
              <div><span className="block text-[10px] font-mono uppercase text-slate-400">Grade</span><strong className="text-slate-900">{selectedStudent.classGroup}</strong></div>
              <div><span className="block text-[10px] font-mono uppercase text-slate-400">Section</span><strong className="text-slate-900">{selectedStudent.section || 'N/A'}</strong></div>
              <div><span className="block text-[10px] font-mono uppercase text-slate-400">Student ID</span><strong className="text-slate-900 font-mono">{selectedStudent.id}</strong></div>
            </div>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <Metric title="Current FLN Level" value={formatLevel(selectedStudent.currentLevel, selectedStudent.currentSubLevel)} subtext="Current FLN placement" icon={<TrendingUp className="h-5 w-5" />} />
            <Metric title="Target Level" value={`L${selectedStudent.targetLevel}`} subtext="Next learning target" icon={<Target className="h-5 w-5" />} />
            <Metric title="Diagnostic Status" value={performance.diagnosticStatus} subtext={performance.diagnosticScore} icon={<CheckCircle2 className="h-5 w-5" />} />
            <Metric title="Worksheets Completed" value={performance.completedWorksheets.length} subtext="Evaluated for this student" icon={<FileText className="h-5 w-5" />} />
            <Metric title="Worksheet Average" value={performance.worksheetAverage} subtext="Evaluated worksheet average" icon={<BookOpen className="h-5 w-5" />} />
            <Metric title="Diagnostic Score" value={performance.diagnosticScore} subtext="Latest diagnostic result" icon={<Award className="h-5 w-5" />} />
            <Metric title="Accuracy %" value={performance.diagnosticAccuracy} subtext="Diagnostic accuracy" icon={<BarChart3 className="h-5 w-5" />} />
          </div>

          <section className="space-y-3">
            <h3 className="text-xs font-mono font-bold uppercase text-slate-500">Worksheet History</h3>
            {performance.studentWorksheetHistory.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                Not Available
              </div>
            ) : (
              <div className="space-y-2">
                {performance.studentWorksheetHistory.map(worksheet => (
                  <div key={worksheet.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{worksheet.cycle} worksheet</p>
                      <p className="text-xs text-slate-500">{worksheet.date} | {worksheet.questions} questions | {worksheet.score}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold px-2 py-1 rounded border text-green-700 bg-green-50 border-green-200">
                        {worksheet.status}
                      </span>
                      <span className="text-xs font-mono font-bold text-slate-700">{worksheet.accuracy}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className="rounded-xl border border-slate-200 p-4 space-y-3">
              <h3 className="text-xs font-mono font-bold uppercase text-slate-500">Test History</h3>
              {performance.testHistory.length === 0 ? (
                <p className="text-sm text-slate-500">Not Available</p>
              ) : performance.testHistory.map(item => (
                <div key={item.id} className="rounded-lg border border-slate-100 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                      <p className="text-xs text-slate-500">{item.detail}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-mono font-bold text-slate-900">{item.score}</p>
                      <p className="text-[10px] text-slate-400">{item.date}</p>
                    </div>
                  </div>
                </div>
              ))}
            </section>

            <section className="rounded-xl border border-slate-200 p-4 space-y-3">
              <h3 className="text-xs font-mono font-bold uppercase text-slate-500">Level Progression</h3>
              {performance.levelProgression.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {performance.missingPlacedDiagnostic ? 'Diagnostic record unavailable' : 'Not Available'}
                </p>
              ) : performance.levelProgression.map((entry, index) => (
                <div key={index} className="flex items-start gap-3 rounded-lg border border-slate-100 p-3">
                  <Calendar className="h-4 w-4 text-slate-400 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Level {entry.level}.{entry.subLevel ?? 0}</p>
                    <p className="text-xs text-slate-500">{entry.reason} | {entry.date}</p>
                  </div>
                </div>
              ))}
            </section>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <section className="rounded-xl border border-slate-200 p-4 space-y-3">
              <h3 className="text-xs font-mono font-bold uppercase text-slate-500">Strengths</h3>
              {performance.strengths.length === 0 ? (
                <p className="text-sm text-slate-500">Not Available</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {performance.strengths.map(item => (
                    <span key={item} className="rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700">{item}</span>
                  ))}
                </div>
              )}
            </section>
            <section className="rounded-xl border border-slate-200 p-4 space-y-3">
              <h3 className="text-xs font-mono font-bold uppercase text-slate-500">Areas Needing Improvement</h3>
              {performance.improvements.length === 0 ? (
                <p className="text-sm text-slate-500">Not Available</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {performance.improvements.map(item => (
                    <span key={item} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">{item}</span>
                  ))}
                </div>
              )}
            </section>
            <section className="rounded-xl border border-slate-200 p-4 space-y-3">
              <h3 className="text-xs font-mono font-bold uppercase text-slate-500">Personalized Recommendations</h3>
              {performance.recommendations.length === 0 ? (
                <p className="text-sm text-slate-500">Not Available</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {performance.recommendations.map(item => (
                    <span key={item} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">{item}</span>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-xs font-mono font-bold uppercase text-slate-500 mb-2">Teacher Remarks</h3>
            <p className="text-sm leading-relaxed text-slate-700">{performance.remarks}</p>
          </section>

          {classMetrics.topStudents.length > 0 && (
            <section className="rounded-xl border border-slate-200 p-4 space-y-3">
              <h3 className="text-xs font-mono font-bold uppercase text-slate-500">Top Performing Students</h3>
              <div className="space-y-2">
                {classMetrics.topStudents.map(student => (
                  <div key={student.id} className="flex justify-between items-center p-3 border border-slate-100 rounded-lg">
                    <div className="flex items-center gap-3"><span className="text-sm font-semibold">{student.name}</span><span className="text-xs text-slate-400">{student.classGroup}</span></div>
                    <div className="flex items-center gap-4"><div className="w-32 h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(student.currentLevel / 59) * 100}%` }} /></div><span className="font-mono font-bold text-sm">L{student.currentLevel}</span></div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};
