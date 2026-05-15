import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getEmployees, updateEmployee, uploadEmployeePhoto } from '../api';

interface Employee {
  id: number;
  name: string;
  email: string;
  department: string | null;
  employeeId: string | null;
  photoUrl: string | null;
  createdAt: string;
}

interface EditForm {
  name: string;
  email: string;
  department: string;
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

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: () => getEmployees().then(r => r.data),
  });

  const mutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EditForm }) => updateEmployee(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); setEditing(null); },
  });

  const filtered = employees.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.email.toLowerCase().includes(search.toLowerCase()) ||
    (e.department || '').toLowerCase().includes(search.toLowerCase())
  );

  function openEdit(emp: Employee) {
    setEditing(emp);
    setForm({ name: emp.name, email: emp.email, department: emp.department || '' });
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
    <div className="p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Employees</h1>
          <p className="text-slate-500 text-sm mt-1">{employees.length} employees synced from attendance uploads</p>
        </div>
        <div className="relative">
          <span className="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-base pointer-events-none">search</span>
          <input
            type="text"
            placeholder="Search employees..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 bg-white shadow-sm"
          />
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
            <div key={emp.id} className="bg-white rounded-2xl border border-slate-200/70 shadow-sm hover:shadow-md hover:border-slate-300 transition-all p-5 group">
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
                <button
                  onClick={() => openEdit(emp)}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <span className="material-icons text-lg">edit</span>
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {emp.department && (
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
