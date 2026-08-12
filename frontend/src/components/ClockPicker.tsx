import { useState, useEffect, useRef } from 'react';

interface ClockPickerProps {
  value: string; // HH:MM format (24h)
  onChange: (time: string) => void;
  onClose: () => void;
}

export default function ClockPicker({ value, onChange, onClose }: ClockPickerProps) {
  const [mode, setMode] = useState<'hour' | 'minute'>('hour');
  const [internalValue, setInternalValue] = useState(value);
  const [isAm, setIsAm] = useState(true);

  useEffect(() => {
    // Parse initial value
    const [hours, minutes] = internalValue.split(':').map(Number);
    if (hours !== undefined) {
      setIsAm(hours < 12);
    }
  }, [internalValue]);

  const parseTime = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return { hours: hours || 0, minutes: minutes || 0 };
  };

  const formatTime = (hours: number, minutes: number) => {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  };

  const { hours: currentHours, minutes: currentMinutes } = parseTime(internalValue);

  const getDisplayHours = () => {
    if (currentHours === 0) return 12;
    if (currentHours > 12) return currentHours - 12;
    return currentHours;
  };

  const handleHourSelect = (hour: number) => {
    const baseHours = isAm ? (hour === 12 ? 0 : hour) : (hour === 12 ? 12 : hour + 12);
    setInternalValue(formatTime(baseHours, currentMinutes));
    setMode('minute');
  };

  const handleMinuteSelect = (minute: number) => {
    setInternalValue(formatTime(currentHours, minute));
  };

  const handleAmPmToggle = (am: boolean) => {
    setIsAm(am);
    const newHours = am
      ? (currentHours >= 12 ? currentHours - 12 : currentHours)
      : (currentHours === 0 ? 12 : (currentHours < 12 ? currentHours + 12 : currentHours));
    setInternalValue(formatTime(newHours || 12, currentMinutes));
  };

  const handleConfirm = () => {
    onChange(internalValue);
    onClose();
  };

  const getClockNumber = (num: number, isMinute: boolean) => {
    const isSelected = isMinute
      ? currentMinutes === num
      : getDisplayHours() === num;
    const isCurrentMode = isMinute ? mode === 'minute' : mode === 'hour';

    if (!isCurrentMode) {
      return (
        <span className={`text-slate-300 text-sm`}>{num}</span>
      );
    }

    return (
      <button
        type="button"
        onClick={() => isMinute ? handleMinuteSelect(num) : handleHourSelect(num)}
        className={`
          w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all
          ${isSelected
            ? 'bg-brand-600 text-white scale-110 shadow-lg'
            : 'text-slate-600 hover:bg-slate-200'
          }
        `}
      >
        {num}
      </button>
    );
  };

  const getMinuteMarker = (minute: number) => {
    const isSelected = currentMinutes === minute;
    return (
      <button
        type="button"
        onClick={() => handleMinuteSelect(minute)}
        className={`
          w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-all
          ${isSelected
            ? 'bg-indigo-600 text-white scale-110 shadow-md'
            : 'text-slate-500 hover:bg-slate-200'
          }
        `}
      >
        {minute}
      </button>
    );
  };

  // Calculate position for clock numbers
  const getClockPosition = (num: number, radius = 80) => {
    const angle = (num - 3) * 30 * (Math.PI / 180);
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    };
  };

  return (
    <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 w-80">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-800">Select Time</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
          <span className="material-icons text-xl">close</span>
        </button>
      </div>

      {/* Time Display */}
      <div className="flex items-center justify-center gap-2 mb-6">
        <button
          type="button"
          onClick={() => setMode('hour')}
          className={`text-3xl font-semibold transition-colors ${mode === 'hour' ? 'text-brand-600' : 'text-slate-400 hover:text-slate-600'}`}
        >
          {String(getDisplayHours()).padStart(2, '0')}
        </button>
        <span className="text-3xl text-slate-400">:</span>
        <button
          type="button"
          onClick={() => setMode('minute')}
          className={`text-3xl font-semibold transition-colors ${mode === 'minute' ? 'text-brand-600' : 'text-slate-400 hover:text-slate-600'}`}
        >
          {String(currentMinutes).padStart(2, '0')}
        </button>
        <div className="ml-2 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => handleAmPmToggle(true)}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${isAm ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
          >
            AM
          </button>
          <button
            type="button"
            onClick={() => handleAmPmToggle(false)}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${!isAm ? 'bg-slate-700 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
          >
            PM
          </button>
        </div>
      </div>

      {/* Clock Face */}
      <div className="relative w-56 h-56 mx-auto mb-6">
        {/* Clock background */}
        <div className="absolute inset-0 rounded-full bg-slate-50 border border-slate-200" />

        {/* Clock numbers and markers */}
        <div className="absolute inset-0 flex items-center justify-center">
          <svg width="224" height="224" viewBox="0 0 224 224" className="overflow-visible">
            {mode === 'hour' ? (
              // Hour markers (1-12)
              <>
                {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((num) => {
                  const pos = getClockPosition(num, 85);
                  return (
                    <foreignObject
                      key={num}
                      x={112 + pos.x - 16}
                      y={112 + pos.y - 16}
                      width="32"
                      height="32"
                    >
                      {getClockNumber(num, false)}
                    </foreignObject>
                  );
                })}
              </>
            ) : (
              // Minute markers (0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55)
              <>
                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((minute) => {
                  const hourNum = minute === 0 ? 12 : minute / 5;
                  const pos = getClockPosition(hourNum, 85);
                  return (
                    <foreignObject
                      key={minute}
                      x={112 + pos.x - 12}
                      y={112 + pos.y - 12}
                      width="24"
                      height="24"
                    >
                      {getMinuteMarker(minute)}
                    </foreignObject>
                  );
                })}
              </>
            )}

            {/* Center knob */}
            <circle cx="112" cy="112" r="6" fill="currentColor" className="text-brand-600" />
          </svg>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          className="flex-1 px-4 py-2.5 rounded-xl bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
        >
          OK
        </button>
      </div>
    </div>
  );
}
