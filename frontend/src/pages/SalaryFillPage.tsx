import { useState, useRef } from 'react';
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
  matchedNames: string[];
  unmatchedNames: string[];
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
  const salaryInputRef = useRef<HTMLInputElement>(null);
  const attendanceInputRef = useRef<HTMLInputElement>(null);

  const handleProcess = async () => {
    if (!salaryFile || !attendanceFile) {
      setError('Please select both files');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const { data } = await api.fillSalarySheet(salaryFile, attendanceFile, sheetName, month);
      setResult(data as FillResponse);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to process');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const binaryString = atob(result.fileBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-bold text-slate-800 mb-1">Salary Sheet Auto-Fill</h1>
      <p className="text-sm text-slate-500 mb-6">
        Upload a salary sheet and attendance file. Working days are calculated dynamically from the month.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
        {/* File uploads */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-slate-600 block mb-2">Salary Sheet (.xlsx)</label>
            <div
              onClick={() => salaryInputRef.current?.click()}
              className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center cursor-pointer hover:border-brand-400 transition-colors"
            >
              {salaryFile ? (
                <p className="text-sm text-green-600 font-medium">✓ {salaryFile.name}</p>
              ) : (
                <p className="text-sm text-slate-400">Click to select Excel file</p>
              )}
            </div>
            <input ref={salaryInputRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => setSalaryFile(e.target.files?.[0] || null)} />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600 block mb-2">Attendance File (.xls)</label>
            <div
              onClick={() => attendanceInputRef.current?.click()}
              className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center cursor-pointer hover:border-brand-400 transition-colors"
            >
              {attendanceFile ? (
                <p className="text-sm text-green-600 font-medium">✓ {attendanceFile.name}</p>
              ) : (
                <p className="text-sm text-slate-400">Click to select biometric file</p>
              )}
            </div>
            <input ref={attendanceInputRef} type="file" accept=".xls,.xlsx" className="hidden"
              onChange={e => setAttendanceFile(e.target.files?.[0] || null)} />
          </div>
        </div>

        {/* Settings */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-slate-600 block mb-1">Sheet Name</label>
            <input type="text" value={sheetName} onChange={e => setSheetName(e.target.value)}
              placeholder="july-26"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600 block mb-1">Month (YYYY-MM)</label>
            <input type="text" value={month} onChange={e => setMonth(e.target.value)}
              placeholder="2026-07"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
          </div>
        </div>

        <button onClick={handleProcess} disabled={loading || !salaryFile || !attendanceFile}
          className="w-full bg-brand-600 text-white text-sm font-medium px-4 py-3 rounded-lg hover:bg-brand-700 disabled:opacity-50">
          {loading ? 'Processing...' : 'Fill Salary Sheet'}
        </button>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">{error}</div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-4 border-t border-slate-100 pt-4">
            {/* Month info */}
            <div className="bg-blue-50 rounded-lg p-4 text-sm">
              <p className="font-semibold text-blue-700 mb-2">📅 Month Info: {month}</p>
              <div className="grid grid-cols-4 gap-3 text-center">
                <div><p className="text-lg font-bold text-blue-600">{result.monthInfo.daysInMonth}</p><p className="text-xs">Days in Month</p></div>
                <div><p className="text-lg font-bold text-blue-600">{result.monthInfo.sundays}</p><p className="text-xs">Sundays</p></div>
                <div><p className="text-lg font-bold text-blue-600">{result.monthInfo.hospitalWD}</p><p className="text-xs">Hospital WD</p></div>
                <div><p className="text-lg font-bold text-blue-600">{result.monthInfo.softwareWD}</p><p className="text-xs">Software WD</p></div>
              </div>
            </div>

            {/* Summary */}
            <div className="flex items-center gap-4">
              <div className="flex-1 grid grid-cols-3 gap-4">
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{result.filled}</p>
                  <p className="text-xs text-green-700">Filled</p>
                </div>
                <div className="bg-amber-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-amber-600">{result.skipped.length}</p>
                  <p className="text-xs text-amber-700">Skipped (0 days)</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-slate-500">{result.notFound}</p>
                  <p className="text-xs text-slate-600">Not Found</p>
                </div>
              </div>
              <button onClick={handleDownload}
                className="bg-green-600 text-white text-sm font-medium px-4 py-3 rounded-lg hover:bg-green-700 whitespace-nowrap">
                ⬇ Download
              </button>
            </div>

            {/* Salary table preview */}
            {result.entries.length > 0 && (
              <details>
                <summary className="text-sm font-medium text-slate-600 cursor-pointer">Salary Preview ({result.entries.length})</summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="text-left py-1 px-2">Name</th>
                        <th className="text-right">Basic</th>
                        <th className="text-right">Days</th>
                        <th className="text-right">OT</th>
                        <th className="text-right">Gross</th>
                        <th className="text-right">Deduct</th>
                        <th className="text-right">Net</th>
                        <th className="text-center">Dept</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.entries.map((e, i) => (
                        <tr key={i} className="border-b border-slate-50">
                          <td className="py-1 px-2 font-medium text-slate-700">{e.employeeName}</td>
                          <td className="text-right">{e.monthlySalary.toLocaleString()}</td>
                          <td className="text-right">{e.daysPresent}</td>
                          <td className="text-right">{e.otDuties}</td>
                          <td className="text-right">{e.grossSalary.toLocaleString()}</td>
                          <td className="text-right text-red-500">{e.deductions.toLocaleString()}</td>
                          <td className="text-right font-bold text-green-600">{e.netSalary.toLocaleString()}</td>
                          <td className="text-center">
                            <span className={e.isSoftware ? 'text-purple-600' : 'text-blue-600'}>
                              {e.isSoftware ? 'SW' : 'Hosp'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            {/* Phonetic matches */}
            {result.phoneticMatches.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-amber-600 mb-2">
                  ⚡ Phonetic Matches ({result.phoneticMatches.length}) — Please verify:
                </p>
                <div className="max-h-48 overflow-y-auto bg-amber-50 rounded-lg p-3 space-y-1">
                  {result.phoneticMatches.map((pm, i) => (
                    <div key={i} className="text-xs text-slate-700">
                      <span className="font-medium">{pm.salaryName}</span> ← <span className="text-slate-500">{pm.attendanceName}</span>
                      <span className="text-slate-400 ml-2">({pm.method}, {Math.round(pm.score * 100)}%, {pm.days} days)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Skipped / Unmatched */}
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

      {/* Instructions */}
      <div className="mt-4 bg-slate-50 rounded-xl p-4 text-xs text-slate-500 space-y-1">
        <p className="font-semibold text-slate-600">How it works:</p>
        <p>1. Working days calculated dynamically: Hospital = Days in Month − 4, Software = Days − Sundays.</p>
        <p>2. Software: Gross = Monthly (fixed). Deductions = Advance + (Monthly ÷ WD × Absent Days). Net ≥ 0.</p>
        <p>3. Hospital: Gross = Monthly ÷ WD × Days + OT. Deductions = Advance + Absent Deduction.</p>
        <p>4. Employees with 0 attendance are skipped and listed separately.</p>
        <p>5. Phonetic matches are flagged — verify them before finalizing.</p>
      </div>
    </div>
  );
}