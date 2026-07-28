import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

export type EmployeeAction =
  | 'view' | 'edit' | 'notify' | 'attendance' | 'salary' | 'leave' | 'documents' | 'delete';

const ITEMS: { key: EmployeeAction; label: string; icon: string; danger?: boolean }[] = [
  { key: 'view', label: 'View Profile', icon: 'account_circle' },
  { key: 'edit', label: 'Edit Employee', icon: 'edit' },
  { key: 'notify', label: 'Notify Employee', icon: 'notifications' },
  { key: 'attendance', label: 'Attendance', icon: 'event_available' },
  { key: 'salary', label: 'Salary Details', icon: 'payments' },
  { key: 'leave', label: 'Leave History', icon: 'event_busy' },
  { key: 'documents', label: 'Documents', icon: 'folder' },
  { key: 'delete', label: 'Delete', icon: 'delete_outline', danger: true },
];

interface Props {
  onAction: (action: EmployeeAction) => void;
}

const MENU_WIDTH = 208;
const VIEWPORT_GAP = 8;

// Professional kebab dropdown for per-row employee actions.
export default function EmployeeActionMenu({ onAction }: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; origin: string } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const updatePosition = () => {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight || 304;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < menuHeight + VIEWPORT_GAP && rect.top > spaceBelow;
    const top = openUp
      ? Math.max(VIEWPORT_GAP, rect.top - menuHeight - 4)
      : Math.min(window.innerHeight - menuHeight - VIEWPORT_GAP, rect.bottom + 4);
    const left = Math.min(
      window.innerWidth - MENU_WIDTH - VIEWPORT_GAP,
      Math.max(VIEWPORT_GAP, rect.right - MENU_WIDTH),
    );

    setPosition({
      top: Math.max(VIEWPORT_GAP, top),
      left,
      origin: openUp ? 'bottom right' : 'top right',
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const close = () => setOpen(false);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', handleKey);

    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
        title="Actions"
      >
        <span className="material-icons text-lg">more_vert</span>
      </button>
      {open && createPortal(
        <>
          {/* click-away layer */}
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div
            ref={menuRef}
            className="fixed w-52 bg-white rounded-xl shadow-xl border border-slate-100 py-1.5 z-50 animate-scale-in"
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              transformOrigin: position?.origin ?? 'top right',
              visibility: position ? 'visible' : 'hidden',
            }}
          >
            {ITEMS.map(it => (
              <button
                key={it.key}
                onClick={(e) => { e.stopPropagation(); setOpen(false); onAction(it.key); }}
                className={clsx(
                  'w-full flex items-center gap-2.5 px-3.5 py-2 text-sm transition-colors text-left',
                  it.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50',
                )}
              >
                <span className={clsx('material-icons text-base', it.danger ? 'text-red-400' : 'text-slate-400')}>{it.icon}</span>
                {it.label}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
