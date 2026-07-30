import clsx from 'clsx';

interface Props {
  ready: boolean;                 // a payroll run is loaded
  uploading: boolean;
  isDragActive: boolean;
  filename?: string;
  uploadedAt?: string;
  periodMonth?: string;
  recordCount?: number;
  employeeCount?: number;
  hasWarnings?: boolean;
  getRootProps: any;
  getInputProps: any;
}

const STEPS = [
  { label: 'File Uploaded', icon: 'cloud_upload' },
  { label: 'Data Verified', icon: 'verified' },
  { label: 'Attendance Processed', icon: 'event_available' },
  { label: 'Salary Calculated', icon: 'payments' },
];

// Modern upload + processing card. Doubles as the dropzone (the whole card is
// clickable) and shows a horizontal timeline once a run is loaded.
export default function UploadCard({
  ready, uploading, isDragActive, filename, uploadedAt, periodMonth,
  recordCount, employeeCount, hasWarnings, getRootProps, getInputProps,
}: Props) {
  // stage per step: 0 = pending, 1 = active, 2 = done
  const stepState = (idx: number): 0 | 1 | 2 => {
    if (uploading) return idx === 0 ? 1 : 0;
    if (ready) return 2;
    return 0;
  };

  if (ready && !uploading) return null;

  return (
    <div
      {...getRootProps()}
      className={clsx(
        'rounded-2xl border-2 border-dashed px-5 py-5 cursor-pointer transition-all mb-5',
        isDragActive ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/30',
      )}
    >
      <input {...getInputProps()} />

      {/* Hero / empty state */}
      {!ready && !uploading && (
        <div className="flex flex-col items-center justify-center text-center py-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200 mb-3">
            <span className="material-icons text-white text-3xl">cloud_upload</span>
          </div>
          <p className="text-sm font-bold text-slate-700">Drag & drop the attendance Excel here</p>
          <p className="text-xs text-slate-400 mt-1">Supports raw punch exports and aggregated daily exports (.xlsx, .xls)</p>
          <span className="mt-3 inline-flex items-center gap-1.5 bg-indigo-600 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-sm">
            <span className="material-icons text-base">bolt</span>Process Attendance
          </span>
        </div>
      )}

      {/* Processing state */}
      {uploading && (
        <div className="flex items-center justify-center gap-3 py-6">
          <span className="material-icons animate-spin text-indigo-500">sync</span>
          <div className="text-left">
            <p className="text-sm font-semibold text-slate-700">Processing Excel…</p>
            <p className="text-xs text-slate-400">Verifying data and calculating salary</p>
          </div>
        </div>
      )}

      {/* Loaded state: file details + timeline */}
      {ready && !uploading && (
        <div className="flex flex-col lg:flex-row lg:items-center gap-5">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
              <span className="material-icons text-emerald-600 text-2xl">description</span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-bold text-slate-800 truncate">{filename || 'Attendance file'}</p>
                <span className={clsx(
                  'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full',
                  hasWarnings ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700',
                )}>
                  <span className="material-icons text-[12px]">{hasWarnings ? 'warning' : 'check_circle'}</span>
                  {hasWarnings ? 'Processed with notes' : 'Validated'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {periodMonth ? `${periodMonth} · ` : ''}
                {uploadedAt ? new Date(uploadedAt).toLocaleString() : ''}
                {recordCount != null ? ` · ${recordCount} records` : ''}
                {employeeCount != null ? ` · ${employeeCount} employees` : ''}
              </p>
            </div>
          </div>

          {/* Timeline */}
          <div className="flex items-center gap-1 lg:gap-2 flex-shrink-0">
            {STEPS.map((s, idx) => {
              const state = stepState(idx);
              return (
                <div key={s.label} className="flex items-center">
                  <div className="flex flex-col items-center gap-1 w-16 lg:w-20">
                    <div className={clsx(
                      'w-8 h-8 rounded-full flex items-center justify-center transition-colors',
                      state === 2 ? 'bg-emerald-500 text-white' : state === 1 ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-300',
                    )}>
                      <span className={clsx('material-icons text-base', state === 1 && 'animate-spin')}>{state === 2 ? 'check' : s.icon}</span>
                    </div>
                    <span className={clsx('text-[9px] lg:text-[10px] font-medium text-center leading-tight', state === 2 ? 'text-slate-600' : 'text-slate-400')}>
                      {s.label}
                    </span>
                  </div>
                  {idx < STEPS.length - 1 && (
                    <div className={clsx('h-0.5 w-4 lg:w-6 rounded', stepState(idx) === 2 ? 'bg-emerald-400' : 'bg-slate-200')} />
                  )}
                </div>
              );
            })}
          </div>

          <div className="hidden xl:flex items-center text-xs text-slate-400 lg:border-l lg:border-slate-100 lg:pl-4">
            <span className="material-icons text-sm mr-1">swap_horiz</span>Drop a new file to reprocess
          </div>
        </div>
      )}
    </div>
  );
}
