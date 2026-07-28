import clsx from 'clsx';
import { avatarGradient } from './types';

interface Props {
  name: string;
  photoUrl?: string | null;
  size?: number;
  ring?: boolean;
  className?: string;
}

// Circular avatar: employee photo when available, otherwise a deterministic
// gradient tile with the person's initial.
export default function EmployeeAvatar({ name, photoUrl, size = 40, ring = false, className }: Props) {
  const style = { width: size, height: size };
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        style={style}
        className={clsx('rounded-full object-cover shadow-sm', ring && 'ring-4 ring-white', className)}
      />
    );
  }
  return (
    <div
      style={style}
      className={clsx(
        'rounded-full bg-gradient-to-br flex items-center justify-center shadow-sm flex-shrink-0',
        avatarGradient(name),
        ring && 'ring-4 ring-white',
        className,
      )}
    >
      <span className="text-white font-bold" style={{ fontSize: Math.round(size * 0.4) }}>
        {(name || '?').charAt(0).toUpperCase()}
      </span>
    </div>
  );
}
