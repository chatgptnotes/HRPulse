/**
 * Sidebar — responsive navigation shell.
 *  - Mobile  (<768px):  slide-out drawer — animated, backdrop, close button,
 *                       swipe-to-close, scroll-locked body.
 *  - Tablet  (768–1199): collapsed icon rail with tooltips.
 *  - Desktop (≥1200px):  full sidebar; collapse toggle preserved.
 * The `collapsed` prop remains the single source of truth so existing
 * behaviour (toggle button) keeps working unchanged.
 */
import { useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../../auth/AuthContext';

const links = [
  { to: '/', label: 'Dispatcher', icon: 'send', end: true },
  { to: '/analytics', label: 'Analytics', icon: 'bar_chart', end: false },
  { to: '/employees', label: 'Employees', icon: 'people', end: false },
  { to: '/salary', label: 'Salary / Loss of Pay', icon: 'payments', end: false },
  { to: '/history', label: 'Email History', icon: 'history', end: false },
  { to: '/rules', label: 'Rules', icon: 'rule', end: false },
  { to: '/sops', label: 'SOPs', icon: 'description', end: false },
];

const adminLinks = [
  { to: '/rules-engine', label: 'Rules Engine', icon: 'settings_suggest', end: false },
];

const bottomLinks = [
  { to: '/settings', label: 'Settings', icon: 'settings', end: false },
];

interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: Props) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const touchStartX = useRef<number | null>(null);
  // Skips the first render of the close-on-navigate effect below.
  const firstRender = useRef(true);

  // Close the drawer automatically after navigating on mobile.
  useEffect(() => {
    // Skip mount so the drawer is never toggled on first render.
    if (firstRender.current) { firstRender.current = false; return; }
    if (window.innerWidth < 768 && !collapsed) onToggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    const mobileOpen = !collapsed && window.innerWidth < 768;
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [collapsed]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    // Swiping right-to-left across the drawer closes it.
    if (touchStartX.current - e.touches[0].clientX > 60) {
      touchStartX.current = null;
      onToggle();
    }
  };

  const navLink = (l: (typeof links)[number], section?: string) => (
    <NavLink
      key={`${section ?? 'main'}-${l.to}`}
      to={l.to}
      end={l.end}
      title={collapsed ? l.label : undefined}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group min-h-[44px]',
          collapsed && 'justify-center px-2',
          isActive
            ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/30 relative overflow-hidden'
            : 'text-slate-400 hover:bg-white/5 hover:text-slate-100',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span className={clsx('material-icons text-xl flex-shrink-0 transition-transform', isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200')}>{l.icon}</span>
          {!collapsed && <span className="truncate">{l.label}</span>}
        </>
      )}
    </NavLink>
  );

  return (
    <>
      {/* Mobile backdrop — drawer open on phones only */}
      {!collapsed && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] transition-opacity duration-200 sm:hidden"
          onClick={onToggle}
          aria-hidden="true"
        />
      )}

      <aside
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        className={clsx(
          'flex flex-col bg-gradient-to-b from-[#081329] to-[#0a1933] transition-all duration-300 ease-out flex-shrink-0 shadow-2xl',
          // Desktop/tablet widths; tablet (768–1199) shows the icon rail via CSS.
          collapsed ? 'w-12' : 'w-64 md:w-[76px] lg:w-64',
          // Mobile: fixed slide-out drawer, hidden when collapsed.
          'max-sm:fixed max-sm:inset-y-0 max-sm:left-0 max-sm:top-0 max-sm:z-50 max-sm:h-full max-sm:w-[280px] sm:min-h-screen',
          collapsed && 'max-sm:-translate-x-full max-sm:shadow-none',
        )}
      >
        {/* Logo + close */}
        <div className={clsx('flex items-center h-16 border-b border-white/10', collapsed ? 'justify-center px-2' : 'px-5 gap-3 max-sm:justify-between max-sm:gap-2')}>
          {!collapsed && (
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-purple-500/30">
                <span className="material-icons text-white text-lg">corporate_fare</span>
              </div>
              <div className="min-w-0 max-sm:hidden md:hidden lg:block">
                <div className="font-bold text-white text-base leading-tight">HRPulse</div>
                <div className="text-xs text-slate-400">Premium HR Suite</div>
              </div>
            </div>
          )}
          {collapsed && (
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/30">
              <span className="material-icons text-white text-lg">corporate_fare</span>
            </div>
          )}
          {/* Desktop collapse toggle / mobile close button */}
          <button
            onClick={onToggle}
            aria-label={collapsed ? 'Open menu' : 'Close menu'}
            className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors flex-shrink-0"
          >
            <span className="material-icons text-lg max-sm:hidden">{collapsed ? 'menu' : 'chevron_left'}</span>
            <span className="material-icons text-lg sm:hidden">close</span>
          </button>
        </div>

        {collapsed && (
          <button
            onClick={onToggle}
            className="mx-auto mt-2 p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <span className="material-icons text-lg">menu</span>
          </button>
        )}

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {!collapsed && (
            <p className="block text-xs font-semibold text-slate-500 uppercase tracking-widest px-3 pb-2 max-sm:hidden md:hidden lg:block">Main Menu</p>
          )}
          {links.map((l) => navLink(l))}
          {user?.role === 'admin' && (
            <>
              {!collapsed && (
                <p className="block text-xs font-semibold text-slate-500 uppercase tracking-widest px-3 pb-2 pt-4 max-sm:hidden md:hidden lg:block">Administration</p>
              )}
              {adminLinks.map((l) => navLink(l, 'admin'))}
            </>
          )}
        </nav>

        {/* Bottom */}
        <div className="px-3 pb-4 border-t border-white/10 pt-3 space-y-1">
          {bottomLinks.map((l) => navLink(l, 'bottom'))}
          {!collapsed && (
            <div className="flex px-3 pt-3 items-center gap-2 max-sm:hidden md:hidden lg:flex">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-lg shadow-emerald-400/50" />
              <span className="text-xs text-slate-400">System Online</span>
            </div>
          )}
          <div className="mt-auto pt-4 border-t border-white/10">
            {!collapsed && user && (
              <div className="flex px-3 pb-3 items-center gap-3 max-sm:hidden md:hidden lg:flex">
                <div className="h-9 w-9 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white text-sm font-semibold shadow-lg shadow-purple-500/30">
                  {user.name ? user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : 'U'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{user.name}</p>
                  <p className="truncate text-xs text-slate-400">Administrator</p>
                </div>
              </div>
            )}
            <button
              onClick={logout}
              title={collapsed ? 'Sign out' : undefined}
              className={clsx(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 transition-all hover:bg-white/10 hover:text-slate-100 min-h-[44px]',
                collapsed && 'justify-center px-2',
              )}
            >
              <span className="material-icons text-xl flex-shrink-0">logout</span>
              {!collapsed && <span>Sign out</span>}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}