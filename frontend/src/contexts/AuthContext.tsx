import { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authConfigured, supabase } from '../lib/supabase';
import { api } from '../api';

export type HrRole = 'super_admin' | 'hr_admin' | 'payroll_admin' | 'viewer';
export type AuthErrorKind = 'server_unavailable' | 'invalid_session' | 'role_required' | 'unknown' | null;

type HrActor = {
  authUserId: string;
  email: string;
  role: HrRole;
  organizationId: string | null;
};

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  actor: HrActor | null;
  error: string;
  errorKind: AuthErrorKind;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  retryActor: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function actorRequestError(err: any): { kind: Exclude<AuthErrorKind, null>; message: string } {
  const status = Number(err?.response?.status || 0);
  const apiError = err?.response?.data?.error;
  const code = String(apiError?.code || '');
  const serverMessage = typeof apiError?.message === 'string'
    ? apiError.message
    : typeof apiError === 'string' ? apiError : '';

  if (!err?.response || [502, 503, 504].includes(status)) {
    return {
      kind: 'server_unavailable',
      message: 'HRPulse server is unavailable. Start the backend, then retry.',
    };
  }
  if (status === 401 || code === 'authentication_required' || code === 'invalid_session') {
    return {
      kind: 'invalid_session',
      message: 'Your HRPulse session is invalid or expired. Please sign in again.',
    };
  }
  if (status === 403 && code === 'hr_role_required') {
    return {
      kind: 'role_required',
      message: serverMessage || 'This account has no active HRPulse role.',
    };
  }
  return {
    kind: 'unknown',
    message: serverMessage || 'HRPulse could not verify this account. Please retry.',
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [actor, setActor] = useState<HrActor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [errorKind, setErrorKind] = useState<AuthErrorKind>(null);

  useEffect(() => {
    if (!authConfigured) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  const loadActor = useCallback(async () => {
    if (!session) {
      setActor(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await api.get('/auth/me');
      setActor(response.data.user);
      setError('');
      setErrorKind(null);
    } catch (err: any) {
      const classified = actorRequestError(err);
      setActor(null);
      setError(classified.message);
      setErrorKind(classified.kind);
      if (classified.kind === 'invalid_session') {
        await supabase.auth.signOut();
      }
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void loadActor();
  }, [loadActor]);

  const value = useMemo<AuthContextValue>(() => ({
    configured: authConfigured,
    loading,
    session,
    actor,
    error,
    errorKind,
    signIn: async (email, password) => {
      setError('');
      setErrorKind(null);
      const result = await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
    },
    signOut: async () => {
      await supabase.auth.signOut();
      setActor(null);
    },
    retryActor: loadActor,
  }), [actor, error, errorKind, loadActor, loading, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
