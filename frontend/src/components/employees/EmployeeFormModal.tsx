import { useState } from 'react';
import clsx from 'clsx';
import { DEPARTMENTS } from '../../constants/departments';
import { SHIFTS, normalizeShiftLabel } from '../../constants/shifts';
import { type EmployeeMaster } from '../../api';
import { Employee } from './types';

const EMPTY_FORM: EmployeeMaster = {
  employeeNumber: '',
  name: '',
  email: '',
  mobile: '',
  department: '',
  designation: '',
  shift: 'General Shift',
  shiftStartTime: '09:00',
  shiftEndTime: '18:00',
  monthlySalary: 0,
  status: 'Active',
  paidLeavesEligible: false,
  overtimeEligible: false,
};

const inputCls =
  'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 bg-slate-50';

interface Props {
  editing: Employee | null;
  suggestedId: string;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (data: EmployeeMaster) => void;
}

function Field({ label, children, full, required }: { label: string; children: React.ReactNode; full?: boolean; required?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  );
}

function toTimeInputValue(value: string | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59) return '';
  const meridiem = raw.match(/\b(AM|PM)\b/i)?.[1]?.toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  if (hour > 23) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// Add / Edit employee modal. Form state is initialised from `editing` (or the
// suggested next ID for new records) — the component remounts each time it opens.
export default function EmployeeFormModal({ editing, suggestedId, isPending, onClose, onSubmit }: Props) {
  const [form, setForm] = useState<EmployeeMaster>(() =>
    editing
      ? {
          employeeNumber: editing.employeeNumber,
          name: editing.name,
          email: editing.email,
          mobile: editing.mobile,
          department: editing.department,
          designation: editing.designation,
          shift: editing.shift || 'General',
          shiftStartTime: toTimeInputValue(editing.shiftStartTime) || '09:00',
          shiftEndTime: toTimeInputValue(editing.shiftEndTime) || '18:00',
          monthlySalary: editing.monthlySalary || 0,
          status: editing.status === 'Inactive' ? 'Inactive' : 'Active',
          paidLeavesEligible: editing.paidLeavesEligible === true,
          overtimeEligible: editing.overtimeEligible === true,
        }
      : { ...EMPTY_FORM, employeeNumber: suggestedId },
  );
  const isItDepartment = String(form.department || '').trim().toLowerCase() === 'it';
  function handleSubmit() {
    if (!form.name?.trim() || !form.employeeNumber?.trim()) return;
    onSubmit(form);
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto animate-scale-in">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl z-10">
          <div>
            <h3 className="text-lg font-bold text-slate-800">{editing ? 'Edit Employee' : 'Add Employee'}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{editing ? 'Update this employee record' : 'Create a new employee record'}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100">
            <span className="material-icons text-xl text-slate-400">close</span>
          </button>
        </div>
        <div className="px-6 py-5 grid grid-cols-2 gap-4">
          <Field label="Employee Name" required full>
            <input value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Full name" className={inputCls} />
          </Field>
          <Field label="Employee ID" required>
            <input value={form.employeeNumber || ''} onChange={e => setForm(f => ({ ...f, employeeNumber: e.target.value }))}
              placeholder="e.g. EMP001" className={inputCls} />
          </Field>
          <Field label="Email Address">
            <input type="email" value={form.email || ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="employee@company.com" className={inputCls} />
          </Field>
          <Field label="Mobile Number">
            <input value={form.mobile || ''} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))}
              placeholder="e.g. 9876543210" className={inputCls} />
          </Field>
          <Field label="Department">
            <input list="emp-dept-list" value={form.department || ''} onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
              placeholder="Select or type a department" className={inputCls} />
            <datalist id="emp-dept-list">
              {DEPARTMENTS.map(d => <option key={d} value={d} />)}
            </datalist>
          </Field>
          <Field label="Designation">
            <input value={form.designation || ''} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))}
              placeholder="e.g. Accountant" className={inputCls} />
          </Field>
          <Field label="Shift">
            <input list="emp-shift-list" value={form.shift || ''} onChange={e => setForm(f => ({ ...f, shift: e.target.value }))}
              placeholder="Select or type a shift" className={inputCls} />
            <datalist id="emp-shift-list">
              {SHIFTS.map(s => <option key={s} value={s} />)}
              {form.shift && !SHIFTS.includes(normalizeShiftLabel(form.shift)) && <option value={form.shift} />}
            </datalist>
          </Field>
          <Field label="Monthly Salary (INR)">
            <input type="number" min={0} value={form.monthlySalary ?? 0} onChange={e => setForm(f => ({ ...f, monthlySalary: Number(e.target.value) }))}
              placeholder="0" className={inputCls} />
          </Field>
          <Field label="Shift Start Time">
            <input type="time" value={form.shiftStartTime || ''} onChange={e => setForm(f => ({ ...f, shiftStartTime: e.target.value }))}
              className={inputCls} />
          </Field>
          <Field label="Shift End Time">
            <input type="time" value={form.shiftEndTime || ''} onChange={e => setForm(f => ({ ...f, shiftEndTime: e.target.value }))}
              className={inputCls} />
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as 'Active' | 'Inactive' }))} className={inputCls + ' bg-white'}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </Field>
          <Field label="Eligible for Paid Leaves" full>
            {isItDepartment ? (
              <div className="flex gap-2">
                {(['Yes', 'No'] as const).map(opt => {
                  const val = opt === 'Yes';
                  const active = (form.paidLeavesEligible !== false) === val;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, paidLeavesEligible: val }))}
                      className={clsx('flex-1 border rounded-lg py-2 text-sm font-medium transition-colors',
                        active ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50')}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
                Automatically eligible for 4 paid leaves per month. Sundays are excluded.
              </div>
            )}
          </Field>
          <Field label="Eligible for Overtime" full>
            <div className="flex gap-2">
              {(['Yes', 'No'] as const).map(opt => {
                const val = opt === 'Yes';
                const active = form.overtimeEligible === val;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, overtimeEligible: val }))}
                    className={clsx('flex-1 border rounded-lg py-2 text-sm font-medium transition-colors',
                      active ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50')}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-slate-400">Only employees marked Yes will receive overtime hours, overtime pay, and overtime alerts.</p>
          </Field>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-slate-100 sticky bottom-0 bg-white rounded-b-2xl">
          <button onClick={onClose} className="flex-1 border border-slate-200 rounded-xl py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!form.name?.trim() || !form.employeeNumber?.trim() || isPending}
            className="flex-1 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60 transition-all"
            style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }}
          >
            {isPending ? 'Saving...' : editing ? 'Save Changes' : 'Add Employee'}
          </button>
        </div>
      </div>
    </div>
  );
}
