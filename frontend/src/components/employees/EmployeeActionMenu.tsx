import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import {
  Bell,
  CalendarCheck,
  CircleDollarSign,
  Ellipsis,
  FileStack,
  Pencil,
  Trash2,
  UserRound,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';

export type EmployeeAction =
  | 'view' | 'edit' | 'notify' | 'attendance' | 'salary' | 'leave' | 'documents' | 'delete';

const ITEMS: { key: EmployeeAction; label: string; icon: LucideIcon; danger?: boolean; divider?: boolean }[] = [
  { key: 'view', label: 'View profile', icon: UserRound },
  { key: 'edit', label: 'Edit employee', icon: Pencil },
  { key: 'notify', label: 'Notify employee', icon: Bell },
  { key: 'attendance', label: 'Attendance', icon: CalendarCheck, divider: true },
  { key: 'salary', label: 'Salary details', icon: CircleDollarSign },
  { key: 'leave', label: 'Leave history', icon: WalletCards },
  { key: 'documents', label: 'Documents', icon: FileStack },
  { key: 'delete', label: 'Delete employee', icon: Trash2, danger: true, divider: true },
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
        className="rounded-lg border border-transparent p-2 text-slate-400 transition-colors hover:border-slate-200 hover:bg-white hover:text-slate-700"
        title="Actions"
      >
        <Ellipsis size={18} />
      </button>
      {open && createPortal(
        <>
          {/* click-away layer */}
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div
            ref={menuRef}
            className="fixed z-50 w-56 rounded-xl border border-slate-200 bg-white py-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.16)] animate-scale-in"
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              transformOrigin: position?.origin ?? 'top right',
              visibility: position ? 'visible' : 'hidden',
            }}
          >
            {ITEMS.map(it => {
              const Icon = it.icon;
              return (
                <div key={it.key} className={it.divider ? 'border-t border-slate-100 pt-1 mt-1' : ''}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setOpen(false); onAction(it.key); }}
                    className={clsx(
                      'flex w-full items-center gap-3 px-3.5 py-2 text-left text-[13px] font-medium transition-colors',
                      it.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    <Icon size={16} strokeWidth={1.8} className={it.danger ? 'text-red-500' : 'text-slate-400'} />
                    {it.label}
                  </button>
                </div>
              );
            })}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
