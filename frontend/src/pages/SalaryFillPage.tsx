import { useState, useRef } from 'react';
import * as api from '../api';

interface PhoneticMatch {
  salaryName: string;
  attendanceName: string;
  method: string;
  score: number;
  days: number;
}

interface FillResponse {
  filled: number;
  notFound: number;
  phoneticMatches: PhoneticMatch[];
  matchedNames: string[];
  unmatchedNames: string[];
  fileBase64: string;
  fileName: string;
}

export default function SalaryFillPage() {
  const [salaryFile, setSalaryFile] = useState<File | null>(null);
  const [attendanceFile, setAttendanceFile] = useState<File | null>(null);
  const [sheetName, setSheetName] = useState('july-26');
  const [workingDays, setWorkingDays] = useState(26);
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
      const { data } = await api.fillSalarySheet(salaryFile, attendanceFile, sheetName, workingDays);
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
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-bold text-slate-800 mb-1">Salary Sheet Auto-Fill</h1>
      <p className="text-sm text-slate-500 mb-6">
        Upload a salary sheet (Excel) and a biometric attendance file (.xls) to automatically fill Days, PAYMENT, and PAYABLE with formulas.
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
            <input
              ref={salaryInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={e => setSalaryFile(e.target.files?.[0] || null)}
            />
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
            <input
              ref={attendanceInputRef}
              type="file"
              accept=".xls,.xlsx"
              className="hidden"
              onChange={e => setAttendanceFile(e.target.files?.[0] || null)}
            />
          </div>
        </div>

        {/* Settings */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-slate-600 block mb-1">Sheet Name</label>
            <input
              type="text"
              value={sheetName}
              onChange={e => setSheetName(e.target.value)}
              placeholder="july-26"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600 block mb-1">Working Days (divisor)</label>
            <input
              type="number"
              value={workingDays}
              onChange={e => setWorkingDays(Number(e.target.value) || 26)}
              min={1}
              max={31}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
        </div>

        {/* Process button */}
        <button
          onClick={handleProcess}
          disabled={loading || !salaryFile || !attendanceFile}
          className="w-full bg-brand-600 text-white text-sm font-medium px-4 py-3 rounded-lg hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? 'Processing...' : 'Fill Salary Sheet'}
        </button>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-4 border-t border-slate-100 pt-4">
            <div className="flex items-center gap-4">
              <div className="flex-1 grid grid-cols-2 gap-4">
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{result.filled}</p>
                  <p className="text-xs text-green-700">Filled</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-slate-500">{result.notFound}</p>
                  <p className="text-xs text-slate-600">Not Found</p>
                </div>
              </div>
              <button
                onClick={handleDownload}
                className="bg-green-600 text-white text-sm font-medium px-4 py-3 rounded-lg hover:bg-green-700 whitespace-nowrap"
              >
                ⬇ Download
              </button>
            </div>

            {/* Phonetic matches */}
            {result.phoneticMatches.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-amber-600 mb-2">
                  ⚡ Phonetic Matches ({result.phoneticMatches.length}) — Please verify:
                </p>
                <div className="max-h-48 overflow-y-auto bg-amber-50 rounded-lg p-3 space-y-1">
                  {result.phoneticMatches.map((pm, i) => (
                    <div key={i} className="text-xs text-slate-700">
                      <span className="font-medium">{pm.salaryName}</span>
                      {' ← '}
                      <span className="text-slate-500">{pm.attendanceName}</span>
                      {' '}
                      <span className="text-slate-400">({pm.method}, {Math.round(pm.score * 100)}%, {pm.days} days)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Unmatched names */}
            {result.unmatchedNames.length > 0 && (
              <details>
                <summary className="text-sm font-medium text-slate-600 cursor-pointer">
                  Unmatched names ({result.unmatchedNames.length})
                </summary>
                <div className="mt-2 max-h-32 overflow-y-auto bg-slate-50 rounded-lg p-3">
                  {result.unmatchedNames.map((n, i) => (
                    <span key={i} className="text-xs text-slate-500 inline-block mr-2 mb-1">{n}{i < result.unmatchedNames.length - 1 ? ',' : ''}</span>
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
        <p>1. The attendance file is parsed to count days with biometric punches per person.</p>
        <p>2. Names are matched: exact → substring → phonetic (Levenshtein distance).</p>
        <p>3. For matched people, Days + PAYMENT (= Basic ÷ {workingDays} × Days) + PAYABLE (= Payment − Paid) formulas are written.</p>
        <p>4. Phonetic matches are flagged for your review — they may need manual correction.</p>
      </div>
    </div>
  );
}