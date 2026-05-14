import { NavLink } from 'react-router-dom';
import clsx from 'clsx';

const links = [
  { to: '/', label: 'Dispatcher', icon: 'send' },
  { to: '/analytics', label: 'Analytics', icon: 'bar_chart' },
  { to: '/employees', label: 'Employees', icon: 'people' },
  { to: '/salary', label: 'Salary / LOP', icon: 'payments' },
  { to: '/history', label: 'Email History', icon: 'history' },
  { to: '/rules', label: 'Rules', icon: 'rule' },
  { to: '/sops', label: 'SOPs', icon: 'description' },
  { to: '/ai', label: 'AI Insights', icon: 'psychology' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: Props) {
  return (
    <aside
      className={clsx(
        'flex flex-col min-h-screen bg-white border-r border-slate-200 transition-all duration-200 flex-shrink-0',
        collapsed ? 'w-14' : 'w-56'
      )}
    >
      <div className={clsx('flex items-center border-b border-slate-100 h-14', collapsed ? 'justify-center px-2' : 'justify-between px-4')}>
        {!collapsed && (
          <div className="flex items-center gap-2 overflow-hidden min-w-0">
            <span className="material-icons text-brand-600 text-xl flex-shrink-0">corporate_fare</span>
            <div className="min-w-0">
              <div className="font-bold text-slate-800 text-sm leading-tight truncate">HRPulse</div>
              <div className="text-xs text-slate-400 truncate">Attendance AI</div>
            </div>
          </div>
        )}
        <button
          onClick={onToggle}
          className="p-1 rounded hover:bg-slate-100 text-slate-500 flex-shrink-0"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span className="material-icons text-xl">{collapsed ? 'menu' : 'chevron_left'}</span>
        </button>
      </div>

      <nav className="flex-1 py-3 space-y-0.5 px-2">
        {links.map(l => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === '/'}
            title={collapsed ? l.label : undefined}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-2 py-2 rounded-lg text-sm font-medium transition-colors',
                collapsed && 'justify-center',
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              )
            }
          >
            <span className="material-icons text-xl flex-shrink-0">{l.icon}</span>
            {!collapsed && <span className="truncate">{l.label}</span>}
          </NavLink>
        ))}
      </nav>

      {!collapsed && (
        <div className="px-4 py-3 text-xs text-slate-400 border-t border-slate-100">
          On-premises AI &middot; Ollama
        </div>
      )}
    </aside>
  );
}
