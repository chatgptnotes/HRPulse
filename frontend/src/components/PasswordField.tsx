import { useState } from 'react';

interface PasswordFieldProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
  autoComplete?: string;
}

export default function PasswordField({
  id,
  value,
  onChange,
  placeholder,
  className = '',
  required = false,
  autoComplete = 'current-password',
}: PasswordFieldProps) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        type={showPassword ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        className={`w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 ${className}`}
      />
      <button
        type="button"
        onClick={() => setShowPassword(!showPassword)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
        aria-label={showPassword ? 'Hide password' : 'Show password'}
      >
        {showPassword ? (
          // Eye slashed icon
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0019.5 12c.755 0 1.488-.078 2.198-.223m-14.764 2.077A10.477 10.477 0 013.98 8.223m14.764 2.077L19.5 15.75M3.98 8.223L3 8.223m14.764 2.077l.98.45M3.98 8.223a10.477 10.477 0 010 7.554m14.764-2.077a10.477 10.477 0 010-7.554M12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zm-2.25-2.25a.75.75 0 10-1.5 0 .75.75 0 001.5 0zm6 0a.75.75 0 10-1.5 0 .75.75 0 001.5 0z" clipRule="evenodd" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m-14.25 0h15M4.5 4.5v15" />
          </svg>
        ) : (
          // Eye icon
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        )}
      </button>
    </div>
  );
}
