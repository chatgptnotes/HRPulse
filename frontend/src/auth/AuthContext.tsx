import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setAuthToken } from '../api';
import { supabase, supabaseConfigured } from '../lib/supabase';

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

const TOKEN_KEY = 'hrpulse.token';

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

  // On mount, adopt any stored token and confirm it is still valid. A token can
  // be expired or belong to a since-deactivated account, so it is verified
  // against the server rather than trusted because it exists.
  useEffect(() => {
    const supabaseClient = supabase;
    if (supabaseConfigured && supabaseClient) {
      let mounted = true;
      supabaseClient.auth.getSession()
        .then(({ data }) => {
          const token = data.session?.access_token;
          if (token) setAuthToken(token);
          if (mounted) setUser(data.session?.user ? authUserFromSupabase(data.session.user) : null);
        })
        .catch(() => {
          if (mounted) setUser(null);
        })
        .finally(() => {
          if (mounted) setLoading(false);
        });
      const { data: listener } = supabaseClient.auth.onAuthStateChange((_event, session) => {
        setAuthToken(session?.access_token ?? null);
        setUser(session?.user ? authUserFromSupabase(session.user) : null);
        setLoading(false);
      });
      return () => { mounted = false; listener.subscription.unsubscribe(); };
    }

    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      setLoading(false);
      return;
    }

    setAuthToken(stored);
    api.get<AuthUser>('/auth/me')
      .then(res => setUser(res.data))
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setAuthToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const supabaseClient = supabase;
    if (supabaseConfigured && supabaseClient) {
      const result = await Promise.race([
        supabaseClient.auth.signInWithPassword({ email: email.trim(), password }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Supabase connection timed out. Restart the frontend and try again.')), 15000)),
      ]);
      const { data, error } = result;
      if (error || !data.session) throw error || new Error('Unable to sign in');
      setAuthToken(data.session.access_token);
      if (data.user) setUser(authUserFromSupabase(data.user));
      return;
    }
    const res = await api.post<{ token: string; user: AuthUser }>('/auth/login', { email, password });
    localStorage.setItem(TOKEN_KEY, res.data.token);
    setAuthToken(res.data.token);
    setUser(res.data.user);
  }

  function logout() {
    if (supabaseConfigured && supabase) void supabase.auth.signOut();
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken(null);
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

export { TOKEN_KEY };
