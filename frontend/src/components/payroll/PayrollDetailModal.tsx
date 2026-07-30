import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import clsx from 'clsx';
import * as api from '../../api';
import { downloadEmployeePunchPdf } from '../attendance/punchTimingPdf';
import { fmtINR, fmtNum } from './format';

interface Props {
  uploadId: number;
  employeeId: number;
  employeeName: string;
  onClose: () => void;
}

const CLASS_LABEL: Record<string, string> = {
  not_uploaded: 'Not Attempted',
  present: 'Present',
  half: 'Half Day',
  absent: 'Absent',
  weekly_off: 'Weekly Off',
  holiday: 'Holiday',
  missing_punch: 'Missing Punch',
  late: 'Late Coming',
  early: 'Early Leaving',
};

const CLASS_COLOR: Record<string, string> = {
  not_uploaded: 'bg-slate-50 text-slate-500 ring-slate-200',
  present: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  half: 'bg-amber-50 text-amber-700 ring-amber-100',
  absent: 'bg-rose-50 text-rose-700 ring-rose-100',
  weekly_off: 'bg-slate-100 text-slate-600 ring-slate-200',
  holiday: 'bg-slate-100 text-slate-600 ring-slate-200',
  missing_punch: 'bg-orange-50 text-orange-700 ring-orange-100',
  late: 'bg-yellow-50 text-yellow-700 ring-yellow-100',
  early: 'bg-blue-50 text-blue-700 ring-blue-100',
};

function Icon({ name, className = 'text-base' }: { name: string; className?: string }) {
  return <span className={clsx('material-icons leading-none', className)}>{name}</span>;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'HR';
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          <Icon name={icon} className="text-base" />
        </div>
        <h4 className="text-sm font-bold text-slate-900">{title}</h4>
      </div>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
  tone = 'default',
  onClick,
  actionLabel,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'strong' | 'red' | 'green' | 'amber';
  onClick?: () => void;
  actionLabel?: string;
}) {
  const content = (
    <>
      <span className="text-sm text-slate-500">{label}</span>
      <span className="flex items-center gap-2">
        {actionLabel && <span className="text-xs font-bold text-indigo-600">{actionLabel}</span>}
        <span className={clsx(
          'text-right text-sm',
          tone === 'strong' && 'font-bold text-slate-900',
          tone === 'red' && 'font-bold text-rose-600',
          tone === 'green' && 'font-bold text-emerald-700',
          tone === 'amber' && 'font-bold text-amber-700',
          tone === 'default' && 'font-semibold text-slate-700',
        )}>
          {value}
        </span>
      </span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-between gap-4 border-b border-slate-100 py-2 text-left transition hover:bg-slate-50 last:border-0"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
      {content}
    </div>
  );
}

function formatDateChip(date: string) {
  const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return date || '-';
  return `${match[3]} ${new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleString('en-US', { month: 'short' })}`;
}

function DateChips({ label, dates, tone = 'slate' }: { label: string; dates?: string[]; tone?: 'slate' | 'red' | 'blue' | 'amber' }) {
  const list = Array.isArray(dates) ? dates.filter(Boolean) : [];
  if (list.length === 0) return null;
  return (
    <div className="border-b border-slate-100 py-2 last:border-0">
      <p className="mb-2 text-xs font-semibold text-slate-500">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {list.map(date => (
          <span
            key={date}
            className={clsx(
              'rounded-full border px-2 py-1 text-[11px] font-bold',
              tone === 'slate' && 'border-slate-200 bg-slate-50 text-slate-600',
              tone === 'red' && 'border-rose-200 bg-rose-50 text-rose-700',
              tone === 'blue' && 'border-indigo-200 bg-indigo-50 text-indigo-700',
              tone === 'amber' && 'border-amber-200 bg-amber-50 text-amber-700',
            )}
          >
            {formatDateChip(date)}
          </span>
        ))}
      </div>
    </div>
  );
}

function DeductionDateDetails({
  label,
  dates,
  amountPerDate,
  reason,
  totalAmount,
  tone = 'slate',
}: {
  label: string;
  dates?: string[];
  amountPerDate: number;
  reason: string;
  totalAmount?: number;
  tone?: 'slate' | 'red' | 'blue' | 'amber';
}) {
  const list = Array.isArray(dates) ? dates.filter(Boolean) : [];
  if (list.length === 0) {
    return (
      <div className="border-b border-slate-100 py-2 last:border-0">
        <p className="text-xs font-semibold text-slate-500">{label}</p>
        <p className="mt-1 text-xs text-slate-400">No dates found for this item.</p>
      </div>
    );
  }
  const total = totalAmount ?? Math.round(list.length * amountPerDate);
  const isDeductionTone = tone === 'red' || tone === 'amber';
  return (
    <div className="border-b border-slate-100 py-2 last:border-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
        <span className={clsx('text-xs font-bold', total > 0 && isDeductionTone ? 'text-rose-600' : 'text-emerald-700')}>
          Total INR {fmtINR(total)}
        </span>
      </div>
      <div className="space-y-1.5">
        {list.map(date => (
          <div
            key={date}
            className={clsx(
              'grid grid-cols-[72px_1fr_auto] items-center gap-2 rounded-xl border px-3 py-2 text-xs',
              tone === 'slate' && 'border-slate-200 bg-slate-50 text-slate-600',
              tone === 'red' && 'border-rose-200 bg-rose-50 text-rose-700',
              tone === 'blue' && 'border-indigo-200 bg-indigo-50 text-indigo-700',
              tone === 'amber' && 'border-amber-200 bg-amber-50 text-amber-700',
            )}
          >
            <span className="font-bold">{formatDateChip(date)}</span>
            <span className="text-slate-600">{reason}</span>
            <span className={clsx('font-bold', amountPerDate > 0 && isDeductionTone ? 'text-rose-600' : 'text-emerald-700')}>
              INR {fmtINR(amountPerDate)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LateDeductionDetails({ dates, dailySalary, deductionDays, totalAmount }: { dates?: string[]; dailySalary: number; deductionDays: number; totalAmount: number }) {
  const list = Array.isArray(dates) ? dates.filter(Boolean) : [];
  const deductedCount = Math.max(0, deductionDays) * 3;
  const deductedDates = list.slice(0, deductedCount);
  const warningDates = list.slice(deductedCount);
  const groups = Array.from({ length: Math.max(0, deductionDays) }, (_, index) => deductedDates.slice(index * 3, index * 3 + 3));

  return (
    <div className="border-b border-slate-100 py-2 last:border-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Late deduction dates</p>
        <span className={clsx('text-xs font-bold', totalAmount > 0 ? 'text-rose-600' : 'text-emerald-700')}>
          Total INR {fmtINR(totalAmount)}
        </span>
      </div>
      {groups.length > 0 ? (
        <div className="space-y-1.5">
          {groups.map((group, index) => (
            <div key={index} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-amber-800">Deduction group {index + 1}</p>
                  <p className="mt-1 text-slate-600">{group.map(formatDateChip).join(', ')}</p>
                  <p className="mt-1 text-slate-500">Every 3 late arrivals = 1 salary day deduction</p>
                </div>
                <span className="font-bold text-rose-600">INR {fmtINR(dailySalary)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500">No late salary deduction. Late arrivals have not reached the deduction threshold.</p>
      )}
      {warningDates.length > 0 && (
        <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="font-bold">Warning only:</span> {warningDates.map(formatDateChip).join(', ')} - INR 0 deducted
        </div>
      )}
    </div>
  );
}

function RuleMoneyDetails({ rule }: { rule: any }) {
  const dates = Array.isArray(rule?.dates) ? rule.dates.filter(Boolean) : [];
  const deducted = ruleDeductionAmount(rule);
  const policyDeducted = rulePolicyDeductionAmount(rule);
  const allowance = ruleAllowanceAmount(rule);
  const amount = deducted || policyDeducted || allowance || 0;
  const amountPerDate = Number(rule?.amountPerDate) || Math.round(amount / Math.max(1, dates.length || Number(rule?.repeatCount) || 1));
  const isAllowance = allowance > 0;
  const threshold = Math.max(0, Number(rule?.threshold) || 0);
  const repeatCount = Math.max(0, Number(rule?.repeatCount) || 0);
  const shouldGroupDeduction = !isAllowance && deducted > 0 && threshold > 1 && repeatCount > 0;
  const groupedDates = shouldGroupDeduction
    ? Array.from({ length: repeatCount }, (_, index) => dates.slice(index * threshold, index * threshold + threshold).filter(Boolean))
    : [];
  const warningDates = shouldGroupDeduction ? dates.slice(repeatCount * threshold) : [];
  const totalLabel = isAllowance ? `+ INR ${fmtINR(allowance)}` : amount > 0 ? `- INR ${fmtINR(amount)}` : 'INR 0';

  return (
    <div className={clsx(
      'rounded-xl border px-3 py-2 text-xs',
      isAllowance && 'border-emerald-100 bg-emerald-50 text-emerald-800',
      !isAllowance && amount > 0 && 'border-rose-100 bg-rose-50 text-rose-800',
      !isAllowance && amount === 0 && 'border-slate-200 bg-slate-50 text-slate-700',
    )}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold">{rule.name}</p>
          <p className="mt-1 text-slate-600">{rule.reason || rule.label || 'Salary rule matched this employee.'}</p>
        </div>
        <span className={clsx('shrink-0 font-bold', isAllowance ? 'text-emerald-700' : amount > 0 ? 'text-rose-600' : 'text-slate-500')}>
          {totalLabel}
        </span>
      </div>
      {rule.label && <p className="mt-2 rounded-lg bg-white/70 px-2 py-1 font-semibold text-slate-600">{rule.label}</p>}
      {rule.formula && <p className="mt-2 text-slate-600">Formula: {rule.formula}</p>}
      {shouldGroupDeduction && groupedDates.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {groupedDates.map((group, index) => (
            <div key={index} className="rounded-lg bg-white/80 px-2 py-1.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-slate-700">Deduction group {index + 1}</p>
                  <p className="mt-1 text-slate-600">{group.map(formatDateChip).join(', ')}</p>
                  <p className="mt-1 text-slate-500">{threshold} matching dates = one salary effect</p>
                </div>
                <span className="font-bold text-rose-600">- INR {fmtINR(Math.round(deducted / Math.max(1, repeatCount)))}</span>
              </div>
            </div>
          ))}
          {warningDates.length > 0 && (
            <p className="rounded-lg bg-white/70 px-2 py-1 text-slate-500">
              Extra matched dates without salary deduction: {warningDates.map(formatDateChip).join(', ')}
            </p>
          )}
        </div>
      ) : dates.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {dates.map((date: string) => (
            <div key={date} className="grid grid-cols-[72px_1fr_auto] items-center gap-2 rounded-lg bg-white/80 px-2 py-1.5">
              <span className="font-bold">{formatDateChip(date)}</span>
              <span className="text-slate-600">{rule.reason || 'Rule matched on this date'}</span>
              <span className={clsx('font-bold', isAllowance ? 'text-emerald-700' : amountPerDate > 0 ? 'text-rose-600' : 'text-slate-500')}>
                {isAllowance ? '+' : amountPerDate > 0 ? '-' : ''} INR {fmtINR(amountPerDate)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 rounded-lg bg-white/70 px-2 py-1 text-slate-500">No individual dates found for this rule.</p>
      )}
    </div>
  );
}

function NetSalaryDateDetails({ detail, days }: { detail: any; days: any[] }) {
  const dailySalary = Math.round(Number(detail?.dailySalary) || 0);
  const paidLeaveDates = Array.isArray(detail?.paidLeaveDates) ? detail.paidLeaveDates : [];
  const paidAttendanceDates = days
    .filter(day => {
      const classification = displayClassification(day);
      return ['present', 'late', 'early', 'missing_punch'].includes(classification);
    })
    .map(day => String(day.date).slice(0, 10));
  const weeklyOffDates = days
    .filter(day => displayClassification(day) === 'weekly_off')
    .map(day => String(day.date).slice(0, 10));
  const holidayDates = days
    .filter(day => displayClassification(day) === 'holiday')
    .map(day => String(day.date).slice(0, 10));
  const paidDateCount = paidAttendanceDates.length + paidLeaveDates.length + weeklyOffDates.length + holidayDates.length;
  const paidDayAmount = paidDateCount * dailySalary;

  return (
    <div className="mt-3 rounded-2xl border border-emerald-100 bg-white p-3">
      <div className="mb-3 rounded-xl bg-emerald-50 px-3 py-2">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Paid days and calculation</p>
        <p className="mt-1 text-xs text-slate-600">
          These are the dates counted as paid salary days.
        </p>
      </div>
      <DeductionDateDetails
        label={`Paid attendance dates (${paidAttendanceDates.length} days)`}
        dates={paidAttendanceDates}
        amountPerDate={dailySalary}
        reason="Paid working day"
        totalAmount={paidAttendanceDates.length * dailySalary}
        tone="blue"
      />
      <DeductionDateDetails
        label={`Paid leave dates (${paidLeaveDates.length} days)`}
        dates={paidLeaveDates}
        amountPerDate={dailySalary}
        reason="Paid leave allowance, no deduction"
        totalAmount={paidLeaveDates.length * dailySalary}
        tone="blue"
      />
      <DeductionDateDetails
        label={`Paid weekly off dates (${weeklyOffDates.length} days)`}
        dates={weeklyOffDates}
        amountPerDate={dailySalary}
        reason="Paid weekly off"
        totalAmount={weeklyOffDates.length * dailySalary}
        tone="slate"
      />
      <DeductionDateDetails
        label={`Paid holiday dates (${holidayDates.length} days)`}
        dates={holidayDates}
        amountPerDate={dailySalary}
        reason="Paid holiday"
        totalAmount={holidayDates.length * dailySalary}
        tone="slate"
      />
      <Row label="Paid days calculation" value={`${paidDateCount} days x INR ${fmtINR(dailySalary)} = INR ${fmtINR(paidDayAmount)}`} tone="strong" />
      <Row label="Monthly salary" value={`INR ${fmtINR(detail?.monthlySalary || 0)}`} />
      <Row label="Minus deductions" value={`INR ${fmtINR(detail?.totalDeductions || 0)}`} tone={(detail?.totalDeductions || 0) > 0 ? 'red' : 'default'} />
      <Row label="Final net salary" value={`INR ${fmtINR(detail?.netSalary || 0)}`} tone="green" />
    </div>
  );
}

function DeductionSummaryPanel({ detail, reasons }: { detail: any; reasons: ReturnType<typeof deductionReasons> }) {
  const dailySalary = Math.round(Number(detail?.dailySalary) || 0);
  const halfDayAmount = Math.round(dailySalary / 2);
  const matchedRules = Array.isArray(detail?.matchedRules) ? detail.matchedRules : [];
  const hasAnyDeduction =
    reasons.absenceDeduction > 0 ||
    reasons.lateDeduction > 0 ||
    reasons.halfDayDeduction > 0 ||
    reasons.ruleDeduction > 0 ||
    Number(detail?.missingPunches || 0) > 0;

  return (
    <div className="mt-3 rounded-2xl border border-rose-100 bg-white p-3">
      <div className="mb-3 rounded-xl bg-rose-50 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-rose-700">Deduction reason and amount</p>
            <p className="mt-1 text-xs text-slate-600">Date-wise clarity for salary deductions.</p>
          </div>
          <span className="text-sm font-bold text-rose-700">INR {fmtINR(detail?.totalDeductions || 0)}</span>
        </div>
      </div>

      {!hasAnyDeduction && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
          No attendance or rule deduction found for this payroll.
        </p>
      )}

      {reasons.absenceDeduction > 0 && (
        <DeductionDateDetails
          label="Unpaid absence deduction"
          dates={detail.unpaidAbsenceDates}
          amountPerDate={dailySalary}
          reason="Unpaid absence / not attempted"
          totalAmount={reasons.absenceDeduction}
          tone="red"
        />
      )}

      {Number(detail?.missingPunches || 0) > 0 && (
        <DeductionDateDetails
          label="Missing punch alert"
          dates={detail.missingPunchDates}
          amountPerDate={0}
          reason="Alert only, no salary deduction"
          totalAmount={0}
          tone="amber"
        />
      )}

      {(Number(detail?.lateDays || 0) > 0 || reasons.lateDeduction > 0) && (
        <LateDeductionDetails
          dates={detail.lateDates}
          dailySalary={dailySalary}
          deductionDays={Number(detail?.lateDeductionDays) || 0}
          totalAmount={reasons.lateDeduction}
        />
      )}

      {reasons.halfDayDeduction > 0 && (
        <DeductionDateDetails
          label="Half-day deduction"
          dates={detail.halfDayDates}
          amountPerDate={halfDayAmount}
          reason="Worked less than 4 hours"
          totalAmount={reasons.halfDayDeduction}
          tone="amber"
        />
      )}

      {reasons.ruleDeduction > 0 && (
        <div className="border-b border-slate-100 py-2 last:border-0">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Rule deductions</p>
            <span className="text-xs font-bold text-rose-600">Total INR {fmtINR(reasons.ruleDeduction)}</span>
          </div>
          <div className="space-y-1.5">
            {matchedRules.filter((rule: any) => ruleDeductionAmount(rule) > 0).map((rule: any) => (
              <RuleMoneyDetails key={rule.id || rule.name} rule={rule} />
            ))}
          </div>
        </div>
      )}

      <Row label="Total deducted amount" value={`INR ${fmtINR(detail?.totalDeductions || 0)}`} tone="red" />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-400">{label}</p>
      <p className={clsx('mt-1 text-lg font-bold', tone)}>{value}</p>
    </div>
  );
}

function BreakdownBar({
  gross,
  deductions,
  net,
  onNetClick,
  netActionLabel,
  onDeductionsClick,
  deductionsActionLabel,
}: {
  gross: number;
  deductions: number;
  net: number;
  onNetClick?: () => void;
  netActionLabel?: string;
  onDeductionsClick?: () => void;
  deductionsActionLabel?: string;
}) {
  const total = Math.max(gross, 1);
  const deductionPct = Math.min(100, Math.max(0, (deductions / total) * 100));
  const netPct = Math.min(100, Math.max(0, (net / total) * 100));

  return (
    <div>
      <div className="mb-3 flex h-4 overflow-hidden rounded-full bg-slate-100">
        <div className="bg-gradient-to-r from-emerald-500 to-teal-500" style={{ width: `${netPct}%` }} />
        <div className="bg-gradient-to-r from-rose-500 to-red-500" style={{ width: `${deductionPct}%` }} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <button
          type="button"
          onClick={onNetClick}
          className="rounded-xl bg-emerald-50 p-2 transition hover:bg-emerald-100"
        >
          <p className="text-[11px] font-semibold text-emerald-600">Net</p>
          <p className="text-sm font-bold text-emerald-800">INR {fmtINR(net)}</p>
          {netActionLabel && <p className="mt-1 text-[10px] font-bold text-emerald-700">{netActionLabel}</p>}
        </button>
        <button
          type="button"
          onClick={onDeductionsClick}
          className="rounded-xl bg-rose-50 p-2 transition hover:bg-rose-100"
        >
          <p className="text-[11px] font-semibold text-rose-600">Deductions</p>
          <p className="text-sm font-bold text-rose-800">INR {fmtINR(deductions)}</p>
          {deductionsActionLabel && <p className="mt-1 text-[10px] font-bold text-rose-700">{deductionsActionLabel}</p>}
        </button>
        <div className="rounded-xl bg-indigo-50 p-2">
          <p className="text-[11px] font-semibold text-indigo-600">Gross</p>
          <p className="text-sm font-bold text-indigo-800">INR {fmtINR(gross)}</p>
        </div>
      </div>
    </div>
  );
}

function ruleDeductionAmount(rule: any) {
  if (typeof rule?.deductionAmount === 'number') return rule.deductionAmount;
  return rule?.amount < 0 ? Math.abs(rule.amount) : 0;
}

function rulePolicyDeductionAmount(rule: any) {
  return Number(rule?.policyDeductionAmount) || 0;
}

function ruleAllowanceAmount(rule: any) {
  if (typeof rule?.allowanceAmount === 'number') return rule.allowanceAmount;
  return rule?.amount > 0 ? rule.amount : 0;
}

function monthDays(periodMonth?: string, days: any[] = []) {
  const fallbackMonth = days.find((day) => day?.date)?.date?.slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(String(periodMonth || '')) ? periodMonth : fallbackMonth;
  if (!month) return days;
  const [year, mon] = month.split('-').map(Number);
  const count = Math.min(new Date(year, mon, 0).getDate(), 30);
  const byDate = new Map(days.map((day) => [String(day.date).slice(0, 10), day]));
  return Array.from({ length: count }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, '0')}`;
    return byDate.get(date) || {
      date,
      rawStatus: 'Not Attempted',
      classification: 'not_uploaded',
      timeIn: null,
      timeOut: null,
      workingHours: 0,
      isLate: false,
    };
  });
}

function displayClassification(day: any) {
  return String(day?.rawStatus || '').toLowerCase() === 'not attempted' ? 'not_uploaded' : day?.classification;
}

function deductionReasons(d: any) {
  const dailySalary = Number(d?.dailySalary) || 0;
  const missingPunches = Number(d?.missingPunches) || 0;
  const lateDays = Number(d?.lateDays) || 0;
  const lateDeductionDays = Number(d?.lateDeductionDays) || 0;
  const halfDays = Number(d?.halfDays) || 0;
  const absentDays = Number(d?.absentDays) || 0;
  const totalAbsentDays = Number(d?.totalAbsentDays ?? d?.absentDays) || 0;
  const matchedRules = Array.isArray(d?.matchedRules) ? d.matchedRules : [];
  const absenceDeduction = Number(d?.absentDeduction) || Math.round(dailySalary * absentDays);
  const missingPunchDeduction = 0;
  const lateDeduction = Math.round(dailySalary * lateDeductionDays);
  const halfDayDeduction = Number(d?.halfDayDeduction) || 0;
  const ruleDeduction = Number(d?.ruleDeductionAmount) || 0;
  const ruleNames = matchedRules
    .filter((rule: any) => ruleDeductionAmount(rule) > 0)
    .map((rule: any) => rule.name)
    .filter(Boolean)
    .join(', ');

  return {
    absenceDeduction,
    absenceLabel: totalAbsentDays > 0
      ? `Absent salary impact (${totalAbsentDays} total, ${absentDays} unpaid x per-day salary)`
      : 'Absent salary impact',
    missingPunchDeduction,
    missingPunchLabel: missingPunches > 0
      ? `Missing punch alert (${missingPunches} missing punch${missingPunches === 1 ? '' : 'es'} - no salary deduction)`
      : 'Missing punch alert',
    lateDeduction,
    lateDeductionLabel: lateDeductionDays > 0
      ? `Late coming deduction (${lateDays} late arrivals = ${lateDeductionDays} salary day${lateDeductionDays === 1 ? '' : 's'})`
      : 'Late coming deduction',
    halfDayDeduction,
    halfDayLabel: halfDays > 0
      ? `Half-day salary impact (${halfDays} half day${halfDays === 1 ? '' : 's'} x half-day salary)`
      : 'Half-day salary impact',
    ruleDeduction,
    ruleDeductionLabel: ruleDeduction > 0
      ? `Rule deductions (${ruleNames || 'salary rules'})`
      : 'Rule deductions',
  };
}

export default function PayrollDetailModal({ uploadId, employeeId, employeeName, onClose }: Props) {
  const [showAbsenceDates, setShowAbsenceDates] = useState(false);
  const [showMissingPunchDates, setShowMissingPunchDates] = useState(false);
  const [showLateDates, setShowLateDates] = useState(false);
  const [showHalfDayDates, setShowHalfDayDates] = useState(false);
  const [showRuleDetails, setShowRuleDetails] = useState(false);
  const [showNetDetails, setShowNetDetails] = useState(false);
  const [showBreakdownDeductions, setShowBreakdownDeductions] = useState(false);
  const [showFinalCalculation, setShowFinalCalculation] = useState(false);
  const { data: d, isLoading, error } = useQuery({
    queryKey: ['payroll-detail', uploadId, employeeId],
    queryFn: () => api.getPayrollEmployeeDetail(uploadId, employeeId).then(r => r.data),
  });

  function handleTimingPdf() {
    if (!d) return;
    downloadEmployeePunchPdf({
      name: employeeName,
      employeeNumber: d.employeeNumber,
      biometricId: d.biometricId,
      department: d.department,
      designation: d.designation,
      days: (d.days || []).map((day: any) => ({
        date: day.date,
        timeIn: day.timeIn,
        timeOut: day.timeOut,
        workingHours: day.workingHours,
      })),
    });
  }

  const statutoryDeductions = [
    { label: 'PF', value: d?.pf || d?.providentFund || 0 },
    { label: 'ESI', value: d?.esi || 0 },
    { label: 'Loan', value: d?.loan || 0 },
    { label: 'Advances', value: d?.advances || d?.advance || 0 },
    { label: 'Professional Tax', value: d?.professionalTax || 0 },
  ];
  const reasons = deductionReasons(d);
  const fullMonthDays = monthDays(d?.periodMonth, Array.isArray(d?.days) ? d.days : []);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/45 backdrop-blur-sm">
      <button aria-label="Close payroll details" onClick={onClose} className="hidden flex-1 cursor-default md:block" />
      <aside className="animate-slide-in-right flex h-full w-full max-w-3xl flex-col bg-slate-50 shadow-2xl">
        <header className="border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-fuchsia-600 text-lg font-bold text-white shadow-lg shadow-indigo-200">
                {initials(employeeName)}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wide text-indigo-600">Employee salary details</p>
                <h3 className="truncate text-xl font-bold text-slate-950">{employeeName}</h3>
                <p className="truncate text-sm text-slate-500">
                  {d ? `${d.employeeNumber || d.biometricId || d.employeeId} - ${d.department || 'Unassigned'} - ${d.designation || 'No designation'}` : 'Loading profile'}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900">
              <Icon name="close" className="text-xl" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {isLoading && (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-400">
              Loading salary calculation...
            </div>
          )}
          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center text-sm font-semibold text-rose-600">
              Failed to load payroll detail.
            </div>
          )}

          {d && (
            <div className="space-y-4">
              <section className="rounded-3xl bg-gradient-to-br from-slate-950 via-indigo-950 to-purple-900 p-5 text-white shadow-xl shadow-indigo-200">
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-indigo-200">Monthly salary</p>
                    <p className="mt-1 text-2xl font-bold">INR {fmtINR(d.monthlySalary)}</p>
                    <p className="mt-1 text-xs text-indigo-100">Daily: INR {fmtINR(d.dailySalary)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-indigo-200">Final net salary</p>
                    <p className="mt-1 text-2xl font-bold text-emerald-300">INR {fmtINR(d.netSalary)}</p>
                    <p className="mt-1 text-xs text-indigo-100">Payable days: {fmtNum(d.workingDays || d.payableDays, 1)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-indigo-200">Processing status</p>
                    <span className="mt-2 inline-flex rounded-full bg-white/15 px-3 py-1 text-sm font-bold text-white ring-1 ring-white/20">Calculated</span>
                  </div>
                </div>
              </section>

              <div className="grid gap-4 md:grid-cols-2">
                <Section title="Profile Details" icon="badge">
                  <Row label="Employee ID" value={d.employeeNumber || d.biometricId || String(d.employeeId)} />
                  <Row label="Department" value={d.department || '-'} />
                  <Row label="Designation" value={d.designation || '-'} />
                  <Row label="Shift" value={d.shift || '-'} />
                </Section>

                <Section title="Salary Breakdown" icon="donut_large">
                  <BreakdownBar
                    gross={d.grossSalary || 0}
                    deductions={d.totalDeductions || 0}
                    net={d.netSalary || 0}
                    onNetClick={() => setShowNetDetails(open => !open)}
                    netActionLabel={showNetDetails ? 'Hide details' : 'View details'}
                    onDeductionsClick={() => setShowBreakdownDeductions(open => !open)}
                    deductionsActionLabel={showBreakdownDeductions ? 'Hide details' : 'View details'}
                  />
                  {showNetDetails && <NetSalaryDateDetails detail={d} days={fullMonthDays} />}
                  {showBreakdownDeductions && <DeductionSummaryPanel detail={d} reasons={reasons} />}
                </Section>
              </div>

              <Section title="Attendance Summary" icon="event_available">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Present" value={d.presentDays} tone="text-emerald-700" />
                  <Stat label="Paid Leaves" value={d.paidLeave || 0} tone="text-indigo-700" />
                  <Stat label="Half Days" value={d.halfDays} tone="text-amber-700" />
                  <Stat label="Absences" value={d.totalAbsentDays ?? d.absentDays} tone="text-rose-700" />
                  <Stat label="Unpaid Absences" value={d.absentDays} tone="text-rose-700" />
                  <Stat label="Late Count" value={d.lateDays} tone="text-yellow-700" />
                  <Stat label="Missing Punch" value={d.missingPunches} tone="text-orange-700" />
                  <Stat label="Working Hours" value={fmtNum(d.totalWorkingHours, 1)} tone="text-slate-800" />
                  <Stat label="Overtime" value={fmtNum(d.overtimeHours || 0, 1)} tone="text-purple-700" />
                  <Stat label="Overtime Pay" value={`INR ${fmtINR(d.overtimePay || 0)}`} tone="text-emerald-700" />
                  <Stat label="Half-Day Deduction" value={`INR ${fmtINR(d.halfDayDeduction || 0)}`} tone="text-amber-700" />
                </div>
              </Section>

              <Section title="Salary Calculation Formula" icon="functions">
                <Row label="Monthly Salary" value={`INR ${fmtINR(d.monthlySalary)}`} />
                <Row label={`Monthly Salary / ${d.workingDays || 0} working days`} value={`INR ${fmtINR(d.dailySalary)} per day`} />
                <Row label={`Daily Salary / ${d.standardWorkingHours || 0} standard hours`} value={`INR ${fmtINR(d.hourlyRate)} per hour`} />
                <Row label={`Payable days`} value={`${fmtNum(d.workingDays || d.payableDays, 1)} days`} />
                <Row label={`Absent salary impact (${(d.totalAbsentDays ?? d.absentDays) || 0} total, ${d.absentDays || 0} unpaid x per-day salary)`} value={`INR ${fmtINR(reasons.absenceDeduction)}`} tone={reasons.absenceDeduction ? 'red' : 'default'} />
                <Row label="Base salary before deductions" value={`INR ${fmtINR(d.monthlySalary || 0)}`} />
                <Row label={`Half-day deduction (${d.halfDays || 0} half days x Monthly Salary / 30 / 2)`} value={`INR ${fmtINR(d.halfDayDeduction || 0)}`} tone={(d.halfDayDeduction || 0) > 0 ? 'amber' : 'default'} />
                <Row label="Overtime eligible only after 2 hours beyond shift end" value={`${fmtNum(d.overtimeHours || 0, 2)} hours`} tone={(d.overtimeHours || 0) > 0 ? 'green' : 'default'} />
                <Row label={`Overtime pay (${fmtNum(d.overtimeHours || 0, 2)} hours, half of Monthly Salary / 30 per eligible day)`} value={`INR ${fmtINR(d.overtimePay || 0)}`} tone={(d.overtimePay || 0) > 0 ? 'green' : 'default'} />
                <Row label="Gross Salary" value={`INR ${fmtINR(d.grossSalary)}`} tone="strong" />
              </Section>

              <div className="grid gap-4 md:grid-cols-2">
                <Section title="Deductions" icon="remove_circle">
                  {statutoryDeductions.map(item => <Row key={item.label} label={item.label} value={`INR ${fmtINR(item.value)}`} tone={item.value ? 'red' : 'default'} />)}
                  <Row
                    label={reasons.absenceLabel}
                    value={`INR ${fmtINR(reasons.absenceDeduction)}`}
                    tone={reasons.absenceDeduction ? 'red' : 'default'}
                    onClick={() => setShowAbsenceDates(open => !open)}
                    actionLabel={showAbsenceDates ? 'Hide dates' : 'View dates'}
                  />
                  {showAbsenceDates && (
                    <DeductionDateDetails
                      label="Deducted unpaid absence dates"
                      dates={d.unpaidAbsenceDates}
                      amountPerDate={Math.round(Number(d.dailySalary) || 0)}
                      reason="Unpaid absence / not attempted"
                      totalAmount={reasons.absenceDeduction}
                      tone="red"
                    />
                  )}
                  <Row
                    label={reasons.missingPunchLabel}
                    value={`INR ${fmtINR(reasons.missingPunchDeduction)}`}
                    tone={reasons.missingPunchDeduction ? 'red' : 'default'}
                    onClick={() => setShowMissingPunchDates(open => !open)}
                    actionLabel={showMissingPunchDates ? 'Hide dates' : 'View dates'}
                  />
                  {showMissingPunchDates && <DeductionDateDetails label="Missing punch dates" dates={d.missingPunchDates} amountPerDate={0} reason="Missing punch alert only, no salary deduction" totalAmount={0} tone="amber" />}
                  <Row
                    label={reasons.lateDeductionLabel}
                    value={`INR ${fmtINR(reasons.lateDeduction)}`}
                    tone={reasons.lateDeduction ? 'red' : 'default'}
                    onClick={() => setShowLateDates(open => !open)}
                    actionLabel={showLateDates ? 'Hide dates' : 'View dates'}
                  />
                  {showLateDates && (
                    <LateDeductionDetails
                      dates={d.lateDates}
                      dailySalary={Math.round(Number(d.dailySalary) || 0)}
                      deductionDays={Number(d.lateDeductionDays) || 0}
                      totalAmount={reasons.lateDeduction}
                    />
                  )}
                  <Row
                    label={reasons.ruleDeductionLabel}
                    value={`INR ${fmtINR(reasons.ruleDeduction)}`}
                    tone={reasons.ruleDeduction ? 'red' : 'default'}
                    onClick={() => setShowRuleDetails(open => !open)}
                    actionLabel={showRuleDetails ? 'Hide details' : 'View details'}
                  />
                  {showRuleDetails && (
                    <div className="border-b border-slate-100 py-2 last:border-0">
                      {Array.isArray(d.matchedRules) && d.matchedRules.length > 0 ? (
                        <div className="space-y-1.5">
                          {d.matchedRules.map((rule: any) => <RuleMoneyDetails key={rule.id || rule.name} rule={rule} />)}
                        </div>
                      ) : (
                        <p className="text-xs font-semibold text-slate-500">No salary rule matched this employee.</p>
                      )}
                    </div>
                  )}
                  <Row
                    label={reasons.halfDayLabel}
                    value={`INR ${fmtINR(reasons.halfDayDeduction)}`}
                    tone={reasons.halfDayDeduction ? 'amber' : 'default'}
                    onClick={() => setShowHalfDayDates(open => !open)}
                    actionLabel={showHalfDayDates ? 'Hide dates' : 'View dates'}
                  />
                  {showHalfDayDates && <DeductionDateDetails label="Half-day dates" dates={d.halfDayDates} amountPerDate={Math.round((Number(d.dailySalary) || 0) / 2)} reason="Worked less than 4 hours" totalAmount={reasons.halfDayDeduction} tone="amber" />}
                  <Row label="Total deductions" value={`INR ${fmtINR(d.totalDeductions || 0)}`} tone="red" />
                </Section>

                <Section title="Final Payable" icon="payments">
                  <Row label="Gross Salary" value={`INR ${fmtINR(d.grossSalary)}`} />
                  <Row label="Overtime Pay" value={`INR ${fmtINR(d.overtimePay || 0)}`} tone="green" />
                  <Row label="Rule allowances" value={`INR ${fmtINR(d.ruleAllowanceAmount || 0)}`} tone="green" />
                  <Row label="Total Deductions" value={`INR ${fmtINR(d.totalDeductions || 0)}`} tone="red" />
                  <button
                    type="button"
                    onClick={() => setShowFinalCalculation(open => !open)}
                    className="mt-3 w-full rounded-2xl bg-emerald-50 p-4 text-left transition hover:bg-emerald-100"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-emerald-600">Final net salary</p>
                      <span className="text-xs font-bold text-emerald-700">{showFinalCalculation ? 'Hide calculation' : 'View calculation'}</span>
                    </div>
                    <p className="mt-1 text-3xl font-bold text-emerald-800">INR {fmtINR(d.netSalary)}</p>
                  </button>
                  {showFinalCalculation && (
                    <div className="mt-3 rounded-2xl border border-emerald-100 bg-white p-3">
                      <Row label="Monthly salary" value={`INR ${fmtINR(d.monthlySalary || 0)}`} />
                      <Row label="Add overtime pay" value={`INR ${fmtINR(d.overtimePay || 0)}`} tone={(d.overtimePay || 0) > 0 ? 'green' : 'default'} />
                      {(d.overtimePay || 0) > 0 && (
                        <DeductionDateDetails
                          label="Overtime pay dates"
                          dates={d.overtimeDates}
                          amountPerDate={Math.round((Number(d.dailySalary) || 0) / 2)}
                          reason="Eligible overtime over 2 hours after shift end"
                          totalAmount={d.overtimePay || 0}
                          tone="blue"
                        />
                      )}
                      <Row label="Add rule allowances" value={`INR ${fmtINR(d.ruleAllowanceAmount || 0)}`} tone={(d.ruleAllowanceAmount || 0) > 0 ? 'green' : 'default'} />
                      {(d.ruleAllowanceAmount || 0) > 0 && (
                        <div className="border-b border-slate-100 py-2 last:border-0">
                          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Rule allowance details</p>
                          <div className="space-y-1.5">
                            {(Array.isArray(d.matchedRules) ? d.matchedRules : [])
                              .filter((rule: any) => ruleAllowanceAmount(rule) > 0)
                              .map((rule: any) => <RuleMoneyDetails key={rule.id || rule.name} rule={rule} />)}
                          </div>
                        </div>
                      )}
                      <Row label="Gross salary" value={`INR ${fmtINR(d.grossSalary || 0)}`} tone="strong" />
                      <Row label="Minus total deductions" value={`INR ${fmtINR(d.totalDeductions || 0)}`} tone={(d.totalDeductions || 0) > 0 ? 'red' : 'default'} />
                      <Row label="Final net salary" value={`INR ${fmtINR(d.netSalary || 0)}`} tone="green" />
                      <p className="mt-2 text-xs text-slate-500">
                        Formula: Gross salary - total deductions = final net salary.
                      </p>
                    </div>
                  )}
                </Section>
              </div>

              {fullMonthDays.length > 0 && (
                <Section title="Day-by-Day Records" icon="calendar_month">
                  <div className="max-h-80 overflow-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[560px] text-xs">
                      <thead className="sticky top-0 bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-3 py-2 text-left font-bold">Date</th>
                          <th className="px-3 py-2 text-left font-bold">In</th>
                          <th className="px-3 py-2 text-left font-bold">Out</th>
                          <th className="px-3 py-2 text-right font-bold">Hours</th>
                          <th className="px-3 py-2 text-left font-bold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {fullMonthDays.map((day: any, i: number) => {
                          const classification = displayClassification(day);
                          return (
                            <tr key={`${day.date}-${i}`} className="hover:bg-indigo-50/40">
                              <td className="px-3 py-2 font-semibold text-slate-700">{day.date}</td>
                              <td className="px-3 py-2 text-slate-500">{day.timeIn || '-'}</td>
                              <td className="px-3 py-2 text-slate-500">{day.timeOut || '-'}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{fmtNum(day.workingHours, 1)}</td>
                              <td className="px-3 py-2">
                                <span className={clsx('inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ring-1', CLASS_COLOR[classification] || 'bg-slate-100 text-slate-600 ring-slate-200')}>
                                  {CLASS_LABEL[classification] || day.rawStatus}
                                  {day.isLate ? ' - Late' : ''}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}
            </div>
          )}
        </div>

        <footer className="flex flex-col gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <button
            onClick={handleTimingPdf}
            disabled={!d}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            <Icon name="picture_as_pdf" className="text-base" />
            Punch Timing PDF
          </button>
          <button onClick={onClose} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50">
            Close
          </button>
        </footer>
      </aside>
    </div>
  );
}



