import React from 'react';
import { ChevronDown } from 'lucide-react';
import type { ClassGroup } from '../types';

interface TeacherClassSelectorProps {
  /** Already-loaded list of classes. Caller is responsible for fetching, sorting, and default-selecting. */
  classes: ClassGroup[];
  /** Currently selected class id (controlled). */
  value: string;
  /** Fired with the new class id whenever the user picks a different option. */
  onChange: (classId: string) => void;
  /** Optional label shown above the dropdown (default "Active Class"). */
  label?: string;
  /** Optional flex layout override (default "flex flex-wrap items-center gap-3"). */
  className?: string;
}

/**
 * Presentational dropdown for selecting an active grade. Pure UI: takes
 * a pre-loaded `classes` array, renders a `<select>` of the grade names,
 * and emits the chosen id via `onChange`. No fetching, no loading state,
 * no side-effects — caller owns the data layer.
 */
export const TeacherClassSelector: React.FC<TeacherClassSelectorProps> = ({
  classes,
  value,
  onChange,
  label = 'Active Class',
  className = 'flex flex-wrap items-center gap-3',
}) => {
  const selected = classes.find(c => c.id === value) ?? null;

  return (
    <div className={className}>
      <label htmlFor="teacher-class-selector" className="text-xs font-mono font-bold uppercase text-slate-500">
        {label}
      </label>
      <div className="relative">
        <select
          id="teacher-class-selector"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={classes.length === 0}
          className="appearance-none bg-white border border-slate-200 rounded-lg pl-3 pr-9 py-2 text-sm font-medium text-slate-800 focus:outline-none focus:border-slate-500 disabled:opacity-50 disabled:cursor-not-allowed min-w-[200px]"
        >
          {classes.length === 0 && <option value="">No classes</option>}
          {classes.map(c => (
            <option key={c.id} value={c.id}>
              {c.className}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      </div>
      {selected && (
        <span className="ml-auto text-xs font-mono font-bold uppercase text-slate-500">
          {selected.className}
        </span>
      )}
    </div>
  );
};

/**
 * Helper hook so multiple panels don't each write the same shared
 * `selectedClassId` state. Returns [selectedClassId, setSelectedClassId]
 * like `useState`. Caller can pass an explicit initial value.
 */
export function useTeacherClassId(initialId: string = ''): [string, (id: string) => void] {
  const [id, setId] = React.useState(initialId);
  return [id, setId];
}