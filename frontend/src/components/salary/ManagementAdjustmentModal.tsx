import { useState, useEffect } from 'react';
import * as api from '../../api';
import { formatINR } from '../../lib/dayWiseSalary';

interface Props {
  uploadId: number | null;
  employeeId: number;
  employeeName: string;
  currentAdjustment: number;
  currentRemarks: string;
  onClose: () => void;
  onSave: () => void;
}

export default function ManagementAdjustmentModal({
  uploadId,
  employeeId,
  employeeName,
  currentAdjustment,
  currentRemarks,
  onClose,
  onSave,
}: Props) {
  const [amount, setAmount] = useState(currentAdjustment || 0);
  const [remarks, setRemarks] = useState(currentRemarks || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  // Reset form when current values change
  useEffect(() => {
    setAmount(currentAdjustment || 0);
    setRemarks(currentRemarks || '');
    setError('');
  }, [currentAdjustment, currentRemarks]);

  const validate = (): boolean => {
    if (amount !== 0 && remarks.trim().length < 10) {
      setError('Please provide a reason for this adjustment (minimum 10 characters)');
      return false;
    }
    if (remarks.length > 500) {
      setError('Remarks must be less than 500 characters');
      return false;
    }
    setError('');
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await api.saveManagementAdjustment(employeeId, uploadId, amount, remarks);
      onSave();
    } catch (err: any) {
      setError(err?.message || 'Failed to save adjustment. Please try again.');
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to remove this management adjustment?')) return;
    setDeleting(true);
    try {
      await api.deleteManagementAdjustment(employeeId, uploadId);
      setAmount(0);
      setRemarks('');
      onSave();
    } catch (err: any) {
      setError(err?.message || 'Failed to remove adjustment. Please try again.');
      setDeleting(false);
    }
  };

  const hasAdjustment = currentAdjustment !== 0;
  const amountLabel = amount > 0 ? 'Bonus Amount' : amount < 0 ? 'Deduction Amount' : 'Adjustment Amount';
  const amountColor = amount > 0 ? 'text-emerald-600' : amount < 0 ? 'text-red-600' : 'text-slate-700';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 p-0 sm:flex sm:items-center sm:justify-center sm:p-4">
      <div className="flex h-[100dvh] w-full max-w-lg flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[90vh] sm:rounded-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-slate-800 text-lg">Management Decision</h3>
            <p className="text-sm text-slate-500 mt-0.5">{employeeName}</p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-slate-600">×</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Instructions */}
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
            <p className="text-sm text-blue-700">
              <span className="font-semibold">How it works:</span> Enter a positive amount for bonuses (extra pay) or a negative amount for deductions. The adjustment will be added to the Net Payable.
            </p>
          </div>

          {!uploadId && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
              <p className="text-sm text-amber-700">
                <span className="font-semibold">⚠️ No attendance data:</span> This adjustment is being saved without an attendance upload. Salary calculations (absent days, LOP, etc.) require attendance data to be uploaded first.
              </p>
            </div>
          )}

          {/* Amount Field */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {amountLabel} *
            </label>
            <div className="relative">
              <span className={`absolute left-3 top-1/2 -translate-y-1/2 font-bold ${amountColor}`}>
                {amount === 0 ? '₹' : amount > 0 ? '+₹' : '-₹'}
              </span>
              <input
                type="number"
                value={Math.abs(amount)}
                onChange={e => setAmount(Number(e.target.value) * (amount < 0 ? -1 : 1))}
                className="w-full border border-slate-200 rounded-lg pl-10 pr-3 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                placeholder="0"
                step="0.01"
              />
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setAmount(Math.abs(amount))}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${amount >= 0 ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-emerald-50 hover:border-emerald-300'}`}
              >
                Bonus (+)
              </button>
              <button
                type="button"
                onClick={() => setAmount(Math.abs(amount) * -1)}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${amount < 0 ? 'bg-red-50 border-red-300 text-red-700' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-red-50 hover:border-red-300'}`}
              >
                Deduction (-)
              </button>
              {amount !== 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(0)}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            {amount !== 0 && (
              <p className="mt-2 text-xs text-slate-500">
                This will {amount > 0 ? 'add' : 'deduct'} {formatINR(Math.abs(amount))} {amount > 0 ? 'to' : 'from'} the employee's Net Payable
              </p>
            )}
          </div>

          {/* Remarks Field */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Remarks / Comments {amount !== 0 && <span className="text-red-500">*</span>}
            </label>
            <textarea
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              placeholder={amount !== 0 ? "Please provide the reason for this adjustment (minimum 10 characters)..." : "Optional: Add notes for this adjustment..."}
              rows={3}
              maxLength={500}
              className={`w-full border rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 ${amount !== 0 && remarks.trim().length < 10 ? 'border-red-300 focus:ring-red-500/20 focus:border-red-500' : 'border-slate-200 focus:ring-blue-500/20 focus:border-blue-500'}`}
            />
            <div className="mt-1 flex justify-between">
              <span className={`text-xs ${amount !== 0 && remarks.trim().length < 10 ? 'text-red-500' : 'text-slate-400'}`}>
                {amount !== 0 && remarks.trim().length < 10
                  ? `Minimum 10 characters required (${remarks.trim().length}/10)`
                  : remarks.length > 0
                  ? `${remarks.length}/500 characters`
                  : 'Optional when amount is 0'}
              </span>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Current Adjustment Display */}
          {hasAdjustment && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
              <p className="text-xs font-semibold text-slate-500 mb-2">CURRENT ADJUSTMENT</p>
              <div className="flex items-center justify-between">
                <span className={`text-lg font-bold ${currentAdjustment > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {formatINR(currentAdjustment)}
                </span>
                <span className="text-xs text-slate-600 max-w-[200px] truncate" title={currentRemarks}>
                  {currentRemarks}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
          <div className="flex gap-2">
            {hasAdjustment && (
              <button
                onClick={handleDelete}
                disabled={deleting || saving}
                className="px-4 py-2.5 text-sm font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {deleting ? 'Removing...' : 'Remove'}
              </button>
            )}
            <button
              onClick={onClose}
              disabled={saving || deleting}
              className="px-4 py-2.5 text-sm font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || deleting || (amount !== 0 && remarks.trim().length < 10)}
            className="px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {saving ? 'Saving...' : amount === 0 && hasAdjustment ? 'Remove Adjustment' : 'Save Adjustment'}
          </button>
        </div>
      </div>
    </div>
  );
}
