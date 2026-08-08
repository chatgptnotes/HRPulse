import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';

export interface AuthUser {
  id: number | string;
  email: string;
  name: string;
  role: string;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function authUserFromSupabase(user: { id: string; email?: string; user_metadata?: Record<string, unknown> }): AuthUser {
  const metadata = user.user_metadata || {};
  return {
    id: user.id,
    email: user.email || '',
    name: String(metadata.name || metadata.full_name || user.email || 'HR User'),
    role: metadata.role === 'admin' ? 'admin' : 'hr',
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Supabase persists its own session, so on mount we only have to adopt
  // whatever it already holds and then follow it as it changes.
  useEffect(() => {
    const supabaseClient = supabase;
    if (!supabaseClient) {
      setLoading(false);
      return;
    }
    let mounted = true;
    supabaseClient.auth.getSession()
      .then(({ data }) => {
        if (mounted) setUser(data.session?.user ? authUserFromSupabase(data.session.user) : null);
      })
      .catch(() => {
        if (mounted) setUser(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    const { data: listener } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? authUserFromSupabase(session.user) : null);
      setLoading(false);
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  async function login(email: string, password: string) {
    const supabaseClient = supabase;
    if (!supabaseClient) throw new Error('Supabase is not configured. Restart the frontend after checking .env.');
    const result = await Promise.race([
      supabaseClient.auth.signInWithPassword({ email: email.trim(), password }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Supabase connection timed out. Restart the frontend and try again.')), 15000)),
    ]);
    const { data, error } = result;
    if (error || !data.session) throw error || new Error('Unable to sign in');
    if (data.user) setUser(authUserFromSupabase(data.user));
  }

  function logout() {
    if (supabase) void supabase.auth.signOut();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
