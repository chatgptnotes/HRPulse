import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setAuthToken } from '../api';

export interface AuthUser {
  id: number;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount, adopt any stored token and confirm it is still valid. A token can
  // be expired or belong to a since-deactivated account, so it is verified
  // against the server rather than trusted because it exists.
  useEffect(() => {
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
    const res = await api.post<{ token: string; user: AuthUser }>('/auth/login', { email, password });
    localStorage.setItem(TOKEN_KEY, res.data.token);
    setAuthToken(res.data.token);
    setUser(res.data.user);
  }

  function logout() {
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
