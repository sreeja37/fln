import React, { useEffect, useMemo, useState } from 'react';
import { Award, BarChart3, FileText } from 'lucide-react';
import type { ClassGroup, EvaluationReport, Student } from '../types';
import { TeacherClassSelector } from './TeacherClassSelector';

interface ExamResponse {
  question: string;
  studentAnswer: string;
  correctAnswer: string;
  status: string;
  feedback?: string;
}

interface StudentReportsPanelProps {
  classes: ClassGroup[];
  activeClass: ClassGroup | null;
  students: Student[];
  teacherClassId: string;
  onTeacherClassIdChange: (id: string) => void;
  reports: EvaluationReport[];
  onDownloadPDF: (student: Student, report: EvaluationReport, examResponses: ExamResponse[]) => void;
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

const getExamResponses = (report: EvaluationReport): ExamResponse[] => report.questionResponses ?? [];

const getReportScore = (report: EvaluationReport) => {
  const responses = getExamResponses(report);
  const total = responses.length || report.totalQuestions;
  const score = responses.length
    ? responses.filter(response => response.status === 'Correct').length
    : report.score;
  const percent = total > 0 ? Math.round((score / total) * 100) : 0;

  return { score, total, percent };
};

export const StudentReportsPanel: React.FC<StudentReportsPanelProps> = ({
  classes,
  activeClass,
  students,
  teacherClassId,
  onTeacherClassIdChange,
  reports,
  onDownloadPDF,
}) => {
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const selectedStudent = students.find(student => student.id === selectedStudentId) ?? null;

  useEffect(() => {
    setSelectedStudentId('');
    setExpandedReportId(null);
  }, [teacherClassId]);

  useEffect(() => {
    setExpandedReportId(null);
  }, [selectedStudentId]);

  const studentReports = useMemo(() => {
    if (!selectedStudent) return [];
    return reports
      .filter(report => report.studentId === selectedStudent.id)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [reports, selectedStudent]);

  const summary = useMemo(() => {
    const totalReports = studentReports.length;
    const averageScore = totalReports > 0
      ? `${Math.round(studentReports.reduce((sum, report) => sum + getReportScore(report).percent, 0) / totalReports)}%`
      : 'Not Available';
    const currentLevel = selectedStudent ? `L${selectedStudent.currentLevel}.${selectedStudent.currentSubLevel ?? 0}` : 'Not Available';
    const strongConcepts = studentReports.reduce(
      (sum, report) => sum + Object.values(report.conceptMastery).filter(value => value === 'Strong').length,
      0
    );

    return {
      totalReports,
      averageScore,
      currentLevel,
      strongConcepts: totalReports > 0 ? strongConcepts : 'Not Available',
    };
  }, [selectedStudent, studentReports]);

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
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-5">
        <PageHeader title="Evaluation Reports" desc="Detailed assessment narratives and concept mastery breakdowns" icon={<FileText className="h-5 w-5" />} />

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(240px,320px)] gap-4">
          <TeacherClassSelector
            classes={classes}
            value={teacherClassId}
            onChange={onTeacherClassIdChange}
            label="Active Grade"
          />
          <div>
            <label htmlFor="student-reports-selector" className="block text-xs font-mono font-bold uppercase text-slate-500 mb-2">
              Student
            </label>
            <select
              id="student-reports-selector"
              value={selectedStudentId}
              onChange={(event) => setSelectedStudentId(event.target.value)}
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

        {!selectedStudent ? (
          <div className="p-8 text-center text-slate-500 font-medium text-sm border border-slate-200 rounded-lg bg-slate-50">
            Select a student to view reports.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Metric title="Total Reports" value={summary.totalReports} subtext="Selected student only" icon={<FileText className="h-5 w-5" />} />
              <Metric title="Average Score" value={summary.averageScore} subtext="Across selected reports" icon={<BarChart3 className="h-5 w-5" />} />
              <Metric title="Current FLN Level" value={summary.currentLevel} subtext="Current placement" icon={<Award className="h-5 w-5" />} />
              <Metric title="Strong Concepts" value={summary.strongConcepts} subtext="From selected reports" icon={<Award className="h-5 w-5" />} />
            </div>

            {studentReports.length === 0 ? (
              <div className="p-8 text-center text-slate-500 font-medium text-sm border border-slate-200 rounded-lg bg-slate-50">
                No reports available for this student.
              </div>
            ) : (
              <div className="space-y-4">
                {studentReports.map(report => {
                  const isExpanded = expandedReportId === report.id;
                  const examResponses = getExamResponses(report);
                  const scoreSummary = getReportScore(report);
                  const strengths = Object.entries(report.conceptMastery)
                    .filter(([, value]) => value === 'Strong')
                    .map(([topic]) => topic);
                  const areas = Object.entries(report.conceptMastery)
                    .filter(([, value]) => value !== 'Strong')
                    .map(([topic]) => topic);

                  return (
                    <div key={report.id} className="border border-slate-200 rounded-lg p-4 space-y-3 hover:border-slate-300 transition-all">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <span className="font-semibold text-sm">{selectedStudent.name}</span>
                          <div className="text-xs text-slate-400">{selectedStudent.classGroup} Â· Section {selectedStudent.section || 'N/A'}</div>
                        </div>
                        <span className="text-xs text-slate-400">{new Date(report.timestamp).toLocaleDateString()}</span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                        <span>Current Level: <strong>L{selectedStudent.currentLevel}.{selectedStudent.currentSubLevel ?? 0}</strong></span>
                        <span>Assessment: <strong>{report.worksheetId || 'Not Available'}</strong></span>
                        <span>Score: <strong>{scoreSummary.score}/{scoreSummary.total} ({scoreSummary.percent}%)</strong></span>
                        <span>Report Date: <strong>{new Date(report.timestamp).toLocaleDateString()}</strong></span>
                      </div>

                      <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
                        <span className="text-[9px] font-mono font-bold uppercase text-slate-400 tracking-wider">Evaluation Narrative</span>
                        <p className="text-xs text-slate-600 mt-1 leading-relaxed whitespace-pre-line">{report.narrative || 'Not Available'}</p>
                      </div>

                      <div className="flex flex-wrap gap-2">{Object.entries(report.conceptMastery).map(([topic, mastery]) => (
                        <span key={topic} className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${mastery === 'Strong' ? 'bg-green-50 text-green-700 border border-green-200' : mastery === 'Satisfactory' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{topic}: {mastery}</span>
                      ))}</div>

                      <div className="pt-2 border-t border-slate-100 flex justify-between items-center">
                        <div className="flex gap-3">
                          <button onClick={() => setExpandedReportId(isExpanded ? null : report.id)} className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
                            {isExpanded ? 'Hide Exam Sheet' : 'ðŸ“‹ View Student Exam Responses'}
                          </button>
                          <button onClick={() => onDownloadPDF(selectedStudent, { ...report, score: scoreSummary.score, totalQuestions: scoreSummary.total }, examResponses)} className="text-xs font-semibold text-emerald-650 hover:text-emerald-800 flex items-center gap-1">
                            ðŸ“¥ Download PDF Report
                          </button>
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono">Assigned from Diagnostic Pipeline</span>
                      </div>

                      {isExpanded && (
                        <div className="mt-3 border border-slate-200 rounded-lg overflow-hidden bg-slate-50 text-xs">
                          <div className="bg-slate-100 px-3 py-2 font-bold text-slate-700 border-b border-slate-200">Side-by-Side Exam Grader Report</div>
                          <div className="divide-y divide-slate-200">
                            {examResponses.map((item, index) => (
                              <div key={index} className="p-3 space-y-1">
                                <div className="font-semibold text-slate-800">Question {index + 1}: {item.question}</div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1 pt-1 border-t border-dotted border-slate-200">
                                  <div>
                                    <span className="text-[9px] text-slate-400 uppercase font-mono block">Student Answer</span>
                                    <span className={`font-medium ${item.status === 'Correct' ? 'text-green-700' : 'text-red-700'}`}>{item.studentAnswer}</span>
                                  </div>
                                  <div>
                                    <span className="text-[9px] text-slate-400 uppercase font-mono block">Correct Answer</span>
                                    <span className="font-medium text-slate-800">{item.correctAnswer}</span>
                                  </div>
                                  <div>
                                    <span className="text-[9px] text-slate-400 uppercase font-mono block">Result</span>
                                    <span className={`inline-block px-1.5 py-0.5 text-[9px] font-bold font-mono rounded ${item.status === 'Correct' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{item.status === 'Correct' ? 'PASS' : 'FAIL'}</span>
                                  </div>
                                  <div>
                                    <span className="text-[9px] text-slate-400 uppercase font-mono block">Feedback</span>
                                    <span className="font-medium text-slate-800">{item.feedback || 'Not Available'}</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
                        <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                          <h4 className="text-[10px] font-mono font-bold uppercase text-slate-400 mb-2">Strengths</h4>
                          <p className="text-xs text-slate-700">{strengths.length > 0 ? strengths.join(', ') : 'Not Available'}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                          <h4 className="text-[10px] font-mono font-bold uppercase text-slate-400 mb-2">Areas Needing Improvement</h4>
                          <p className="text-xs text-slate-700">{areas.length > 0 ? areas.join(', ') : 'Not Available'}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                          <h4 className="text-[10px] font-mono font-bold uppercase text-slate-400 mb-2">Teacher Remarks</h4>
                          <p className="text-xs text-slate-700">{report.teacherRemarks || 'Not Available'}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                          <h4 className="text-[10px] font-mono font-bold uppercase text-slate-400 mb-2">AI Recommendations</h4>
                          <p className="text-xs text-slate-700">{report.aiRecommendations || 'Not Available'}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
