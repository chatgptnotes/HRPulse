import { useState, useRef, useEffect } from 'react';
import ClockPicker from './ClockPicker';

interface TimePickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
}

export default function TimePicker({ value, onChange, label, className = '' }: TimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const formatDisplayTime = (timeStr: string) => {
    if (!timeStr) return '--:--';
    const [hours, minutes] = timeStr.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) return '--:--';

    const displayHours = hours === 0 ? 12 : (hours > 12 ? hours - 12 : hours);
    const ampm = hours < 12 ? 'AM' : 'PM';
    return `${String(displayHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${ampm}`;
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && (
        <label className="block text-xs font-medium text-slate-600 mb-1.5">{label}</label>
      )}

      {/* Time Display Input */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`
          w-full rounded-lg border text-left px-3 py-2.5 text-sm
          transition-all outline-none
          ${isOpen
            ? 'border-brand-400 ring-2 ring-brand-500/20 bg-white'
            : 'border-slate-200 bg-slate-50 hover:border-slate-300'
          }
        `}
      >
        <span className={value ? 'text-slate-800' : 'text-slate-400'}>
          {formatDisplayTime(value)}
        </span>
        <span className="material-icons text-slate-400 text-sm ml-auto float-right mt-0.5">
          schedule
        </span>
      </button>

      {/* Clock Picker Popover */}
      {isOpen && (
        <div className="absolute z-50 mt-2 left-0 top-full">
          <div className="fixed inset-0 bg-transparent" onClick={() => setIsOpen(false)} />
          <div className="relative bg-white">
            <ClockPicker
              value={value || '00:00'}
              onChange={onChange}
              onClose={() => setIsOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
