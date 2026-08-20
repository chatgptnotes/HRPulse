/**
 * MobileNav — bottom navigation bar for phones (<768px).
 * Dashboard / Employees / Dispatcher / Payroll + "More" sheet holding the
 * remaining routes. Hidden from sm up, where the sidebar takes over.
 */
import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../../auth/AuthContext';

const primary = [
  { to: '/', label: 'Home', icon: 'dashboard', end: true },
  { to: '/employees', label: 'Staff', icon: 'people', end: false },
  { to: '/', label: 'Dispatch', icon: 'send', end: false, key: 'dispatch' },
  { to: '/salary', label: 'Payroll', icon: 'payments', end: false },
];

export default function MobileNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const { user } = useAuth();
  const location = useLocation();

  const more = [
    { to: '/analytics', label: 'Analytics', icon: 'bar_chart' },
    { to: '/rules', label: 'Rules', icon: 'rule' },
    { to: '/sops', label: 'SOPs', icon: 'description' },
    ...(user?.role === 'admin' ? [{ to: '/rules-engine', label: 'Rules Engine', icon: 'settings_suggest' }] : []),
    { to: '/settings', label: 'Settings', icon: 'settings' },
  ];
  const moreActive = more.some((m) => location.pathname.startsWith(m.to) && m.to !== '/');

  return (
    <>
      {/* More sheet */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 sm:hidden" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-[20px] bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: 'hrSheetUp .22s ease-out' }}
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[#E5E7EB]" />
            <div className="grid grid-cols-3 gap-3">
              {more.map((m) => (
                <NavLink
                  key={m.to}
                  to={m.to}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) => clsx(
                    'flex flex-col items-center gap-1.5 rounded-[12px] border p-3 text-[11px] font-medium transition',
                    isActive
                      ? 'border-[#2563EB]/30 bg-[#EFF6FF] text-[#2563EB]'
                      : 'border-[#E5E7EB] bg-white text-[#6B7280] hover:bg-[#F8FAFC]',
                  )}
                >
                  <span className="material-icons text-[22px]">{m.icon}</span>
                  {m.label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#E5E7EB] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden">
        <div className="grid grid-cols-5">
          {primary.map((item) =>
            item.key === 'dispatch' ? (
              // Centre action — goes to the same dashboard upload focus.
              <NavLink
                key="dispatch"
                to="/"
                end
                onClick={() => setMoreOpen(false)}
                className="flex flex-col items-center justify-center gap-0.5 py-2 text-[10.5px] font-medium text-[#6B7280]"
              >
                <span className="-mt-4 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] text-white shadow-lg shadow-[#2563EB]/30">
                  <span className="material-icons text-[24px]">send</span>
                </span>
                Dispatch
              </NavLink>
            ) : (
              <NavLink
                key={item.key ?? item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  clsx(
                    'flex flex-col items-center justify-center gap-0.5 py-2 text-[10.5px] font-medium transition-colors min-h-[56px]',
                    isActive ? 'text-[#2563EB]' : 'text-[#6B7280]',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={clsx('material-icons text-[22px] leading-none', isActive && 'font-bold')}>{item.icon}</span>
                    {item.label}
                  </>
                )}
              </NavLink>
            ),
          )}
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className={clsx(
              'flex min-h-[56px] flex-col items-center justify-center gap-0.5 py-2 text-[10.5px] font-medium transition-colors',
              moreActive || moreOpen ? 'text-[#2563EB]' : 'text-[#6B7280]',
            )}
          >
            <span className="material-icons text-[22px] leading-none">apps</span>
            More
          </button>
        </div>
      </nav>
    </>
  );
}
