import { FormEvent, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await auth.signIn(email.trim(), password);
    } catch (err: any) {
      setError(err?.message || 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  };

  const retry = async () => {
    setRetrying(true);
    setError('');
    try {
      await auth.retryActor();
    } finally {
      setRetrying(false);
    }
  };

  if (!auth.configured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
        <div className="max-w-lg rounded-3xl border border-amber-400/30 bg-slate-900 p-8 text-white shadow-2xl">
          <h1 className="text-xl font-bold">HRPulse authentication is not configured</h1>
          <p className="mt-3 text-sm text-slate-300">
            Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, create a Supabase Auth user,
            and set that email as <code>HRPULSE_BOOTSTRAP_ADMIN_EMAIL</code> on the backend.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 p-6">
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-white/10 bg-white p-8 shadow-2xl">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white">
          <span className="material-icons">corporate_fare</span>
        </div>
        <h1 className="mt-5 text-2xl font-black text-slate-950">Sign in to HRPulse</h1>
        <p className="mt-1 text-sm text-slate-500">Payroll, leave, documents, and integrations require an authorized HR account.</p>
        <label className="mt-6 block text-xs font-bold uppercase tracking-wide text-slate-500">Email</label>
        <input
          type="email"
          value={email}
          onChange={event => setEmail(event.target.value)}
          required
          className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
        />
        <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-500">Password</label>
        <input
          type="password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          required
          className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
        />
        {(error || auth.error) && (
          <div
            role="alert"
            className={`mt-4 rounded-xl p-3 text-sm ${
              auth.errorKind === 'server_unavailable'
                ? 'bg-amber-50 text-amber-800'
                : 'bg-rose-50 text-rose-700'
            }`}
          >
            <p>{error || auth.error}</p>
            {auth.session && auth.error && (
              <button
                type="button"
                onClick={retry}
                disabled={retrying || auth.loading}
                className="mt-3 rounded-lg border border-current/20 bg-white px-3 py-2 text-xs font-bold transition hover:bg-white/70 disabled:opacity-50"
              >
                {retrying || auth.loading ? 'Checking HRPulseâ€¦' : 'Retry HRPulse'}
              </button>
            )}
          </div>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="mt-6 h-11 w-full rounded-xl bg-indigo-600 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
