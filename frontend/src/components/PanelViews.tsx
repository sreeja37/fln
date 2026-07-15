import React, { useState, useEffect, useMemo } from 'react';
import { User, UserRole, Student, ClassGroup, School, EvaluationReport, LogEntry, Ticket } from '../types';
import { Users, ShieldAlert, BookOpen, UserCheck, Calendar, ArrowRight, CheckCircle2, XCircle, SlidersHorizontal, Layers, Award, MapPin, School as SchoolIcon, BarChart3, FileText, ClipboardList, Building2, GraduationCap, BookMarked, Globe, Settings, Database, RefreshCw, Search, ChevronDown } from 'lucide-react';
import { Table, Column } from './Table';
import { MetricCard } from './Card';
import { TeacherClassSelector } from './TeacherClassSelector';
import { StudentProfilePanel } from './StudentProfilePanel';
import { StudentPerformancePanel } from './StudentPerformancePanel';
import { StudentReportsPanel } from './StudentReportsPanel';

interface PanelViewsProps {
  activePanel: string;
  currentUser: User;
  token: string;
  /** Shared lifted state from App.tsx. Optional — only teacher-facing panels consume it. */
  teacherClassId?: string;
  onTeacherClassIdChange?: (id: string) => void;
}

const STUDENTS_MOCK: Student[] = [
  { id: 's1', name: 'Amanpreet Singh', age: 8, classGroup: 'Class 2', section: 'A', schoolId: 'gps-mt-001', currentLevel: 12, currentSubLevel: 0, targetLevel: 13, aadharMasked: 'XXXX-XXXX-1234', levelHistory: [{ level: 12, subLevel: 0, date: '2026-03-15', reason: 'Diagnostic' }], streak: 3 },
  { id: 's2', name: 'Jasmine Kaur', age: 7, classGroup: 'Class 2', section: 'A', schoolId: 'gps-mt-001', currentLevel: 8, currentSubLevel: 1, targetLevel: 12, aadharMasked: 'XXXX-XXXX-5678', levelHistory: [{ level: 8, subLevel: 1, date: '2026-02-20', reason: 'Mid-year' }], streak: 1 },
  { id: 's3', name: 'Rohit Kumar', age: 9, classGroup: 'Class 3', section: 'A', schoolId: 'gps-mt-001', currentLevel: 36, currentSubLevel: 0, targetLevel: 37, aadharMasked: 'XXXX-XXXX-9012', levelHistory: [{ level: 36, date: '2026-01-10', reason: 'Baseline' }], streak: 5 },
  { id: 's4', name: 'Priya Sharma', age: 8, classGroup: 'Class 2', section: 'A', schoolId: 'gps-mt-001', currentLevel: 10, currentSubLevel: 2, targetLevel: 14, aadharMasked: 'XXXX-XXXX-3456', levelHistory: [], streak: 0 },
  { id: 's5', name: 'Arjun Verma', age: 7, classGroup: 'Class 2', section: 'A', schoolId: 'gps-mt-001', currentLevel: 6, currentSubLevel: 0, targetLevel: 11, aadharMasked: 'XXXX-XXXX-7890', levelHistory: [{ level: 6, date: '2026-04-01', reason: 'Diagnostic' }], streak: 2 },
  { id: 's6', name: 'Neha Gupta', age: 8, classGroup: 'Class 3', section: 'A', schoolId: 'gps-mt-001', currentLevel: 38, currentSubLevel: 1, targetLevel: 40, aadharMasked: 'XXXX-XXXX-2345', levelHistory: [{ level: 38, date: '2026-03-01', reason: 'Mid-year' }], streak: 4 },
  { id: 's7', name: 'Simran Kaur', age: 6, classGroup: 'Class 1', section: 'A', schoolId: 'gps-mt-001', currentLevel: 4, currentSubLevel: 0, targetLevel: 8, aadharMasked: 'XXXX-XXXX-6789', levelHistory: [], streak: 0 },
];

const REPORTS_MOCK: EvaluationReport[] = [
  {
    id: 'rep_amb_g1_1_diag',
    studentId: 's_amb_g1_1',
    worksheetId: 'diagnostic-g1-counting',
    score: 2,
    totalQuestions: 3,
    conceptMastery: { 'Counting Objects': 'Strong', 'Number Names': 'Satisfactory', 'Shape Sorting': 'Needs Practice' },
    narrative: 'Aarav counts small object sets accurately and is ready for Level 1 practice, but needs guided work on sorting shapes by attributes.',
    recommendedLevel: 1,
    recommendedSubLevel: 0,
    timestamp: '2026-07-01T09:15:00Z',
    questionResponses: [
      { question: 'Count 5 drawn mangoes.', studentAnswer: '5', correctAnswer: '5', status: 'Correct', feedback: 'Accurate one-to-one counting.' },
      { question: 'Circle the number after 3.', studentAnswer: '4', correctAnswer: '4', status: 'Correct', feedback: 'Understands forward number sequence.' },
      { question: 'Select all triangles from mixed shapes.', studentAnswer: '2 triangles selected', correctAnswer: '3 triangles selected', status: 'Incorrect', feedback: 'Review triangle sides and corners.' }
    ],
    teacherRemarks: 'Pair shape sorting with concrete classroom objects.',
    aiRecommendations: 'Assign Level 1 counting fluency and a short shape-identification worksheet.'
  },
  {
    id: 'rep_amb_g1_2_diag',
    studentId: 's_amb_g1_2',
    worksheetId: 'diagnostic-g1-numerals',
    score: 2,
    totalQuestions: 3,
    conceptMastery: { 'Number Recognition': 'Strong', 'Counting Objects': 'Strong', 'Before After Numbers': 'Satisfactory' },
    narrative: 'Saanvi recognizes numerals up to 10 and counts carefully. She hesitates on before/after number prompts and should stay at Level 1 with sequencing practice.',
    recommendedLevel: 1,
    recommendedSubLevel: 0,
    timestamp: '2026-07-01T09:35:00Z',
    questionResponses: [
      { question: 'Read the numeral 8.', studentAnswer: '8', correctAnswer: '8', status: 'Correct', feedback: 'Clear numeral recognition.' },
      { question: 'Count 6 stars.', studentAnswer: '6', correctAnswer: '6', status: 'Correct', feedback: 'Maintains stable count.' },
      { question: 'What comes before 7?', studentAnswer: '5', correctAnswer: '6', status: 'Incorrect', feedback: 'Needs more before-number drills.' }
    ],
    teacherRemarks: 'Use number-line warmups before independent work.',
    aiRecommendations: 'Provide Level 1 sequencing cards focused on before and after numbers.'
  },
  {
    id: 'rep_amb_g2_1_diag',
    studentId: 's_amb_g2_1',
    worksheetId: 'diagnostic-g2-addition',
    score: 2,
    totalQuestions: 3,
    conceptMastery: { 'Two Digit Addition': 'Strong', 'Place Value': 'Satisfactory', 'Subtraction Within 20': 'Needs Practice' },
    narrative: 'Vihaan is correctly placed at Level 2. Addition strategies are strong, while subtraction within 20 needs regrouping support.',
    recommendedLevel: 2,
    recommendedSubLevel: 0,
    timestamp: '2026-07-02T10:05:00Z',
    questionResponses: [
      { question: 'Solve 12 + 6.', studentAnswer: '18', correctAnswer: '18', status: 'Correct', feedback: 'Adds ones accurately.' },
      { question: 'Write the tens and ones in 24.', studentAnswer: '2 tens and 4 ones', correctAnswer: '2 tens and 4 ones', status: 'Correct', feedback: 'Place value language is secure.' },
      { question: 'Solve 17 - 9.', studentAnswer: '9', correctAnswer: '8', status: 'Incorrect', feedback: 'Practice subtraction facts with counters.' }
    ],
    teacherRemarks: 'Continue Level 2 addition, then reteach subtraction using ten-frames.',
    aiRecommendations: 'Assign a Level 2 subtraction-within-20 remedial worksheet before moving to Level 3.'
  },
  {
    id: 'rep_amb_g2_2_diag',
    studentId: 's_amb_g2_2',
    worksheetId: 'diagnostic-g2-patterns',
    score: 2,
    totalQuestions: 3,
    conceptMastery: { 'Skip Counting': 'Strong', 'Patterns': 'Needs Practice', 'Number Comparison': 'Satisfactory' },
    narrative: 'Anaya remains at Level 2. Skip counting is reliable, but repeating pattern tasks need more visual practice before progression.',
    recommendedLevel: 2,
    recommendedSubLevel: 0,
    timestamp: '2026-07-02T10:30:00Z',
    questionResponses: [
      { question: 'Continue 2, 4, 6, __.', studentAnswer: '8', correctAnswer: '8', status: 'Correct', feedback: 'Skip counting by twos is strong.' },
      { question: 'Choose the greater number: 31 or 13.', studentAnswer: '31', correctAnswer: '31', status: 'Correct', feedback: 'Compares two-digit numbers correctly.' },
      { question: 'Continue the pattern: circle, square, circle, square, __.', studentAnswer: 'square', correctAnswer: 'circle', status: 'Incorrect', feedback: 'Needs visual pattern repetition practice.' }
    ],
    teacherRemarks: 'Use manipulatives for AB and AAB patterns.',
    aiRecommendations: 'Generate a Level 2 pattern-recognition worksheet with color and shape sequences.'
  },
  {
    id: 'rep_amb_g4_1_diag',
    studentId: 's_amb_g4_1',
    worksheetId: 'diagnostic-g4-multiplication',
    score: 2,
    totalQuestions: 3,
    conceptMastery: { 'Multiplication Facts': 'Strong', 'Division Meaning': 'Satisfactory', 'Fractions': 'Needs Practice' },
    narrative: 'Aarush is placed at Level 5. Multiplication facts are fluent, but fraction representation should be strengthened before Level 6 work.',
    recommendedLevel: 5,
    recommendedSubLevel: 0,
    timestamp: '2026-07-03T11:00:00Z',
    questionResponses: [
      { question: 'Solve 7 x 4.', studentAnswer: '28', correctAnswer: '28', status: 'Correct', feedback: 'Multiplication recall is fluent.' },
      { question: 'Share 18 pencils equally among 3 children.', studentAnswer: '6', correctAnswer: '6', status: 'Correct', feedback: 'Understands equal sharing.' },
      { question: 'Shade one half of a rectangle split into 4 equal parts.', studentAnswer: '1 part shaded', correctAnswer: '2 parts shaded', status: 'Incorrect', feedback: 'Review equivalent parts for one half.' }
    ],
    teacherRemarks: 'Keep multiplication challenge tasks while revisiting fractions visually.',
    aiRecommendations: 'Assign Level 5 fraction models using halves and quarters.'
  },
  {
    id: 'rep_amb_g4_2_diag',
    studentId: 's_amb_g4_2',
    worksheetId: 'diagnostic-g4-measurement',
    score: 2,
    totalQuestions: 3,
    conceptMastery: { 'Measurement': 'Strong', 'Division Facts': 'Needs Practice', 'Word Problems': 'Satisfactory' },
    narrative: 'Myra is placed at Level 5. Measurement reading is secure, while division fact fluency is the main area holding back independent problem solving.',
    recommendedLevel: 5,
    recommendedSubLevel: 0,
    timestamp: '2026-07-03T11:25:00Z',
    questionResponses: [
      { question: 'Read the ruler mark at 8 cm.', studentAnswer: '8 cm', correctAnswer: '8 cm', status: 'Correct', feedback: 'Reads centimeter scale correctly.' },
      { question: 'A rope is 12 cm and another is 5 cm. How much longer is the first?', studentAnswer: '7 cm', correctAnswer: '7 cm', status: 'Correct', feedback: 'Solves comparison word problem.' },
      { question: 'Solve 24 divided by 6.', studentAnswer: '3', correctAnswer: '4', status: 'Incorrect', feedback: 'Practice division facts with multiplication families.' }
    ],
    teacherRemarks: 'Use fact-family cards for division fluency.',
    aiRecommendations: 'Generate Level 5 division fact practice linked to measurement word problems.'
  },
];

const TEACHERS_MOCK = [
  { id: 't1', name: 'Ritu Sharma', email: 'gps-mt-001.t01@fln.org', schoolId: 'gps-mt-001', classes: ['Class 2-A', 'Class 3-A'], studentsCount: 42, delayedAttempts: 0, status: 'Active' },
  { id: 't2', name: 'Amit Kumar', email: 'gps-mt-001.t02@fln.org', schoolId: 'gps-mt-001', classes: ['Class 1-A'], studentsCount: 28, delayedAttempts: 1, status: 'Active' },
  { id: 't3', name: 'Sunita Devi', email: 'gps-bth-006.t01@fln.org', schoolId: 'gps-bth-006', classes: ['Class 2-B', 'Class 4-A'], studentsCount: 35, delayedAttempts: 3, status: 'Suspended' },
  { id: 't4', name: 'Rajesh Kumar', email: 'gps-pkl-008.t01@fln.org', schoolId: 'gps-pkl-008', classes: ['Class 3-B'], studentsCount: 30, delayedAttempts: 0, status: 'Active' },
];

const SCHOOLS_MOCK: School[] = [
  { id: 'gps-mt-001', name: 'GPS Model Town', stateCode: 'PB', districtCode: 'LDH', blockCode: 'LDH-01', strength: 'standard', teachersCount: 8, isAccessLocked: false },
  { id: 'gps-vl-002', name: 'GPS Village Lohara', stateCode: 'PB', districtCode: 'MOG', blockCode: 'MOG-01', strength: 'standard', teachersCount: 2, isAccessLocked: false },
  { id: 'gps-amb-003', name: 'GPS Ambala Cantt', stateCode: 'HR', districtCode: 'AMB', blockCode: 'AMB-01', strength: 'standard', teachersCount: 6, isAccessLocked: false },
  { id: 'gps-jai-004', name: 'GPS Govind Dev Ji', stateCode: 'RJ', districtCode: 'JAI', blockCode: 'JAI-01', strength: 'standard', teachersCount: 7, isAccessLocked: true },
  { id: 'gps-lko-005', name: 'GPS Hazratganj', stateCode: 'UP', districtCode: 'LKO', blockCode: 'LKO-01', strength: 'standard', teachersCount: 5, isAccessLocked: false },
  { id: 'gps-bth-006', name: 'GPS Bathinda City', stateCode: 'PB', districtCode: 'BTH', blockCode: 'BTH-01', strength: 'standard', teachersCount: 4, isAccessLocked: false },
  { id: 'gps-asr-007', name: 'GPS Amritsar', stateCode: 'PB', districtCode: 'ASR', blockCode: 'ASR-01', strength: 'standard', teachersCount: 6, isAccessLocked: false },
  { id: 'gps-pkl-008', name: 'GPS Panchkula', stateCode: 'HR', districtCode: 'PKL', blockCode: 'PKL-01', strength: 'standard', teachersCount: 5, isAccessLocked: false },
  { id: 'gps-jai2-009', name: 'GPS Jaipur Rural', stateCode: 'RJ', districtCode: 'JAI', blockCode: 'JAI-02', strength: 'standard', teachersCount: 3, isAccessLocked: false },
  { id: 'gps-uda-010', name: 'GPS Udaipur', stateCode: 'RJ', districtCode: 'UDA', blockCode: 'UDA-01', strength: 'standard', teachersCount: 3, isAccessLocked: false },
  { id: 'gps-lko2-011', name: 'GPS Aliganj', stateCode: 'UP', districtCode: 'LKO', blockCode: 'LKO-02', strength: 'standard', teachersCount: 2, isAccessLocked: false },
  { id: 'gps-knp-012', name: 'GPS Kanpur', stateCode: 'UP', districtCode: 'KNP', blockCode: 'KNP-01', strength: 'standard', teachersCount: 5, isAccessLocked: false },
  { id: 'gps-pb-ldh2-013', name: 'GPS Gill Village', stateCode: 'PB', districtCode: 'LDH', blockCode: 'LDH-02', strength: 'standard', teachersCount: 2, isAccessLocked: false },
  { id: 'gps-hr-amb2-014', name: 'GPS Ambala South', stateCode: 'HR', districtCode: 'AMB', blockCode: 'AMB-02', strength: 'standard', teachersCount: 2, isAccessLocked: false },
];

const USERS_MOCK = [
  { name: 'Jinal Gupta', email: 'superadmin@fln.org', role: 'Super Admin', scope: 'National', status: 'Active' },
  { name: 'State Coordinator Punjab', email: 'admin.pb@fln.org', role: 'State Admin', scope: 'PB', status: 'Active' },
  { name: 'State Coordinator Haryana', email: 'admin.hr@fln.org', role: 'State Admin', scope: 'HR', status: 'Active' },
  { name: 'Ludhiana District Officer', email: 'district.ldh@fln.org', role: 'District Admin', scope: 'PB-LDH', status: 'Active' },
  { name: 'Ambala District Officer', email: 'district.amb@fln.org', role: 'District Admin', scope: 'HR-AMB', status: 'Active' },
  { name: 'Ludhiana Block Admin 1', email: 'block.ldh-01@fln.org', role: 'Block Admin', scope: 'PB-LDH-LDH-01', status: 'Active' },
  { name: 'GPS Model Town Principal', email: 'gps-mt-001@fln.org', role: 'Principal', scope: 'gps-mt-001', status: 'Active' },
  { name: 'Ritu Sharma', email: 'gps-mt-001.t01@fln.org', role: 'Teacher', scope: 'gps-mt-001', status: 'Active' },
  { name: 'Rahul Kumar', email: 'vol.rahul@fln.org', role: 'Volunteer', scope: 'Moga Villages', status: 'Active' },
];

const QUESTION_BANK = [
  { id: 'QB-001', topic: 'Number Sense', level: 4, question: 'Count the number of apples: 🍎🍎🍎🍎', type: 'MCQ', difficulty: 'Easy' },
  { id: 'QB-002', topic: 'Number Sense', level: 8, question: 'What comes after 15?', type: 'Text', difficulty: 'Easy' },
  { id: 'QB-003', topic: 'Addition', level: 12, question: 'What is 7 + 5?', type: 'Number', difficulty: 'Easy' },
  { id: 'QB-004', topic: 'Subtraction', level: 16, question: 'What is 23 - 8?', type: 'Number', difficulty: 'Medium' },
  { id: 'QB-005', topic: 'Multiplication', level: 41, question: 'What is 6 × 7?', type: 'Number', difficulty: 'Medium' },
  { id: 'QB-006', topic: 'Division', level: 42, question: 'Divide 24 by 6', type: 'Number', difficulty: 'Medium' },
  { id: 'QB-007', topic: 'Fractions', level: 45, question: 'Which is larger: 1/2 or 1/4?', type: 'MCQ', difficulty: 'Hard' },
  { id: 'QB-008', topic: 'Place Value', level: 36, question: 'What is the value of 7 in 372?', type: 'Text', difficulty: 'Medium' },
  { id: 'QB-009', topic: 'Measurement', level: 43, question: 'How many cm in 1 meter?', type: 'Number', difficulty: 'Easy' },
  { id: 'QB-010', topic: 'Money', level: 46, question: 'You have ₹50. You buy a toy for ₹35. How much change?', type: 'Number', difficulty: 'Hard' },
];

const WS_TEMPLATES = [
  { id: 'WST-001', name: 'Baseline Assessment L1-L5', grade: 'Preschool 1-2', questions: 8, duration: '30 min', status: 'Published' },
  { id: 'WST-002', name: 'Number Sense L6-L11', grade: 'Class 1', questions: 10, duration: '45 min', status: 'Published' },
  { id: 'WST-003', name: 'Operations L12-L23', grade: 'Class 2', questions: 12, duration: '45 min', status: 'Draft' },
  { id: 'WST-004', name: 'Adv. Operations L24-L35', grade: 'Class 2 Review', questions: 10, duration: '60 min', status: 'Published' },
  { id: 'WST-005', name: 'Multiplication & Division L36-L48', grade: 'Class 3-4', questions: 15, duration: '60 min', status: 'Draft' },
  { id: 'WST-006', name: 'Fractions & Decimals L49-L59', grade: 'Class 4+', questions: 12, duration: '60 min', status: 'Review' },
];

const DIAGNOSTIC_HISTORY = [
  { id: 'dh1', student: 'Amanpreet Singh', date: '2026-03-15', score: 8, total: 10, placedLevel: 12, evaluator: 'Ritu Sharma' },
  { id: 'dh2', student: 'Rohit Kumar', date: '2026-01-10', score: 9, total: 10, placedLevel: 36, evaluator: 'Ritu Sharma' },
  { id: 'dh3', student: 'Arjun Verma', date: '2026-04-01', score: 6, total: 10, placedLevel: 6, evaluator: 'Amit Kumar' },
  { id: 'dh4', student: 'Neha Gupta', date: '2026-03-01', score: 7, total: 10, placedLevel: 38, evaluator: 'Ritu Sharma' },
  { id: 'dh5', student: 'Jasmine Kaur', date: '2026-02-20', score: 5, total: 10, placedLevel: 8, evaluator: 'Amit Kumar' },
];

const WORKSHEETS_MOCK = [
  { id: 'ws1', cycle: 'Baseline', class: 'Class 2-A', date: '2026-01-10', questions: 10, status: 'Evaluated', avgScore: '78%' },
  { id: 'ws2', cycle: 'Mid-year', class: 'Class 2-A', date: '2026-02-20', questions: 10, status: 'Evaluated', avgScore: '65%' },
  { id: 'ws3', cycle: 'Baseline', class: 'Class 3-A', date: '2026-01-10', questions: 10, status: 'Evaluated', avgScore: '85%' },
  { id: 'ws4', cycle: 'Mid-year', class: 'Class 3-A', date: '2026-03-01', questions: 10, status: 'Evaluated', avgScore: '72%' },
  { id: 'ws5', cycle: 'End-of-year', class: 'Class 2-A', date: '2026-05-15', questions: 12, status: 'Pending', avgScore: '-' },
  { id: 'ws6', cycle: 'End-of-year', class: 'Class 3-A', date: '2026-05-20', questions: 12, status: 'Pending', avgScore: '-' },
];

const ATTENDANCE_MOCK = [
  { student: 'Amanpreet Singh', class: 'Class 2-A', present: 42, total: 45, percentage: 93 },
  { student: 'Jasmine Kaur', class: 'Class 2-A', present: 38, total: 45, percentage: 84 },
  { student: 'Rohit Kumar', class: 'Class 3-A', present: 44, total: 45, percentage: 98 },
  { student: 'Priya Sharma', class: 'Class 2-A', present: 35, total: 45, percentage: 78 },
  { student: 'Arjun Verma', class: 'Class 2-A', present: 40, total: 45, percentage: 89 },
  { student: 'Neha Gupta', class: 'Class 3-A', present: 43, total: 45, percentage: 96 },
  { student: 'Simran Kaur', class: 'Class 1-A', present: 41, total: 45, percentage: 91 },
];

const DISTRICTS = [
  { code: 'LDH', name: 'Ludhiana', state: 'PB', schools: 3, students: 120, certifiedRate: 68 },
  { code: 'MOG', name: 'Moga', state: 'PB', schools: 1, students: 28, certifiedRate: 45 },
  { code: 'BTH', name: 'Bathinda', state: 'PB', schools: 1, students: 35, certifiedRate: 72 },
  { code: 'ASR', name: 'Amritsar', state: 'PB', schools: 1, students: 30, certifiedRate: 60 },
  { code: 'AMB', name: 'Ambala', state: 'HR', schools: 2, students: 65, certifiedRate: 55 },
  { code: 'PKL', name: 'Panchkula', state: 'HR', schools: 1, students: 30, certifiedRate: 80 },
  { code: 'JAI', name: 'Jaipur', state: 'RJ', schools: 2, students: 55, certifiedRate: 50 },
  { code: 'UDA', name: 'Udaipur', state: 'RJ', schools: 1, students: 25, certifiedRate: 40 },
  { code: 'LKO', name: 'Lucknow', state: 'UP', schools: 2, students: 48, certifiedRate: 62 },
  { code: 'KNP', name: 'Kanpur', state: 'UP', schools: 1, students: 32, certifiedRate: 56 },
];

const BLOCKS = [
  { code: 'LDH-01', district: 'LDH', schools: 2, students: 70, certifiedRate: 71 },
  { code: 'LDH-02', district: 'LDH', schools: 1, students: 22, certifiedRate: 45 },
  { code: 'MOG-01', district: 'MOG', schools: 1, students: 28, certifiedRate: 45 },
  { code: 'BTH-01', district: 'BTH', schools: 1, students: 35, certifiedRate: 72 },
  { code: 'ASR-01', district: 'ASR', schools: 1, students: 30, certifiedRate: 60 },
  { code: 'AMB-01', district: 'AMB', schools: 1, students: 35, certifiedRate: 60 },
  { code: 'AMB-02', district: 'AMB', schools: 1, students: 30, certifiedRate: 50 },
  { code: 'PKL-01', district: 'PKL', schools: 1, students: 30, certifiedRate: 80 },
  { code: 'JAI-01', district: 'JAI', schools: 1, students: 30, certifiedRate: 55 },
  { code: 'JAI-02', district: 'JAI', schools: 1, students: 25, certifiedRate: 45 },
  { code: 'UDA-01', district: 'UDA', schools: 1, students: 25, certifiedRate: 40 },
  { code: 'LKO-01', district: 'LKO', schools: 1, students: 28, certifiedRate: 65 },
  { code: 'LKO-02', district: 'LKO', schools: 1, students: 20, certifiedRate: 58 },
  { code: 'KNP-01', district: 'KNP', schools: 1, students: 32, certifiedRate: 56 },
];

const CONTENT_ITEMS = [
  { id: 'c1', title: 'Number Line 1-10', type: 'Visual Aid', level: 'L1-L4', language: 'English, Punjabi', status: 'Approved' },
  { id: 'c2', title: 'Addition with Objects', type: 'Lesson Plan', level: 'L7-L12', language: 'English, Hindi', status: 'Approved' },
  { id: 'c3', title: 'Place Value Chart', type: 'Poster', level: 'L24-L30', language: 'English, Punjabi', status: 'Draft' },
  { id: 'c4', title: 'Multiplication Tables Song', type: 'Audio', level: 'L36-L41', language: 'English', status: 'Review' },
  { id: 'c5', title: 'Fraction Pizza Activity', type: 'Worksheet', level: 'L45-L48', language: 'English, Hindi', status: 'Approved' },
  { id: 'c6', title: 'Money Math Games', type: 'Activity', level: 'L46-L48', language: 'English', status: 'Draft' },
];

const SYSTEM_LOGS_MOCK = [
  { action: 'Database Backup', status: 'Success', timestamp: '2026-07-07 02:00', details: 'Full backup completed (1.2 GB)' },
  { action: 'User Sync', status: 'Success', timestamp: '2026-07-07 01:00', details: 'Synced 142 users from state databases' },
  { action: 'SSL Certificate Renewal', status: 'Success', timestamp: '2026-07-06 12:00', details: 'Wildcard cert renewed, expires 2027-07' },
  { action: 'API Rate Limit Check', status: 'Warning', timestamp: '2026-07-06 10:30', details: '3 endpoints nearing threshold' },
  { action: 'Email Service', status: 'Failed', timestamp: '2026-07-06 08:15', details: 'SMTP relay timeout, retry queued' },
  { action: 'Cache Invalidation', status: 'Success', timestamp: '2026-07-06 06:00', details: 'CDN cache purged for /api/analytics' },
];

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

function EmptyStudents(props: {
  classes: ClassGroup[];
  activeClass: ClassGroup | null;
  students: Student[];
  teacherClassId: string;
  onTeacherClassIdChange: (id: string) => void;
}) {
  const { classes, activeClass, students, teacherClassId, onTeacherClassIdChange } = props;
  const cols: Column<Student>[] = [
    { header: 'ID', accessor: 'id', className: 'font-mono text-xs text-slate-400' },
    { header: 'Name', accessor: 'name', sortKey: 'name', className: 'font-semibold text-slate-800' },
    { header: 'Class', accessor: 'classGroup', className: '' },
    { header: 'Section', accessor: 'section', className: 'font-mono text-xs text-slate-400' },
    { header: 'Level', accessor: (s) => `L${s.currentLevel}.${s.currentSubLevel ?? 0}`, className: 'font-mono' },
    { header: 'Streak', accessor: (s) => `${s.streak} 🔥`, className: '' },
  ];

  return (
    <div className="space-y-4">
      {/* Shared grade selector — keeps Student List in sync with Dashboard. */}
      <TeacherClassSelector
        classes={classes}
        value={teacherClassId}
        onChange={(id) => onTeacherClassIdChange(id)}
        label="Active Grade"
      />
      {activeClass ? (
        <Table
          data={students}
          columns={cols}
          searchPlaceholder="Search students by name..."
          searchKey="name"
        />
      ) : (
        <div className="p-8 text-center text-slate-400 font-mono text-xs border border-slate-200 rounded-lg bg-slate-50">
          {classes.length === 0 ? 'Loading classes…' : 'Select a grade above to view its student list.'}
        </div>
      )}
    </div>
  );
}

export const PanelViews: React.FC<PanelViewsProps> = ({ activePanel, currentUser, token, teacherClassId = '', onTeacherClassIdChange }) => {
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [distFilter, setDistFilter] = useState('all');
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);

  // ---------- Live classes + students (teacher-facing panels) ----------
  // Fetched once per `token` change. Acts as the single source of truth for
  // Student List / Student Profile / Performance panels. Replaces the legacy
  // STUDENTS_MOCK dataset that previously leaked s1..s7 into the UI.
  const [classes, setClasses] = useState<ClassGroup[]>([]);
  const [students, setStudents] = useState<Student[]>([]);

  useEffect(() => {
    const fetchLive = async () => {
      if (!token) return;
      try {
        const clsRes = await fetch('/api/classes', {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        const clsData = await clsRes.json();
        if (Array.isArray(clsData)) {
          // Sort by grade number ascending so Grade 1 is selected first.
          const sorted = [...clsData].sort((a: ClassGroup, b: ClassGroup) => {
            const an = parseInt(String(a.className).match(/\d+/)?.[0] ?? '0', 10);
            const bn = parseInt(String(b.className).match(/\d+/)?.[0] ?? '0', 10);
            return an - bn;
          });
          setClasses(sorted);
          // Default to the lowest grade only if no explicit selection exists yet.
          if (sorted.length > 0 && !teacherClassId) {
            onTeacherClassIdChange?.(sorted[0].id);
          }
        }
      } catch (err) {
        console.error(err);
      }
      try {
        const stdRes = await fetch('/api/students', {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        const stdData = await stdRes.json();
        if (Array.isArray(stdData)) setStudents(stdData);
      } catch (err) {
        console.error(err);
      }
    };
    fetchLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Derive the active class from the lifted id (same source as TeacherDashboard).
  const activeClass = useMemo<ClassGroup | null>(
    () => classes.find(c => c.id === teacherClassId) ?? null,
    [classes, teacherClassId]
  );

  // Students scoped to the active grade/section (mirrors TeacherDashboard filter).
  const activeClassStudents = useMemo<Student[]>(() => {
    if (!activeClass) return [];
    return students.filter(
      s => s.classGroup === activeClass.className && s.section === activeClass.section
    );
  }, [students, activeClass]);

  const filteredSchools = SCHOOLS_MOCK.filter(s => {
    if (stateFilter !== 'all' && s.stateCode !== stateFilter) return false;
    if (distFilter !== 'all' && s.districtCode !== distFilter) return false;
    return true;
  });

  const panel = activePanel;

  const handleDownloadPDF = (student: Student, r: EvaluationReport, examResponses: any[]) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to download/print the PDF report card.');
      return;
    }

    const conceptBadges = Object.entries(r.conceptMastery)
      .map(([t, m]) => `<span class="badge ${m === 'Strong' ? 'badge-pass' : 'badge-fail'}">${t}: ${m}</span>`)
      .join(' ');

    const tableRows = examResponses.map(item => `
      <tr>
        <td style="font-weight: 500;">${item.question}</td>
        <td style="color: ${item.status === 'Correct' ? '#065f46' : '#991b1b'}; font-weight: 600;">${item.studentAnswer}</td>
        <td>${item.correctAnswer}</td>
        <td>
          <span class="badge ${item.status === 'Correct' ? 'badge-pass' : 'badge-fail'}">
            ${item.status === 'Correct' ? 'PASS' : 'FAIL'}
          </span>
        </td>
      </tr>
    `).join('');

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Assessment Report - ${student.name}</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
          body { font-family: 'Inter', sans-serif; color: #1e293b; padding: 40px; line-height: 1.5; font-size: 13px; }
          .header { text-align: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 25px; }
          .title { font-size: 24px; font-weight: 700; color: #1e3a8a; margin: 0; text-transform: uppercase; letter-spacing: 0.5px; }
          .subtitle { font-size: 12px; color: #64748b; margin-top: 5px; font-weight: 500; }
          .student-info { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 25px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; }
          .info-item { font-size: 13px; }
          .info-item strong { color: #0f172a; }
          .section-title { font-size: 14px; font-weight: 700; border-left: 4px solid #4f46e5; padding-left: 10px; margin: 25px 0 15px 0; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px; }
          .metric-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 25px; }
          .metric-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
          .metric-value { font-size: 22px; font-weight: 700; color: #4f46e5; }
          .metric-label { font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: 700; margin-top: 5px; letter-spacing: 0.5px; }
          .narrative-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; font-size: 13px; white-space: pre-line; margin-bottom: 25px; color: #334155; line-height: 1.6; }
          table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 12px; }
          th { background-color: #f1f5f9; text-align: left; padding: 10px; font-weight: 700; border-bottom: 2px solid #e2e8f0; color: #475569; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }
          td { padding: 12px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
          .badge { display: inline-block; padding: 3px 8px; font-size: 9px; font-weight: 700; border-radius: 4px; text-transform: uppercase; font-family: monospace; }
          .badge-pass { background-color: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
          .badge-fail { background-color: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
          .footer { text-align: center; margin-top: 50px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px; }
          @media print {
            body { padding: 20px; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="title">FLN Portal</div>
          <div class="subtitle">Foundation Level Diagnostic Evaluation Report</div>
        </div>

        <div class="student-info">
          <div class="info-item">Student Name: <strong>${student.name}</strong></div>
          <div class="info-item">Student ID: <strong>${student.id}</strong></div>
          <div class="info-item">Class / Section: <strong>${student.classGroup} - ${student.section}</strong></div>
          <div class="info-item">Report Date: <strong>${new Date(r.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong></div>
        </div>

        <div class="metric-grid">
          <div class="metric-card">
            <div class="metric-value">${r.score} / ${r.totalQuestions}</div>
            <div class="metric-label">Diagnostic Score</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">L${r.recommendedLevel}.${r.recommendedSubLevel ?? 0}</div>
            <div class="metric-label">Placed Level</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">${Math.round((r.score / r.totalQuestions) * 100)}%</div>
            <div class="metric-label">Accuracy Rate</div>
          </div>
        </div>

        <div class="section-title">Concept Mastery Breakdown</div>
        <div style="margin-bottom: 25px; display: flex; gap: 8px; flex-wrap: wrap;">
          ${conceptBadges}
        </div>

        <div class="section-title">AI Evaluation Summary</div>
        <div class="narrative-box">
          ${r.narrative}
        </div>

        <div class="section-title">Question Grader Matrix</div>
        <table>
          <thead>
            <tr>
              <th style="width: 45%;">Question Detail</th>
              <th style="width: 20%;">Student Response</th>
              <th style="width: 20%;">Correct Answer Key</th>
              <th style="width: 15%;">Result</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>

        <div class="footer">
          Generated automatically by the FLN Portal. Confidential Student Academic Record.
        </div>

        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 300);
          }
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  // ===================== TEACHER PANELS =====================
  if (panel === 'student_list') {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
        <PageHeader
          title="Student Roster"
          desc={
            activeClass
              ? `${activeClass.className}${activeClass.section ? ` - ${activeClass.section}` : ''} • ${activeClassStudents.length} students`
              : 'Select a grade to view its student list.'
          }
          icon={<Users className="h-5 w-5" />}
        />
        <EmptyStudents
          classes={classes}
          activeClass={activeClass}
          students={activeClassStudents}
          teacherClassId={teacherClassId}
          onTeacherClassIdChange={(id) => onTeacherClassIdChange?.(id)}
        />
      </div>
    );
  }

  if (panel === 'student_profile') {
    return (
      <StudentProfilePanel
        classes={classes}
        activeClass={activeClass}
        students={activeClassStudents}
        teacherClassId={teacherClassId}
        onTeacherClassIdChange={(id) => onTeacherClassIdChange?.(id)}
        token={token}
        onStudentUpdated={(updated) => {
          setStudents(prev => prev.map(student => student.id === updated.id ? updated : student));
        }}
      />
    );
  }

  if (panel === 'diagnostic_test') {
    const pending = STUDENTS_MOCK.filter(s => s.levelHistory.length === 0);
    const completed = STUDENTS_MOCK.filter(s => s.levelHistory.length > 0);
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
          <PageHeader title="Pending Diagnostics" desc={`${pending.length} students need initial assessment`} icon={<ShieldAlert className="h-5 w-5 text-amber-500" />} />
          {pending.length === 0 ? <p className="text-xs text-slate-400 text-center py-8">All students placed.</p> : (
            <div className="space-y-3">{pending.map(s => (
              <div key={s.id} className="flex justify-between items-center p-3 border border-slate-200 rounded-lg">
                <div><div className="font-medium text-sm">{s.name}</div><div className="text-xs text-slate-400">{s.classGroup} - {s.section}</div></div>
                <span className="text-[10px] font-mono font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">Run Diagnostic</span>
              </div>
            ))}</div>
          )}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
          <PageHeader title="Completed Diagnostics" desc={`${completed.length} students have been placed`} icon={<CheckCircle2 className="h-5 w-5 text-green-500" />} />
          <div className="space-y-3">{completed.map(s => (
            <div key={s.id} className="flex justify-between items-center p-3 border border-slate-200 rounded-lg">
              <div><div className="font-medium text-sm">{s.name}</div><div className="text-xs text-slate-400">Placed at L{s.currentLevel}.{s.currentSubLevel ?? 0}</div></div>
              <span className="text-[10px] font-mono font-bold text-green-600 bg-green-50 px-2 py-1 rounded border border-green-200">Completed</span>
            </div>
          ))}</div>
        </div>
      </div>
    );
  }

  if (panel === 'adaptive_test') {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-6">
        <PageHeader title="Adaptive Assessment" desc="Computer-adaptive testing that adjusts to student ability" icon={<SlidersHorizontal className="h-5 w-5" />} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard title="Active Sessions" value="3" subtext="Students currently testing" icon={Users} />
          <MetricCard title="Avg Adaptive Score" value="72%" subtext="Across all levels" icon={BarChart3} />
          <MetricCard title="Completion Rate" value="85%" subtext="Tests finished on time" icon={CheckCircle2} />
        </div>
        <div className="border border-slate-200 rounded-lg p-5 bg-slate-50 space-y-3">
          <h4 className="text-sm font-semibold text-slate-800">How Adaptive Testing Works</h4>
          <p className="text-xs text-slate-600 leading-relaxed">The system selects questions dynamically based on the student's previous answers. Correct answers lead to harder questions; incorrect answers adjust to easier ones. This pinpoints the exact FLN level.</p>
          <div className="flex gap-4 pt-2">
            <button className="bg-slate-900 text-white text-xs font-medium px-4 py-2 rounded-lg hover:bg-slate-800">Start New Adaptive Test</button>
            <button className="border border-slate-200 text-slate-700 text-xs font-medium px-4 py-2 rounded-lg hover:bg-slate-50">View Session Logs</button>
          </div>
        </div>
      </div>
    );
  }

  if (panel === 'test_history') {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
        <PageHeader title="Test History" desc="Complete record of all diagnostic and worksheet evaluations" icon={<FileText className="h-5 w-5" />} />
        <div className="space-y-3">{DIAGNOSTIC_HISTORY.map(h => (
          <div key={h.id} className="flex justify-between items-center p-4 border border-slate-200 rounded-lg hover:bg-slate-50">
            <div><div className="font-semibold text-sm">{h.student}</div><div className="text-xs text-slate-400">{h.date} · Evaluated by {h.evaluator}</div></div>
            <div className="text-right"><div className="font-mono font-bold">{h.score}/{h.total}</div><div className="text-xs text-slate-400">Placed L{h.placedLevel}</div></div>
          </div>
        ))}</div>
      </div>
    );
  }

  if (panel === 'worksheets') {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard title="Total Worksheets" value={WORKSHEETS_MOCK.length} subtext="Across all cycles" icon={ClipboardList} />
          <MetricCard title="Evaluated" value={WORKSHEETS_MOCK.filter(w => w.status === 'Evaluated').length} subtext="Graded and scored" icon={CheckCircle2} />
          <MetricCard title="Pending" value={WORKSHEETS_MOCK.filter(w => w.status === 'Pending').length} subtext="Awaiting evaluation" icon={FileText} />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <PageHeader title="Worksheet Cycles" desc="Baseline, Mid-year, and End-of-year assessments" />
          <div className="space-y-3 mt-4">{WORKSHEETS_MOCK.map(w => (
            <div key={w.id} className="flex justify-between items-center p-4 border border-slate-200 rounded-lg">
              <div><div className="font-semibold text-sm">{w.cycle} — {w.class}</div><div className="text-xs text-slate-400">{w.date} · {w.questions} questions</div></div>
              <div className="text-right"><span className={`text-xs font-mono font-bold px-2 py-1 rounded ${w.status === 'Evaluated' ? 'text-green-700 bg-green-50 border border-green-200' : 'text-amber-700 bg-amber-50 border border-amber-200'}`}>{w.status}</span><div className="text-xs text-slate-400 mt-1">Avg: {w.avgScore}</div></div>
            </div>
          ))}</div>
        </div>
      </div>
    );
  }

  if (panel === 'performance') {
    return (
      <StudentPerformancePanel
        classes={classes}
        activeClass={activeClass}
        students={activeClassStudents}
        teacherClassId={teacherClassId}
        onTeacherClassIdChange={(id) => onTeacherClassIdChange?.(id)}
        reports={REPORTS_MOCK}
        worksheets={WORKSHEETS_MOCK}
        diagnosticHistory={DIAGNOSTIC_HISTORY}
      />
    );
  }

  if (panel === 'reports') {
    return (
      <StudentReportsPanel
        classes={classes}
        activeClass={activeClass}
        students={activeClassStudents}
        teacherClassId={teacherClassId}
        onTeacherClassIdChange={(id) => onTeacherClassIdChange?.(id)}
        reports={REPORTS_MOCK}
        onDownloadPDF={handleDownloadPDF}
      />
    );
  }

  // ===================== VOLUNTEER PANELS =====================
  if (panel === 'assigned_schools') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {['gps-vl-002', 'gps-jai-004', 'gps-lko-005', 'gps-amb-003'].map(id => {
          const sch = SCHOOLS_MOCK.find(s => s.id === id);
          if (!sch) return null;
          const count = STUDENTS_MOCK.filter(s => s.schoolId === id).length;
          return (
            <div key={id} className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-3 hover:border-slate-400 transition-all">
              <div className="flex justify-between"><h3 className="font-bold text-slate-900">{sch.name}</h3><span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${sch.strength === 'low' ? 'text-amber-700 bg-amber-50 border border-amber-200' : 'text-emerald-700 bg-emerald-50 border border-emerald-200'}`}>{sch.strength === 'low' ? 'Low-Strength' : 'High-Strength'}</span></div>
              <div className="text-xs text-slate-400">{sch.stateCode} / {sch.districtCode} / {sch.blockCode}</div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs pt-2 border-t border-slate-100"><div><div className="font-bold text-slate-800">{count}</div><div className="text-slate-400">Students</div></div><div><div className="font-bold text-slate-800">{sch.teachersCount}</div><div className="text-slate-400">Teachers</div></div><div><div className="font-bold text-green-600">{sch.isAccessLocked ? 'Locked' : 'Active'}</div><div className="text-slate-400">Status</div></div></div>
              <button className="w-full text-xs font-medium bg-slate-900 text-white py-2 rounded-lg hover:bg-slate-800">Visit School</button>
            </div>
          );
        })}
      </div>
    );
  }

  if (panel === 'student_progress') {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
        <PageHeader title="Student Progress Tracking" desc="Monitor FLN level advancement across assigned schools" icon={<GraduationCap className="h-5 w-5" />} />
        <div className="space-y-3">{STUDENTS_MOCK.sort((a, b) => b.currentLevel - a.currentLevel).map(s => (
          <div key={s.id} className="flex items-center gap-4 p-3 border border-slate-200 rounded-lg">
            <div className="flex-1"><div className="font-medium text-sm">{s.name}</div><div className="text-xs text-slate-400">{s.classGroup} · Streak: {s.streak}</div></div>
            <div className="w-40"><div className="flex justify-between text-[10px] text-slate-500 mb-1"><span>L{s.currentLevel}</span><span>Target L{s.targetLevel}</span></div><div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(s.currentLevel / s.targetLevel) * 100}%` }} /></div></div>
            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${s.levelHistory.length > 0 ? 'text-green-700 bg-green-50 border border-green-200' : 'text-amber-700 bg-amber-50 border border-amber-200'}`}>{s.levelHistory.length > 0 ? 'Placed' : 'Pending'}</span>
          </div>
        ))}</div>
      </div>
    );
  }

  if (panel === 'attendance') {
    const examAttendance = STUDENTS_MOCK.map(s => {
      const reports = REPORTS_MOCK.filter(r => r.studentId === s.id);
      const examsGiven = reports.length;
      const lastExam = examsGiven > 0 ? new Date(Math.max(...reports.map(r => new Date(r.timestamp).getTime()))).toLocaleDateString() : 'N/A';
      const avgScore = examsGiven > 0 ? Math.round(reports.reduce((a, r) => a + (r.score / r.totalQuestions) * 100, 0) / examsGiven) : 0;
      return { student: s.name, class: `${s.classGroup} - ${s.section}`, examsGiven, lastExam, avgScore, placed: s.levelHistory.length > 0 };
    });
    const totalExams = examAttendance.reduce((a, e) => a + e.examsGiven, 0);
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <MetricCard title="Total Students" value={examAttendance.length} subtext="Assigned roster" icon={Users} />
          <MetricCard title="Exams Conducted" value={totalExams} subtext="Across all students" icon={FileText} />
          <MetricCard title="Avg Exams/Student" value={`${(totalExams / examAttendance.length).toFixed(1)}`} subtext="Participation rate" icon={BarChart3} />
          <MetricCard title="Placed Students" value={examAttendance.filter(e => e.placed).length} subtext="Have level history" icon={Award} />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <PageHeader title="Exam Attendance Records" desc="Track which students have appeared for assessments and their performance" icon={<Calendar className="h-5 w-5" />} />
          <div className="space-y-2 mt-4">{examAttendance.map(a => (
            <div key={a.student} className="flex items-center gap-4 p-3 border border-slate-100 rounded-lg">
              <div className="flex items-center gap-3 w-8">{a.examsGiven > 0 ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-slate-300" />}</div>
              <div className="flex-1 min-w-0"><span className="text-sm font-medium">{a.student}</span><span className="text-xs text-slate-400 ml-2">{a.class}</span></div>
              <div className="flex items-center gap-6 text-sm shrink-0">
                <div className="text-center"><div className="font-bold text-slate-900">{a.examsGiven}</div><div className="text-[9px] text-slate-400 font-mono uppercase">Exams</div></div>
                <div className="text-center"><div className={`font-bold ${a.avgScore >= 70 ? 'text-emerald-600' : a.avgScore >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{a.examsGiven > 0 ? `${a.avgScore}%` : '—'}</div><div className="text-[9px] text-slate-400 font-mono uppercase">Avg Score</div></div>
                <div className="text-center"><div className="text-xs text-slate-500 font-mono">{a.lastExam}</div><div className="text-[9px] text-slate-400 font-mono uppercase">Last Exam</div></div>
                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${a.placed ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' : 'text-amber-700 bg-amber-50 border border-amber-200'}`}>{a.placed ? 'Placed' : 'Pending'}</span>
              </div>
            </div>
          ))}</div>
        </div>
      </div>
    );
  }

  // ===================== PRINCIPAL / SCHOOL ADMIN PANELS =====================
  if (panel === 'teachers' && currentUser.role === UserRole.SCHOOL) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
        <PageHeader title="Teacher Roster" desc="Manage teaching staff at your school" icon={<Users className="h-5 w-5" />} />
        <div className="space-y-3">{TEACHERS_MOCK.filter(t => t.schoolId === currentUser.schoolId).map(t => (
          <div key={t.id} className="flex justify-between items-center p-3 border border-slate-200 rounded-lg">
            <div><div className="font-semibold text-sm">{t.name}</div><div className="text-xs text-slate-400">{t.email} · {t.classes.join(', ')}</div></div>
            <div className="text-right"><span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${t.status === 'Active' ? 'text-green-700 bg-green-50 border border-green-200' : 'text-red-700 bg-red-50 border border-red-200'}`}>{t.status}</span><div className="text-xs text-slate-400 mt-1">{t.studentsCount} students</div></div>
          </div>
        ))}</div>
      </div>
    );
  }

  // ===================== BLOCK/DISTRICT/STATE ADMIN + SUPERADMIN SHARED PANELS =====================
  if (panel === 'schools') {
    const uniqueStates = [...new Set(SCHOOLS_MOCK.map(s => s.stateCode))];
    const uniqueDists = [...new Set(SCHOOLS_MOCK.filter(s => stateFilter === 'all' || s.stateCode === stateFilter).map(s => s.districtCode))];
    return (
      <div className="space-y-6">
        <div className="flex gap-3 items-end">
          <div><label className="block text-[10px] font-mono font-bold text-slate-400 uppercase mb-1">State</label><select value={stateFilter} onChange={e => { setStateFilter(e.target.value); setDistFilter('all'); }} className="text-sm border border-slate-200 rounded-lg p-2 outline-none">{uniqueStates.map(s => <option key={s} value={s}>{s}</option>)}<option value="all">All States</option></select></div>
          <div><label className="block text-[10px] font-mono font-bold text-slate-400 uppercase mb-1">District</label><select value={distFilter} onChange={e => setDistFilter(e.target.value)} className="text-sm border border-slate-200 rounded-lg p-2 outline-none"><option value="all">All Districts</option>{uniqueDists.map(d => <option key={d} value={d}>{d}</option>)}</select></div>
          <div className="text-xs text-slate-400 pb-1">Showing {filteredSchools.length} schools</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{filteredSchools.map(s => (
          <div key={s.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-2">
            <div className="flex justify-between"><h4 className="font-bold text-slate-900 text-sm">{s.name}</h4><span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${s.strength === 'high' ? 'text-indigo-700 bg-indigo-50 border border-indigo-200' : 'text-amber-700 bg-amber-50 border border-amber-200'}`}>{s.strength}</span></div>
            <div className="text-xs text-slate-400">{s.stateCode} / {s.districtCode} / {s.blockCode}</div>
            <div className="flex gap-4 text-xs pt-1 border-t border-slate-100"><span>👨‍🏫 {s.teachersCount} teachers</span><span className={s.isAccessLocked ? 'text-red-600' : 'text-green-600'}>{s.isAccessLocked ? '🔒 Locked' : '🔓 Active'}</span></div>
          </div>
        ))}</div>
      </div>
    );
  }

  if (panel === 'districts') {
    const userState = currentUser.stateCode || 'PB';
    const stateDistricts = DISTRICTS.filter(d => d.state === userState);
    const [expandedDist, setExpandedDist] = useState<string | null>(null);
    const distSchools = expandedDist ? SCHOOLS_MOCK.filter(s => s.districtCode === expandedDist) : [];
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <MetricCard title="State Districts" value={stateDistricts.length} subtext={`${userState} jurisdiction`} icon={MapPin} />
          <MetricCard title="Total Schools" value={stateDistricts.reduce((a, d) => a + d.schools, 0)} subtext="Registered facilities" icon={SchoolIcon} />
          <MetricCard title="Total Students" value={stateDistricts.reduce((a, d) => a + d.students, 0)} subtext="Across all districts" icon={Users} />
          <MetricCard title="Avg Certification" value={`${Math.round(stateDistricts.reduce((a, d) => a + d.certifiedRate, 0) / stateDistricts.length)}%`} subtext="State weighted average" icon={Award} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* District list */}
          <div className={`${expandedDist ? 'lg:col-span-1' : 'lg:col-span-3'} bg-white border border-slate-200 rounded-xl p-5 shadow-sm`}>
            <PageHeader title="District Overview" desc={`${userState} — Performance metrics by district`} icon={<MapPin className="h-5 w-5" />} />
            <div className="space-y-2 mt-4">{stateDistricts.map(d => {
              const isExpanded = expandedDist === d.code;
              const schoolList = SCHOOLS_MOCK.filter(s => s.districtCode === d.code);
              const studentCount = schoolList.reduce((a, s) => a + (STUDENTS_MOCK.filter(st => st.schoolId === s.id).length), 0);
              return (
                <div key={d.code}>
                  <button onClick={() => setExpandedDist(isExpanded ? null : d.code)} className={`w-full flex items-center gap-4 p-3 border rounded-lg text-left hover:bg-slate-50 transition-all ${isExpanded ? 'border-indigo-300 bg-indigo-50' : 'border-slate-100'}`}>
                    <div className="w-16"><span className="font-bold text-sm">{d.code}</span><span className="text-[10px] text-slate-400 ml-1">({d.state})</span></div>
                    <div className="flex-1"><span className="text-sm font-semibold">{d.name}</span></div>
                    <div className="flex gap-4 text-xs text-slate-500">
                      <span><strong className="text-slate-800">{studentCount}</strong> students</span>
                      <span><strong className="text-slate-800">{schoolList.length}</strong> schools</span>
                    </div>
                    <div className="w-24"><div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${d.certifiedRate}%` }} /></div><div className="text-[10px] text-slate-400 mt-0.5 text-right">{d.certifiedRate}% certified</div></div>
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>
                </div>
              );
            })}</div>
          </div>

          {/* Schools in selected district */}
          {expandedDist && (
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-slate-900">Schools in {expandedDist}</h3>
                  <button onClick={() => setExpandedDist(null)} className="text-xs text-slate-400 hover:text-slate-600 font-mono">Close</button>
                </div>
                <div className="grid grid-cols-1 gap-4">{distSchools.map(sch => {
                  const students = STUDENTS_MOCK.filter(st => st.schoolId === sch.id);
                  const certified = students.filter(st => st.currentLevel >= 5).length;
                  const avgLevel = students.length > 0 ? Math.round(students.reduce((a, st) => a + st.currentLevel, 0) / students.length) : 0;
                  return (
                    <div key={sch.id} className="border border-slate-200 rounded-xl p-5 hover:border-slate-400 transition-all">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-bold text-slate-900">{sch.name}</h4>
                          <p className="text-xs text-slate-400">{sch.id} · {sch.blockCode} · {sch.stateCode}/{sch.districtCode}</p>
                        </div>
                        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${sch.strength === 'high' ? 'text-indigo-700 bg-indigo-50 border border-indigo-200' : 'text-amber-700 bg-amber-50 border border-amber-200'}`}>{sch.strength}</span>
                      </div>
                      <div className="grid grid-cols-4 gap-4 mt-4 pt-3 border-t border-slate-100">
                        <div className="text-center"><div className="text-lg font-bold text-slate-900">{students.length}</div><div className="text-[10px] text-slate-400">Students</div></div>
                        <div className="text-center"><div className="text-lg font-bold text-slate-900">{sch.teachersCount}</div><div className="text-[10px] text-slate-400">Teachers</div></div>
                        <div className="text-center"><div className="text-lg font-bold text-emerald-600">{certified}</div><div className="text-[10px] text-slate-400">Certified</div></div>
                        <div className="text-center"><div className="text-lg font-bold text-slate-900">L{avgLevel}</div><div className="text-[10px] text-slate-400">Avg Level</div></div>
                      </div>
                      <div className="mt-3">
                        <div className="flex justify-between text-[10px] text-slate-500 mb-1"><span>Certification Rate</span><span>{students.length > 0 ? Math.round(certified / students.length * 100) : 0}%</span></div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${students.length > 0 ? (certified / students.length) * 100 : 0}%` }} /></div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">{students.map(st => (
                        <span key={st.id} className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${st.levelHistory.length > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{st.name.split(' ')[0]} L{st.currentLevel}</span>
                      ))}</div>
                    </div>
                  );
                })}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (panel === 'blocks') {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
        <PageHeader title="Block Administration" desc="All blocks under your district jurisdiction" icon={<MapPin className="h-5 w-5" />} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{BLOCKS.map(b => (
          <div key={b.code} className="border border-slate-200 rounded-lg p-4 space-y-2">
            <div className="flex justify-between"><span className="font-bold text-sm">{b.code}</span><span className="text-xs text-slate-400">Dist: {b.district}</span></div>
            <div className="flex gap-4 text-xs"><span>🏫 {b.schools} schools</span><span>👨‍🎓 {b.students} students</span></div>
            <div><div className="flex justify-between text-[10px] mb-0.5"><span>Certification</span><span>{b.certifiedRate}%</span></div><div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${b.certifiedRate}%` }} /></div></div>
          </div>
        ))}</div>
      </div>
    );
  }

  // ===================== SUPERADMIN PANELS =====================
  if (panel === 'users') {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
        <PageHeader title="User Management" desc="All registered users across the FLN system" icon={<Users className="h-5 w-5" />} />
        <div className="space-y-2">{USERS_MOCK.map(u => (
          <div key={u.email} className="flex justify-between items-center p-3 border border-slate-100 rounded-lg">
            <div><div className="font-medium text-sm">{u.name}</div><div className="text-xs text-slate-400 font-mono">{u.email}</div></div>
            <div className="flex items-center gap-3"><span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">{u.role}</span><span className="text-xs text-slate-400">{u.scope}</span><span className="text-[10px] font-mono font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded border border-green-200">{u.status}</span></div>
          </div>
        ))}</div>
      </div>
    );
  }

  if (panel === 'question_bank') {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
        <PageHeader title="Question Bank" desc="Curated repository of FLN assessment questions across all 59 levels" icon={<BookOpen className="h-5 w-5" />} />
        <div className="space-y-2">{QUESTION_BANK.map(q => (
          <div key={q.id} className="p-3 border border-slate-100 rounded-lg">
            <div className="flex justify-between items-start"><div><span className="text-[10px] font-mono font-bold text-slate-400">{q.id}</span><span className="text-sm font-medium ml-2">{q.question}</span></div><div className="flex gap-1 shrink-0"><span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">{q.topic}</span><span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">L{q.level}</span><span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">{q.difficulty}</span></div></div>
          </div>
        ))}</div>
      </div>
    );
  }

  if (panel === 'worksheet_templates') {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
        <PageHeader title="Worksheet Templates" desc="Pre-designed assessment templates for each grade and cycle" icon={<ClipboardList className="h-5 w-5" />} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{WS_TEMPLATES.map(t => (
          <div key={t.id} className="border border-slate-200 rounded-lg p-4 space-y-2">
            <div className="flex justify-between"><span className="font-bold text-sm">{t.name}</span><span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${t.status === 'Published' ? 'text-green-700 bg-green-50 border border-green-200' : t.status === 'Draft' ? 'text-amber-700 bg-amber-50 border border-amber-200' : 'text-blue-700 bg-blue-50 border border-blue-200'}`}>{t.status}</span></div>
            <div className="text-xs text-slate-400">{t.id} · Grade: {t.grade}</div>
            <div className="flex gap-3 text-xs text-slate-500"><span>📝 {t.questions} questions</span><span>⏱ {t.duration}</span></div>
          </div>
        ))}</div>
      </div>
    );
  }

  if (panel === 'content') {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
        <PageHeader title="Content Library" desc="Educational resources, lesson plans, and teaching aids" icon={<BookMarked className="h-5 w-5" />} />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{CONTENT_ITEMS.map(c => (
          <div key={c.id} className="border border-slate-200 rounded-lg p-4 space-y-2 hover:border-slate-400 transition-all">
            <div className="flex justify-between"><span className="font-bold text-sm">{c.title}</span><span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${c.status === 'Approved' ? 'text-green-700 bg-green-50 border border-green-200' : c.status === 'Draft' ? 'text-amber-700 bg-amber-50 border border-amber-200' : 'text-blue-700 bg-blue-50 border border-blue-200'}`}>{c.status}</span></div>
            <div className="text-xs text-slate-400">{c.type} · Level {c.level}</div>
            <div className="text-xs text-slate-500">Languages: {c.language}</div>
          </div>
        ))}</div>
      </div>
    );
  }

  if (panel === 'analytics') {
    const isAdmin = [UserRole.ADMIN, UserRole.DISTRICT_ADMIN, UserRole.BLOCK_ADMIN].includes(currentUser.role);
    const data = isAdmin ? DISTRICTS : SCHOOLS_MOCK;
    const title = isAdmin ? 'Geographical Analytics' : 'Performance Analytics';
    const desc = isAdmin ? 'Cross-regional performance metrics and benchmarking' : 'School-level performance data and trends';
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <MetricCard title="Total Schools" value={SCHOOLS_MOCK.length} subtext="All facilities" icon={SchoolIcon} />
          <MetricCard title="Total Students" value={STUDENTS_MOCK.length} subtext="Active roster" icon={Users} />
          <MetricCard title="Avg FLN Level" value={`L${Math.round(STUDENTS_MOCK.reduce((a, s) => a + s.currentLevel, 0) / STUDENTS_MOCK.length)}`} subtext="System average" icon={BarChart3} />
          <MetricCard title="Certification Rate" value={`${Math.round(STUDENTS_MOCK.filter(s => s.currentLevel >= 5).length / STUDENTS_MOCK.length * 100)}%`} subtext="Level 5+ benchmark" icon={Award} />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <PageHeader title={title} desc={desc} icon={<BarChart3 className="h-5 w-5" />} />
          <div className="space-y-3 mt-4">{data.map((d: any) => (
            <div key={d.code || d.id} className="flex items-center gap-4 p-3 border border-slate-100 rounded-lg">
              <span className="font-bold text-sm w-20">{d.code || d.id}</span>
              <span className="text-sm flex-1">{d.name || d.districtCode}</span>
              <span className="text-xs text-slate-400 w-24">{d.schools || '—'} schools</span>
              <div className="w-32"><div className="flex justify-between text-[10px] mb-0.5"><span>{d.certifiedRate || 0}%</span></div><div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${d.certifiedRate || 0}%` }} /></div></div>
            </div>
          ))}</div>
        </div>
      </div>
    );
  }

  if (panel === 'system_settings') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
          <PageHeader title="System Configuration" desc="Core platform settings and infrastructure" icon={<Settings className="h-5 w-5" />} />
          <div className="space-y-3">{[
            { label: 'Platform Name', value: 'National FLN Assessment Portal' },
            { label: 'Version', value: 'v2.4.1 (Build 2026.07)' },
            { label: 'Environment', value: 'Production' },
            { label: 'Database', value: 'PostgreSQL 15.2 / Redis 7.0' },
            { label: 'API Rate Limit', value: '1000 req/min per user' },
            { label: 'Session Timeout', value: '120 minutes' },
            { label: 'Auth Provider', value: 'Email + Password (SLA §3.2)' },
            { label: 'AI Model', value: 'Gemini 1.5 Pro (Fine-tuned FLN)' },
          ].map(c => (
            <div key={c.label} className="flex justify-between text-sm py-2 border-b border-slate-50"><span className="text-slate-500">{c.label}</span><span className="font-medium text-slate-800 font-mono text-xs">{c.value}</span></div>
          ))}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
          <PageHeader title="System Health" desc="Recent operational logs and status" icon={<Database className="h-5 w-5" />} />
          <div className="space-y-2">{SYSTEM_LOGS_MOCK.map(l => (
            <div key={l.action} className="flex items-center gap-3 p-2 border border-slate-100 rounded text-xs">
              <span className={`w-2 h-2 rounded-full shrink-0 ${l.status === 'Success' ? 'bg-green-500' : l.status === 'Warning' ? 'bg-amber-500' : 'bg-red-500'}`} />
              <span className="font-medium w-32">{l.action}</span>
              <span className="text-slate-400 flex-1">{l.details}</span>
              <span className="text-slate-400 font-mono">{l.timestamp}</span>
            </div>
          ))}</div>
          <button className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-700 mt-2"><RefreshCw className="w-3 h-3" /> Refresh Status</button>
        </div>
      </div>
    );
  }

  // Fallback for any unmatched panel — renders the roles workspace (dashboard) as the content
  return null;
};
