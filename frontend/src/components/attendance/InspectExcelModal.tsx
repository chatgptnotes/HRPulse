import { useState } from 'react';
import * as api from '../../api';
import clsx from 'clsx';

interface FieldMatch {
  field: string;
  description: string;
  matchedFrom: string | null;
}
interface SampleRecord {
  employeeName: string; employeeNumber: string; recordDate: string;
  status: string; timeIn: string; timeOut: string; department: string;
}
interface Report {
  sheetName: string;
  totalRows: number;
  headerRowIndex: number;
  detectedBy: string;
  rawHeaders: string[];
  normalizedHeaders: string[];
  sampleRows: unknown[][];
  fieldMatch: FieldMatch[];
  looksLikeCrossTab: boolean;
  extractedRecordCount: number;
  sampleRecords: SampleRecord[];
  periodMonth: string;
  periodYear: string;
  warnings: string[];
}

export default function InspectExcelModal({ file, onClose }: { file: File; onClose: () => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.inspectAttendance(file);
      setReport(data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Inspection failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-slate-800">Inspect Excel — {file.name}</h3>
            <p className="text-sm text-slate-500 mt-0.5">Reads your file and shows what's inside. Nothing is saved to the database.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!report && !loading && !error && (
            <div className="text-center py-10">
              <p className="text-sm text-slate-500 mb-4">Click <b>Inspect</b> to read the Excel and show its contents + column mapping.</p>
              <button onClick={run} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg">
                Inspect
              </button>
            </div>
          )}

          {loading && <p className="text-sm text-slate-400 text-center py-10">Reading Excel…</p>}
          {error && <p className="text-sm text-red-500 text-center py-10">{error}</p>}

          {report && (
            <div className="space-y-5">
              {/* Overview */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-500">Sheet</p>
                  <p className="text-sm font-semibold text-slate-800 truncate">{report.sheetName}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-500">Total rows</p>
                  <p className="text-sm font-semibold text-slate-800">{report.totalRows}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-500">Header row</p>
                  <p className="text-sm font-semibold text-slate-800">Row {report.headerRowIndex + 1}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-500">Records extracted</p>
                  <p className={clsx('text-sm font-bold', report.extractedRecordCount > 0 ? 'text-emerald-600' : 'text-red-600')}>
                    {report.extractedRecordCount}
                  </p>
                </div>
              </div>
              <p className="text-xs text-slate-400 -mt-2">{report.detectedBy}</p>

              {/* Verdict */}
              {report.looksLikeCrossTab && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
                  ⚠ This looks like a <b>cross-tab (pivot) sheet</b> — employees down the side and dates 1–31 across the top. The current parser expects one row per employee per day. This layout needs a cross-tab converter.
                </div>
              )}
              {!report.looksLikeCrossTab && report.extractedRecordCount === 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
                  ⚠ Parser extracted <b>0 records</b>. The two required columns are <b>Employee Name</b> and a <b>Date</b>. Check the column-match table below — any field shown in red isn't being recognized.
                </div>
              )}
              {report.extractedRecordCount > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-700">
                  ✓ Parser would extract <b>{report.extractedRecordCount}</b> records for <b>{report.periodMonth}</b>.
                </div>
              )}

              {/* Column match report */}
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Column Match Report</h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500">
                        <th className="text-left px-3 py-2 text-xs font-semibold">Needed field</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold">Description</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold">Matched from your header</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.fieldMatch.map((f) => (
                        <tr key={f.field} className="border-t border-slate-100">
                          <td className="px-3 py-2 font-mono text-xs text-slate-700">{f.field}</td>
                          <td className="px-3 py-2 text-slate-600">{f.description}</td>
                          <td className="px-3 py-2">
                            {f.matchedFrom ? (
                              <span className="inline-block px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700">✓ {f.matchedFrom}</span>
                            ) : (
                              <span className="inline-block px-2 py-0.5 rounded-md text-xs font-medium bg-red-50 text-red-600">✗ not found</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Raw headers */}
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Raw Headers (row {report.headerRowIndex + 1}) — {report.rawHeaders.length} columns</h4>
                <div className="flex flex-wrap gap-1.5">
                  {report.rawHeaders.map((h, i) => {
                    const norm = report.normalizedHeaders[i];
                    const recognized = norm && !norm.startsWith('_') && /^[a-zA-Z]/.test(norm);
                    return (
                      <span key={i} className={clsx(
                        'px-2 py-1 rounded-md text-xs font-medium border',
                        recognized ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                      )} title={`maps to: ${norm}`}>
                        {h || <span className="italic">(blank)</span>}{recognized && <span className="opacity-60"> → {norm}</span>}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Sample rows */}
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">First rows (raw)</h4>
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50">
                        {report.rawHeaders.slice(0, 12).map((h, i) => (
                          <th key={i} className="text-left px-2 py-1.5 font-semibold text-slate-500 whitespace-nowrap">{h || `col${i + 1}`}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.sampleRows.map((row, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          {(row as unknown[]).slice(0, 12).map((cell, j) => (
                            <td key={j} className="px-2 py-1.5 text-slate-600 whitespace-nowrap">{String(cell ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                      {report.sampleRows.length === 0 && (
                        <tr><td colSpan={12} className="px-2 py-4 text-center text-slate-400">No data rows after header</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Warnings */}
              {report.warnings.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Parser warnings ({report.warnings.length})</h4>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700 space-y-0.5 max-h-32 overflow-y-auto">
                    {report.warnings.slice(0, 12).map((w, i) => <div key={i}>⚠ {w}</div>)}
                    {report.warnings.length > 12 && <div className="text-amber-500">+{report.warnings.length - 12} more</div>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 font-medium">Close</button>
          {!report && (
            <button onClick={run} disabled={loading} className="px-4 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg font-medium">
              {loading ? 'Inspecting…' : 'Inspect'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
