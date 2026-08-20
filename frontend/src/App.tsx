import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './auth/AuthContext';
import LoginPage from './pages/LoginPage';
import Sidebar from './components/layout/Sidebar';
import LandingPage from './pages/LandingPage';
import Dashboard from './pages/Dashboard';
import SalaryPage from './pages/SalaryPage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import EmployeesPage from './pages/EmployeesPage';
import RulesPage from './pages/RulesPage';
import SopsPage from './pages/SopsPage';
import RulesEngineDashboard from './pages/RulesEngineDashboard';
import ProfilePage from './pages/ProfilePage';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });

const PAGE_TITLES: Array<[string, string]> = [
  ['/', 'Dispatcher'],
  ['/analytics', 'Analytics'],
  ['/employees', 'Employees'],
  ['/salary', 'Salary / LOP'],
  ['/history', 'Email History'],
  ['/rules', 'Rules'],
  ['/sops', 'SOPs'],
  ['/rules-engine', 'Rules Engine'],
  ['/settings', 'Settings'],
];

function MobileTopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const location = useLocation();
  const title = PAGE_TITLES.find(([p]) => (p === '/' ? location.pathname === '/' : location.pathname.startsWith(p)))?.[1] ?? 'HRPulse';
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-[#E5E7EB] bg-white/90 px-3 backdrop-blur-md sm:hidden">
      <button
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="flex h-10 w-10 items-center justify-center rounded-xl text-[#111827] transition-colors hover:bg-[#F3F4F6]"
      >
        <span className="material-icons text-[22px]">menu</span>
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold leading-tight text-[#111827]">{title}</p>
        <p className="text-[11px] leading-tight text-[#6B7280]">HRPulse</p>
      </div>
      <Link to="/profile" aria-label="Open profile" className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-[11px] font-bold text-white transition-transform hover:scale-105">HR</Link>
    </header>
  );
}

function AppShell() {
  // Start with the drawer closed on phones, open on larger screens.
  const [collapsed, setCollapsed] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? true : false,
  );
  const { user } = useAuth();
  const openMenu = () => setCollapsed(false);

  // Keep the drawer state sensible across resizes crossing the 768px line.
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 768) setCollapsed(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="flex min-h-screen bg-[#F8FAFC]">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar onOpenMenu={openMenu} />
        <main className="min-w-0 flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1920px]">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/salary" element={<SalaryPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/employees" element={<EmployeesPage />} />
              <Route path="/rules" element={<RulesPage />} />
              <Route path="/sops" element={<SopsPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route
                path="/rules-engine"
                element={
                  user?.role === 'admin' ? <RulesEngineDashboard /> : <Navigate to="/" replace />
                }
              />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * Gate everything behind a session. While the stored token is being verified we
 * render nothing rather than the app — showing the shell first would fire a
 * burst of API calls that all 401 and bounce the user straight back out.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC]">
        <p className="text-sm text-[#6B7280]">Loading…</p>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/**
 * Gate admin-only pages behind role check
 */
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC]">
        <p className="text-sm text-[#6B7280]">Loading…</p>
      </div>
    );
  }

  if (!user || user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/landing" element={<LandingPage />} />
            <Route path="/*" element={<RequireAuth><AppShell /></RequireAuth>} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
