import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function ProfilePage() {
  const { user } = useAuth();
  const initials = (user?.name || 'HR').slice(0, 2).toUpperCase();

  return (
    <section className="min-h-screen bg-[#F8FAFC] p-4 sm:p-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-5 flex items-center gap-3">
          <Link to="/" aria-label="Back to dashboard" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
            <span className="material-icons text-[20px]">arrow_back</span>
          </Link>
          <div><p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">Account</p><h1 className="text-xl font-bold text-slate-800">My Profile</h1></div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-white p-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-lg font-bold text-white">{initials}</div>
            <div className="min-w-0"><h2 className="truncate text-lg font-bold text-slate-800">{user?.name || 'HR User'}</h2><p className="truncate text-sm text-slate-500">{user?.role === 'admin' ? 'Super Admin' : 'HR User'}</p></div>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-6">
            {[
              ['Full name', user?.name || 'HR User'],
              ['Email address', user?.email || '—'],
              ['Role', user?.role || 'HR'],
              ['User ID', user?.id || '—'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 break-words text-sm font-medium capitalize text-slate-700">{value}</p></div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
