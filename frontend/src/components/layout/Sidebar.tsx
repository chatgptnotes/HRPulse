import { NavLink } from 'react-router-dom';
import clsx from 'clsx';

const links = [
  { to: '/', label: 'Dispatcher', icon: 'send', end: true },
  { to: '/analytics', label: 'Analytics', icon: 'bar_chart', end: false },
  { to: '/employees', label: 'Employees', icon: 'people', end: false },
  { to: '/salary', label: 'Salary / LOP', icon: 'payments', end: false },
  { to: '/history', label: 'Email History', icon: 'history', end: false },
  { to: '/rules', label: 'Rules', icon: 'rule', end: false },
  { to: '/sops', label: 'SOPs', icon: 'description', end: false },
  { to: '/ai', label: 'AI Insights', icon: 'psychology', end: false },
];

const bottomLinks = [
  { to: '/settings', label: 'Settings', icon: 'settings', end: false },
];

interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: Props) {
  return (
    <aside
      className={clsx(
        'flex flex-col min-h-screen bg-slate-900 transition-all duration-200 flex-shrink-0',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* Logo */}
      <div className={clsx('flex items-center h-16 border-b border-slate-800', collapsed ? 'justify-center px-2' : 'px-5 gap-3')}>
        {!collapsed && (
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <span className="material-icons text-white text-base">corporate_fare</span>
            </div>
            <div className="min-w-0">
              <div className="font-bold text-white text-sm leading-tight">HRPulse</div>
              <div className="text-xs text-slate-400">Attendance AI</div>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <span className="material-icons text-white text-base">corporate_fare</span>
          </div>
        )}
        {!collapsed && (
          <button
            onClick={onToggle}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors flex-shrink-0"
          >
            <span className="material-icons text-lg">chevron_left</span>
          </button>
        )}
      </div>

      {collapsed && (
        <button
          onClick={onToggle}
          className="mx-auto mt-2 p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <span className="material-icons text-lg">menu</span>
        </button>
      )}

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 space-y-0.5">
        {!collapsed && (
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest px-2 pb-2">Menu</p>
        )}
        {links.map(l => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            title={collapsed ? l.label : undefined}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group',
                collapsed && 'justify-center px-2',
                isActive
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/50'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
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
        ))}
      </nav>

      {/* Bottom */}
      <div className="px-3 pb-4 border-t border-slate-800 pt-3 space-y-0.5">
        {bottomLinks.map(l => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            title={collapsed ? l.label : undefined}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group',
                collapsed && 'justify-center px-2',
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className={clsx('material-icons text-xl flex-shrink-0', isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200')}>{l.icon}</span>
                {!collapsed && <span className="truncate">{l.label}</span>}
              </>
            )}
          </NavLink>
        ))}
        {!collapsed && (
          <div className="px-3 pt-3 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-slate-500">Ollama · On-premises</span>
          </div>
        )}
      </div>
    </aside>
  );
}
