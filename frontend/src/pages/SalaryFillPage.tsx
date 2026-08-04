import { useState, useRef, useMemo } from 'react';
import * as api from '../api';

interface PhoneticMatch {
  salaryName: string;
  attendanceName: string;
  method: string;
  score: number;
  days: number;
}

interface SalaryEntry {
  employeeName: string;
  designation: string;
  organisation: string;
  monthlySalary: number;
  daysPresent: number;
  otDuties: number;
  grossSalary: number;
  deductions: number;
  netSalary: number;
  isSoftware: boolean;
}

interface MonthInfo {
  daysInMonth: number;
  sundays: number;
  hospitalWD: number;
  softwareWD: number;
}

interface FillResponse {
  filled: number;
  notFound: number;
  skipped: string[];
  phoneticMatches: PhoneticMatch[];
  entries: SalaryEntry[];
  monthInfo: MonthInfo;
  fileBase64: string;
  fileName: string;
}

export default function SalaryFillPage() {
  const [salaryFile, setSalaryFile] = useState<File | null>(null);
  const [attendanceFile, setAttendanceFile] = useState<File | null>(null);
  const [sheetName, setSheetName] = useState('july-26');
  const [month, setMonth] = useState('2026-07');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FillResponse | null>(null);
  const [error, setError] = useState('');
  const [otEdits, setOtEdits] = useState<Record<string, number>>({});
  const salaryInputRef = useRef<HTMLInputElement>(null);
  const attendanceInputRef = useRef<HTMLInputElement>(null);

  const handleProcess = async () => {
    if (!salaryFile || !attendanceFile) { setError('Please select both files'); return; }
    setLoading(true); setError(''); setResult(null);
    try {
      const { data } = await api.fillSalarySheet(salaryFile, attendanceFile, sheetName, month);
      setResult(data as FillResponse);
      const initialOt: Record<string, number> = {};
      for (const e of (data as FillResponse).entries) initialOt[e.employeeName] = e.otDuties || 0;
      setOtEdits(initialOt);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to process');
    } finally { setLoading(false); }
  };

  // Recalculate salary with edited OT
  const recalculated = useMemo(() => {
    if (!result) return [];
    const wd = result.monthInfo;
    return result.entries.map(e => {
      const otDuties = e.isSoftware ? 0 : (otEdits[e.employeeName] ?? e.otDuties ?? 0);
      const workingDays = e.isSoftware ? wd.softwareWD : wd.hospitalWD;
      let gross: number, deductions: number, net: number;
      if (e.isSoftware) {
        const expected = workingDays - 2;
        const absent = Math.max(0, expected - Math.min(e.daysPresent, expected));
        gross = e.monthlySalary;
        const absentDed = Math.round((e.monthlySalary / workingDays) * absent);
        deductions = absentDed;
        net = Math.max(0, gross - deductions);
      } else {
        const otAmount = Math.round((e.monthlySalary / workingDays) * otDuties);
        gross = Math.round((e.monthlySalary / workingDays) * e.daysPresent + otAmount);
        const absent = Math.max(0, workingDays - e.daysPresent);
        const absentDed = Math.round((e.monthlySalary / workingDays) * absent);
        deductions = absentDed;
        net = Math.max(0, gross - deductions);
      }
      return { ...e, otDuties, grossSalary: gross, deductions, netSalary: net };
    });
  }, [result, otEdits]);

  const totalNet = recalculated.reduce((sum, e) => sum + e.netSalary, 0);

  const handleDownload = () => {
    if (!result) return;
    const binaryString = atob(result.fileBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = result.fileName; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-xl font-bold text-slate-800 mb-1">Salary Sheet Auto-Fill</h1>
      <p className="text-sm text-slate-500 mb-6">
        Upload salary sheet + attendance → review data → enter OT duties manually → download
      </p>

      {/* Upload Section */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-slate-600 block mb-2">Salary Sheet (.xlsx)</label>
            <div onClick={() => salaryInputRef.current?.click()}
              className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center cursor-pointer hover:border-brand-400 transition-colors">
              {salaryFile ? <p className="text-sm text-green-600 font-medium">✓ {salaryFile.name}</p>
                : <p className="text-sm text-slate-400">Click to select Excel file</p>}
            </div>
            <input ref={salaryInputRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => setSalaryFile(e.target.files?.[0] || null)} />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600 block mb-2">Attendance File (.xls)</label>
            <div onClick={() => attendanceInputRef.current?.click()}
              className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center cursor-pointer hover:border-brand-400 transition-colors">
              {attendanceFile ? <p className="text-sm text-green-600 font-medium">✓ {attendanceFile.name}</p>
                : <p className="text-sm text-slate-400">Click to select biometric file</p>}
            </div>
            <input ref={attendanceInputRef} type="file" accept=".xls,.xlsx" className="hidden"
              onChange={e => setAttendanceFile(e.target.files?.[0] || null)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-slate-600 block mb-1">Sheet Name</label>
            <input type="text" value={sheetName} onChange={e => setSheetName(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600 block mb-1">Month (YYYY-MM)</label>
            <input type="text" value={month} onChange={e => setMonth(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
          </div>
        </div>

        <button onClick={handleProcess} disabled={loading || !salaryFile || !attendanceFile}
          className="w-full bg-brand-600 text-white text-sm font-medium px-4 py-3 rounded-lg hover:bg-brand-700 disabled:opacity-50">
          {loading ? 'Processing...' : 'Process Files'}
        </button>

        {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">{error}</div>}
      </div>

      {/* Results — Editable Table */}
      {result && (
        <div className="mt-6 space-y-4">
          {/* Month Info */}
          <div className="bg-blue-50 rounded-lg p-4">
            <p className="font-semibold text-blue-700 mb-2 text-sm">📅 {month} — Days: {result.monthInfo.daysInMonth} | Sundays: {result.monthInfo.sundays} | Hospital WD: {result.monthInfo.hospitalWD} | Software WD: {result.monthInfo.softwareWD}</p>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-600">{result.filled}</p>
              <p className="text-xs text-green-700">Matched</p>
            </div>
            <div className="bg-amber-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-amber-600">{result.skipped.length}</p>
              <p className="text-xs text-amber-700">Skipped (0 days)</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-blue-600">₹{totalNet.toLocaleString()}</p>
              <p className="text-xs text-blue-700">Total Net</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center flex items-center justify-center">
              <button onClick={handleDownload}
                className="bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-green-700 w-full">
                ⬇ Download Excel
              </button>
            </div>
          </div>

          {/* Editable Salary Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
              <p className="text-sm font-semibold text-slate-700">Salary Details — Enter OT Duties (editable)</p>
            </div>
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="text-left py-2 px-3">Name</th>
                    <th className="text-left">Designation</th>
                    <th className="text-right">Basic</th>
                    <th className="text-right">Days</th>
                    <th className="text-center bg-amber-50">OT Duties</th>
                    <th className="text-right">Gross</th>
                    <th className="text-right">Deduct</th>
                    <th className="text-right">Net</th>
                    <th className="text-center">Dept</th>
                  </tr>
                </thead>
                <tbody>
                  {recalculated.map((e, i) => (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="py-2 px-3 font-medium text-slate-700">{e.employeeName}</td>
                      <td className="text-slate-500">{e.designation}</td>
                      <td className="text-right">{e.monthlySalary.toLocaleString()}</td>
                      <td className="text-right">{e.daysPresent}</td>
                      <td className="text-center bg-amber-50/30">
                        {e.isSoftware ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <input type="number" min={0} max={31}
                            value={otEdits[e.employeeName] ?? 0}
                            onChange={ev => setOtEdits(prev => ({ ...prev, [e.employeeName]: Number(ev.target.value) || 0 }))}
                            className="w-14 text-center border border-amber-200 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400/40" />
                        )}
                      </td>
                      <td className="text-right">{e.grossSalary.toLocaleString()}</td>
                      <td className="text-right text-red-500">{e.deductions > 0 ? `−${e.deductions.toLocaleString()}` : '0'}</td>
                      <td className="text-right font-bold text-green-600">{e.netSalary.toLocaleString()}</td>
                      <td className="text-center">
                        <span className={e.isSoftware ? 'text-purple-600 text-xs' : 'text-blue-600 text-xs'}>
                          {e.isSoftware ? 'SW' : 'Hosp'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Phonetic matches */}
          {result.phoneticMatches.length > 0 && (
            <details>
              <summary className="text-sm font-medium text-amber-600 cursor-pointer">
                ⚡ Phonetic Matches ({result.phoneticMatches.length}) — verify
              </summary>
              <div className="mt-2 max-h-40 overflow-y-auto bg-amber-50 rounded-lg p-3 space-y-1">
                {result.phoneticMatches.map((pm, i) => (
                  <div key={i} className="text-xs text-slate-700">
                    <span className="font-medium">{pm.salaryName}</span> ← <span className="text-slate-500">{pm.attendanceName}</span>
                    <span className="text-slate-400 ml-2">({Math.round(pm.score * 100)}%, {pm.days}d)</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Skipped */}
          {result.skipped.length > 0 && (
            <details>
              <summary className="text-sm font-medium text-amber-600 cursor-pointer">
                Skipped — No attendance ({result.skipped.length})
              </summary>
              <div className="mt-2 max-h-32 overflow-y-auto bg-amber-50 rounded-lg p-3">
                {result.skipped.map((n, i) => (
                  <span key={i} className="text-xs text-slate-500 inline-block mr-2 mb-1">{n}{i < result.skipped.length - 1 ? ',' : ''}</span>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}