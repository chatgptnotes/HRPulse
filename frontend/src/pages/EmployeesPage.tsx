import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getEmployees, updateEmployee, uploadEmployeePhoto, mergeEmployees, getShiftOptions, getEmployeeShiftAssignments, saveEmployeeShiftAssignment, type EmployeeShiftAssignment, type ShiftOption } from '../api';

interface Employee {
  id: number;
  name: string;
  email: string;
  department: string | null;
  organisation: string | null;
  entity: string | null;
  employeeId: string | null;
  photoUrl: string | null;
  createdAt: string;
}

interface EditForm {
  name: string;
  email: string;
  department: string;
}

interface WorkTimeForm {
  shiftId: string;
  name: string;
  roleTarget: string;
  startTime: string;
  endTime: string;
  graceMinutes: string;
  isOvernight: boolean;
  effectiveFrom: string;
  effectiveTo: string;
}

const AVATAR_COLORS = [
  'from-indigo-400 to-purple-500',
  'from-emerald-400 to-teal-500',
  'from-rose-400 to-pink-500',
  'from-amber-400 to-orange-500',
  'from-sky-400 to-blue-500',
  'from-violet-400 to-purple-500',
];

export default function EmployeesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<EditForm>({ name: '', email: '', department: '' });
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhotoFor, setUploadingPhotoFor] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [mergeKeepId, setMergeKeepId] = useState<number | null>(null);
  const [mergeError, setMergeError] = useState('');
  const [workTimeEmployee, setWorkTimeEmployee] = useState<Employee | null>(null);
  const [workTimeMode, setWorkTimeMode] = useState<'existing' | 'custom'>('existing');
  const [workTimeError, setWorkTimeError] = useState('');
  const [workTimeForm, setWorkTimeForm] = useState<WorkTimeForm>({ shiftId: '', name: '', roleTarget: 'GENERAL', startTime: '09:00', endTime: '18:00', graceMinutes: '15', isOvernight: false, effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: '' });

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: () => getEmployees().then(r => r.data),
  });

  const mutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EditForm }) => updateEmployee(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); setEditing(null); },
  });

  const searchText = search.trim().toLowerCase();
  const filtered = employees.filter(e => {
    const searchable = [e.name, e.email, e.department, e.organisation, e.entity]
      .map(value => String(value || '').toLowerCase())
      .join(' ');
    return !searchText || searchable.includes(searchText);
  });

  const { data: shiftOptions = [] } = useQuery<ShiftOption[]>({ queryKey: ['shift-options'], queryFn: () => getShiftOptions().then(r => r.data), enabled: !!workTimeEmployee });
  const { data: assignments = [], isLoading: assignmentsLoading } = useQuery<EmployeeShiftAssignment[]>({ queryKey: ['employee-shifts', workTimeEmployee?.id], queryFn: () => getEmployeeShiftAssignments(workTimeEmployee!.id).then(r => r.data), enabled: !!workTimeEmployee });
  const mergeMutation = useMutation({
    mutationFn: () => mergeEmployees(mergeKeepId!, selectedIds.find(id => id !== mergeKeepId)!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['salary-configs'] });
      qc.invalidateQueries({ queryKey: ['deductions'] });
      setSelectedIds([]); setMergeKeepId(null); setMergeError('');
    },
    onError: (error: any) => setMergeError(error.message || 'Employees could not be merged.'),
  });
  const workTimeMutation = useMutation({
    mutationFn: () => {
      if (!workTimeEmployee) throw new Error('Employee not selected');
      if (workTimeMode === 'existing' && !workTimeForm.shiftId) throw new Error('Select a shift');
      if (workTimeMode === 'custom' && !workTimeForm.name.trim()) throw new Error('Custom shift name is required');
      if (workTimeForm.effectiveTo && workTimeForm.effectiveTo < workTimeForm.effectiveFrom) throw new Error('End date must be on or after start date');
      return saveEmployeeShiftAssignment(workTimeEmployee.id, {
        shiftId: workTimeMode === 'existing' ? workTimeForm.shiftId : undefined,
        effectiveFrom: workTimeForm.effectiveFrom,
        effectiveTo: workTimeForm.effectiveTo || undefined,
        customShift: workTimeMode === 'custom' ? { name: workTimeForm.name.trim(), roleTarget: workTimeForm.roleTarget.trim().toUpperCase() || 'GENERAL', startTime: workTimeForm.startTime, endTime: workTimeForm.endTime, graceMinutes: Number(workTimeForm.graceMinutes), isOvernight: workTimeForm.isOvernight } : undefined,
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employee-shifts', workTimeEmployee?.id] }); setWorkTimeError(''); setWorkTimeMode('existing'); },
    onError: (error: any) => setWorkTimeError(error.message || 'Work time could not be saved.'),
  });

  function employeeType(emp: Employee) {
    const value = `${emp.organisation || ''} ${emp.entity || ''} ${emp.department || ''}`.toLowerCase();
    if (value.includes('ayushman')) return { label: 'Ayushman', className: 'bg-violet-50 text-violet-700 border-violet-100' };
    if (value.includes('hope')) return { label: 'Hope', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' };
    if (value.includes('rafttar')) return { label: 'Rafttar', className: 'bg-amber-50 text-amber-700 border-amber-100' };
    if (/(^|[^a-z])it([^a-z]|$)|information technology/.test(value)) return { label: 'IT', className: 'bg-sky-50 text-sky-700 border-sky-100' };
    return { label: 'Unassigned', className: 'bg-slate-50 text-slate-500 border-slate-200' };
  }

  function openEdit(emp: Employee) {
    setEditing(emp);
    setForm({ name: emp.name, email: emp.email, department: emp.department || '' });
  }

  function openWorkTimes(emp: Employee) {
    setWorkTimeEmployee(emp);
    setWorkTimeError('');
    setWorkTimeMode('existing');
    setWorkTimeForm({ shiftId: '', name: `${emp.name} custom`, roleTarget: 'GENERAL', startTime: '09:00', endTime: '18:00', graceMinutes: '15', isOvernight: false, effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: '' });
  }

  async function handlePhotoUpload(empId: number, file: File) {
    setUploadingPhotoFor(empId);
    try {
      await uploadEmployeePhoto(empId, file);
      qc.invalidateQueries({ queryKey: ['employees'] });
    } finally {
      setUploadingPhotoFor(null);
    }
  }

  return (
    <div className="w-full min-w-0 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Employees</h1>
          <p className="text-slate-500 text-sm mt-1">{employees.length} employees synced from attendance uploads</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedIds.length === 2 && (
            <button onClick={() => { setMergeKeepId(selectedIds[0]); setMergeError(''); }} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
              <span className="material-icons text-base">merge</span> Merge Names
            </button>
          )}
          <div className="relative">
          <span className="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-base pointer-events-none">search</span>
          <input
            type="text"
            placeholder="Search employees..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          className="border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 bg-white shadow-sm"
          />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-12 text-center text-slate-400">
          <span className="material-icons animate-spin text-4xl block mb-2 text-indigo-400">sync</span>
          Loading employees...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-12 text-center text-slate-400">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-3">
            <span className="material-icons text-3xl text-slate-300">people</span>
          </div>
          <p className="font-medium text-slate-500">{search ? 'No employees match your search.' : 'No employees yet. Upload attendance data first.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((emp, i) => (
            <div key={emp.id} className="relative bg-white rounded-2xl border border-slate-200/70 shadow-sm hover:shadow-md hover:border-slate-300 transition-all p-5 group">
              <label className="absolute ml-1 mt-1 z-10 cursor-pointer">
                <input type="checkbox" checked={selectedIds.includes(emp.id)} onChange={() => setSelectedIds(ids => ids.includes(emp.id) ? ids.filter(id => id !== emp.id) : ids.length < 2 ? [...ids, emp.id] : ids)} className="h-4 w-4 accent-indigo-600" />
              </label>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative group/avatar flex-shrink-0">
                    {emp.photoUrl ? (
                      <img
                        src={emp.photoUrl}
                        alt={emp.name}
                        className="w-11 h-11 rounded-xl object-cover shadow-sm"
                      />
                    ) : (
                      <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${AVATAR_COLORS[i % AVATAR_COLORS.length]} flex items-center justify-center shadow-sm`}>
                        <span className="text-white text-sm font-bold">{emp.name.charAt(0).toUpperCase()}</span>
                      </div>
                    )}
                    <button
                      onClick={() => { setUploadingPhotoFor(emp.id); photoInputRef.current?.click(); }}
                      className="absolute inset-0 rounded-xl bg-black/50 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity"
                      title="Upload photo"
                    >
                      {uploadingPhotoFor === emp.id
                        ? <span className="material-icons text-white text-sm animate-spin">sync</span>
                        : <span className="material-icons text-white text-sm">photo_camera</span>
                      }
                    </button>
                    <input
                      ref={uploadingPhotoFor === emp.id ? photoInputRef : undefined}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => { if (e.target.files?.[0]) handlePhotoUpload(emp.id, e.target.files[0]); }}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 text-sm truncate">{emp.name}</p>
                    <p className="text-xs text-slate-400 truncate">{emp.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openWorkTimes(emp)} title="Customize work times" className="p-1.5 rounded-lg text-slate-300 hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
                    <span className="material-icons text-lg">schedule</span>
                  </button>
                  <button onClick={() => openEdit(emp)} title="Edit employee" className="p-1.5 rounded-lg text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
                    <span className="material-icons text-lg">edit</span>
                  </button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {(() => {
                  const type = employeeType(emp);
                  return (
                    <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border font-semibold ${type.className}`}>
                      <span className="material-icons text-xs">business</span>
                      {type.label}
                    </span>
                  );
                })()}
                {emp.department && !['ayushman', 'hope', 'it'].includes(emp.department.trim().toLowerCase()) && (
                  <span className="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-lg border border-indigo-100 font-medium">
                    <span className="material-icons text-xs">business</span>
                    {emp.department}
                  </span>
                )}
                {emp.employeeId && (
                  <span className="text-xs bg-slate-100 text-slate-500 px-2.5 py-1 rounded-lg font-mono border border-slate-200">
                    #{emp.employeeId}
                  </span>
                )}
                <span className="text-xs bg-slate-50 text-slate-400 px-2.5 py-1 rounded-lg border border-slate-100">
                  {new Date(emp.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {mergeKeepId !== null && selectedIds.length === 2 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-800">Merge employee names</h3>
            <p className="mt-1 text-sm text-slate-500">Choose the name to keep. Attendance and salary data from the other employee will be moved here.</p>
            <div className="mt-4 space-y-2">
              {selectedIds.map(id => {
                const employee = employees.find(item => item.id === id);
                return <label key={id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50"><input type="radio" name="mergeKeep" checked={mergeKeepId === id} onChange={() => setMergeKeepId(id)} /><span className="font-medium text-slate-700">{employee?.name}</span></label>;
              })}
            </div>
            {mergeError && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-600">{mergeError}</p>}
            <div className="mt-5 flex justify-end gap-2"><button onClick={() => { setMergeKeepId(null); setMergeError(''); }} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600">Cancel</button><button onClick={() => mergeMutation.mutate()} disabled={mergeMutation.isPending} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{mergeMutation.isPending ? 'Merging...' : 'Merge'}</button></div>
          </div>
        </div>
      )}

      {workTimeEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">Employee schedule</p>
                <h3 className="mt-1 text-lg font-bold text-slate-800">Customize {workTimeEmployee.name}</h3>
                <p className="mt-1 text-xs text-slate-400">New assignments apply from the effective date.</p>
              </div>
              <button onClick={() => setWorkTimeEmployee(null)} className="rounded-lg p-1.5 hover:bg-slate-100"><span className="material-icons text-xl text-slate-400">close</span></button>
            </div>
            <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
              <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
                {([['existing', 'Use saved shift'], ['custom', 'Create custom time']] as const).map(([value, label]) => (
                  <button key={value} onClick={() => setWorkTimeMode(value)} className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors active:scale-[0.98] ${workTimeMode === value ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>{label}</button>
                ))}
              </div>

              {workTimeMode === 'existing' ? (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">Shift</span>
                  <select value={workTimeForm.shiftId} onChange={e => setWorkTimeForm(prev => ({ ...prev, shiftId: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20">
                    <option value="">Select a shift</option>
                    {shiftOptions.map(shift => <option key={shift.id} value={shift.id}>{shift.name} · {shift.startTime}–{shift.endTime}</option>)}
                  </select>
                  {!shiftOptions.length && <span className="mt-1 block text-xs text-amber-600">No saved shifts are available. Create a custom time instead.</span>}
                </label>
              ) : (
                <div className="space-y-4">
                  <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">Shift name</span><input value={workTimeForm.name} onChange={e => setWorkTimeForm(prev => ({ ...prev, name: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-emerald-400" placeholder="e.g. Front desk morning" /></label>
                  <div className="grid grid-cols-2 gap-3">
                    <label><span className="mb-1.5 block text-sm font-medium text-slate-700">Start time</span><input type="time" value={workTimeForm.startTime} onChange={e => setWorkTimeForm(prev => ({ ...prev, startTime: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm" /></label>
                    <label><span className="mb-1.5 block text-sm font-medium text-slate-700">End time</span><input type="time" value={workTimeForm.endTime} onChange={e => setWorkTimeForm(prev => ({ ...prev, endTime: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm" /></label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label><span className="mb-1.5 block text-sm font-medium text-slate-700">Role target</span><input value={workTimeForm.roleTarget} onChange={e => setWorkTimeForm(prev => ({ ...prev, roleTarget: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm" /></label>
                    <label><span className="mb-1.5 block text-sm font-medium text-slate-700">Grace minutes</span><input type="number" min="0" max="240" value={workTimeForm.graceMinutes} onChange={e => setWorkTimeForm(prev => ({ ...prev, graceMinutes: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm" /></label>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={workTimeForm.isOvernight} onChange={e => setWorkTimeForm(prev => ({ ...prev, isOvernight: e.target.checked }))} className="h-4 w-4 accent-emerald-600" /> Overnight shift</label>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label><span className="mb-1.5 block text-sm font-medium text-slate-700">Effective from</span><input type="date" value={workTimeForm.effectiveFrom} onChange={e => setWorkTimeForm(prev => ({ ...prev, effectiveFrom: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm" /></label>
                <label><span className="mb-1.5 block text-sm font-medium text-slate-700">Effective to <span className="font-normal text-slate-400">(optional)</span></span><input type="date" value={workTimeForm.effectiveTo} onChange={e => setWorkTimeForm(prev => ({ ...prev, effectiveTo: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm" /></label>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold text-slate-700">Schedule history</p>{assignmentsLoading && <span className="text-xs text-slate-400">Loading...</span>}</div>
                {assignments.length ? <div className="space-y-2">{assignments.map(assignment => <div key={assignment.assignmentId} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5"><div><p className="text-xs font-semibold text-slate-700">{assignment.name}</p><p className="text-[11px] text-slate-400">{assignment.startTime}–{assignment.endTime} · from {assignment.effectiveFrom}{assignment.effectiveTo ? ` to ${assignment.effectiveTo}` : ' · current'}</p></div><span className="material-icons text-base text-emerald-500">schedule</span></div>)}</div> : <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">No schedule assigned yet.</p>}
              </div>
              {workTimeError && <p className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-600">{workTimeError}</p>}
            </div>
            <div className="flex gap-3 border-t border-slate-100 px-6 py-4"><button onClick={() => setWorkTimeEmployee(null)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600">Close</button><button onClick={() => workTimeMutation.mutate()} disabled={workTimeMutation.isPending} className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60">{workTimeMutation.isPending ? 'Saving...' : 'Save work time'}</button></div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${AVATAR_COLORS[0]} flex items-center justify-center overflow-hidden`}>
                  {editing.photoUrl
                    ? <img src={editing.photoUrl} alt={editing.name} className="w-full h-full object-cover" />
                    : <span className="text-white text-sm font-bold">{editing.name.charAt(0)}</span>
                  }
                </div>
                <h3 className="text-base font-bold text-slate-800">Edit Employee</h3>
              </div>
              <button onClick={() => setEditing(null)} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                <span className="material-icons text-xl text-slate-400">close</span>
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {[
                { label: 'Name', key: 'name', type: 'text', placeholder: 'Full name' },
                { label: 'Email', key: 'email', type: 'email', placeholder: 'work@company.com' },
                { label: 'Department', key: 'department', type: 'text', placeholder: 'e.g. Finance, Operations' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{f.label}</label>
                  <input
                    type={f.type}
                    value={form[f.key as keyof EditForm]}
                    onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 bg-slate-50"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
              <button
                onClick={() => setEditing(null)}
                className="flex-1 border border-slate-200 rounded-xl py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => mutation.mutate({ id: editing.id, data: form })}
                disabled={mutation.isPending}
                className="flex-1 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60 transition-all"
                style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }}
              >
                {mutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
