import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRules, getSettings } from '../api';
import clsx from 'clsx';

interface Rule {
  id: number;
  name: string;
  description: string | null;
  ruleType: string;
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>;
  priority: number;
  isActive: boolean;
  createdAt: string;
}

const RULE_TYPE_COLORS: Record<string, string> = {
  absence_threshold: 'bg-red-100 text-red-700',
  late_coming: 'bg-blue-100 text-blue-700',
  missed_swipe: 'bg-amber-100 text-amber-700',
  early_leaving: 'bg-orange-100 text-orange-700',
  escalation: 'bg-purple-100 text-purple-700',
  custom: 'bg-slate-100 text-slate-700',
};

/** Display minutes-after-midnight as a readable clock time. */
function minutesToClock(minutes: number): string {
  const m = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const h = Math.floor(m / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Read-only view of the rules payroll actually applies.
 *
 * The source of truth for payroll is the `attendance_rules` table (active rows)
 * plus the policy values in `settings` — both read by `getSalaryDeductions`.
 * This page shows exactly that, and deliberately offers no way to change it:
 * rules are created and maintained by admins in the Rules Engine / Settings.
 */
export default function RulesPage() {
  const [expandedRuleId, setExpandedRuleId] = useState<number | null>(null);

  const { data: rules = [], isLoading } = useQuery<Rule[]>({
    queryKey: ['rules'],
    queryFn: () => getRules().then(r => r.data),
  });

  const { data: settings = {} } = useQuery<Record<string, string>>({
    queryKey: ['settings'],
    queryFn: () => getSettings().then(r => r.data),
  });

  const activeRules = rules.filter(rule => rule.isActive);
  const inactiveRules = rules.filter(rule => !rule.isActive);

  // The same keys getSalaryDeductions reads — shown so the page reflects the
  // live policy payroll runs on, not a snapshot.
  const policy = {
    halfDayHours: Number(settings.half_day_threshold_hours || 4),
    lateAfter: minutesToClock(Number(settings.late_after_minutes || 570)),
    lateEvery: Number(settings.late_occurrences_for_deduction || 3),
    itLeaveLimit: Number(settings.it_paid_leave_limit || 2),
    nonItLeaveLimit: Number(settings.non_it_paid_leave_limit || 4),
  };

  function ruleBullets(rule: Rule) {
    const text = `${rule.name} ${rule.description || ''} ${JSON.stringify(rule.conditions)} ${JSON.stringify(rule.actions)}`.toLowerCase();
    if (text.includes('late')) return [
      'Late when check-in is after 09:30 AM',
      '3 late days = 1 loss-of-pay day',
      '6 late days = 2 loss-of-pay days',
      '9 late days = 3 loss-of-pay days',
    ];
    if (text.includes('half') || text.includes('4 hour')) return [
      'Working less than 4 hours = half day',
      'Half day = 0.5 loss-of-pay day',
    ];
    if (text.includes('absen')) return ['Full-day absence = 1 loss-of-pay day'];
    if (text.includes('missed') || text.includes('swipe')) return ['Missing check-in or check-out creates a missed-punch flag'];
    return (rule.description || 'This rule is applied to matching attendance records.')
      .split(/\n|(?<=[.!?])\s+/)
      .map(value => value.trim())
      .filter(Boolean);
  }

  function readableRuleName(rule: Rule) {
    const text = `${rule.name} ${rule.description || ''}`.toLowerCase();
    if (text.includes('late')) return 'Late-coming deduction';
    if (text.includes('half') || text.includes('4 hour')) return 'Half-day rule';
    if (text.includes('absen')) return 'Absence rule';
    if (text.includes('missed') || text.includes('swipe')) return 'Missed-punch rule';
    return rule.name;
  }

  function ruleExamples(rule: Rule) {
    const text = `${rule.name} ${rule.description || ''} ${JSON.stringify(rule.conditions)} ${JSON.stringify(rule.actions)}`.toLowerCase();
    if (text.includes('late')) return ['Check-in at 09:31 AM → late day', '3 late days → 1 loss-of-pay day'];
    if (text.includes('half') || text.includes('4 hour')) return ['Work 3 hours 59 minutes → half day', 'Half day → 0.5 loss-of-pay day'];
    if (text.includes('absen')) return ['No attendance for a scheduled day → 1 loss-of-pay day'];
    if (text.includes('missed') || text.includes('swipe')) return ['Only check-in or only check-out → missed-punch flag'];
    return ['The rule is checked against matching attendance records.'];
  }

  function ruleImpact(rule: Rule) {
    const text = `${rule.name} ${rule.description || ''} ${JSON.stringify(rule.conditions)} ${JSON.stringify(rule.actions)}`.toLowerCase();
    if (text.includes('late')) return 'Salary / Loss of Pay impact: adds one loss-of-pay day for every three late days.';
    if (text.includes('half') || text.includes('4 hour')) return 'Salary / Loss of Pay impact: adds 0.5 loss-of-pay day.';
    if (text.includes('absen')) return 'Salary / Loss of Pay impact: adds one loss-of-pay day for each full-day absence.';
    if (text.includes('missed') || text.includes('swipe')) return 'Salary / Loss of Pay impact: creates a missed-punch attendance flag.';
    return 'Salary / Loss of Pay impact depends on the rule action settings.';
  }

  function renderRuleCard(rule: Rule, index: number) {
    const expanded = expandedRuleId === rule.id;
    return (
      <div key={rule.id} className={clsx('min-w-0 overflow-hidden rounded-2xl border bg-white shadow-sm transition-shadow hover:shadow-md', rule.isActive ? 'border-slate-200' : 'border-slate-200 opacity-70')}>
        <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-start">
          <button type="button" onClick={() => setExpandedRuleId(expanded ? null : rule.id)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-500">{index + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-semibold', RULE_TYPE_COLORS[rule.ruleType] || 'bg-slate-100 text-slate-600')}>{rule.ruleType.replace(/_/g, ' ')}</span>
                <span className="text-xs text-slate-500">priority {rule.priority}</span>
                <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-semibold', rule.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}>{rule.isActive ? 'Applied in payroll' : 'Not applied'}</span>
              </span>
              <span className="mt-2 block break-words text-base font-semibold text-slate-800">{readableRuleName(rule)}</span>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                {ruleBullets(rule).map((bullet, bulletIndex) => <li key={bulletIndex}>{bullet}</li>)}
              </ul>
            </span>
            <span className="mt-1 shrink-0 text-slate-400"><span className="material-icons text-2xl">{expanded ? 'expand_less' : 'expand_more'}</span></span>
          </button>
          <div className="flex shrink-0 items-center gap-2 lg:justify-end">
            <span className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-400" title="This tab is view-only">
              <span className="material-icons text-base">visibility</span> View only
            </span>
          </div>
        </div>
        {expanded && (
          <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-5 pl-6 sm:px-5 sm:pl-16">
            <div className="grid gap-5 md:grid-cols-3">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">What it means</p><p className="mt-1.5 text-sm leading-relaxed text-slate-700">{rule.description || 'This rule is checked against matching attendance records.'}</p></div>
              <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Examples</p><ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-700">{ruleExamples(rule).map((example, exampleIndex) => <li key={exampleIndex}>{example}</li>)}</ul></div>
              <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Calculation</p><p className="mt-1.5 text-sm leading-relaxed text-slate-700">{ruleImpact(rule)}</p></div>
            </div>
            <details className="mt-5 text-sm"><summary className="cursor-pointer select-none font-medium text-slate-500 hover:text-slate-700">Show technical details</summary><div className="mt-2.5 grid gap-2.5 md:grid-cols-2"><div className="min-w-0 overflow-hidden rounded-lg bg-white px-3.5 py-2.5"><span className="font-medium text-slate-500">Conditions: </span><code className="break-all text-sm text-slate-700">{JSON.stringify(rule.conditions)}</code></div><div className="min-w-0 overflow-hidden rounded-lg bg-white px-3.5 py-2.5"><span className="font-medium text-slate-500">Actions: </span><code className="break-all text-sm text-slate-700">{JSON.stringify(rule.actions)}</code></div></div></details>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6 lg:mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">Payroll Rules</h1>
          <p className="text-slate-500 text-sm sm:text-base mt-1.5">The rules HRPulse applies when calculating salary and loss of pay. View only.</p>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-4 sm:px-5 text-sm sm:text-base leading-relaxed text-indigo-900">
        <span className="font-semibold">Read-only:</span> this tab shows exactly which rules the payroll applies. Rules cannot be created, edited, or switched from here — only active rules are used in salary / loss-of-pay calculations.
      </div>

      {/* Payroll policy settings the salary calculation reads */}
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <span className="material-icons text-xl text-slate-400">tune</span>
          <h2 className="text-base font-semibold text-slate-800">Payroll policy settings</h2>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">view only</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <p className="text-sm text-slate-500">Half day below</p>
            <p className="mt-0.5 text-lg font-semibold text-slate-800">{policy.halfDayHours} hours</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <p className="text-sm text-slate-500">Late after</p>
            <p className="mt-0.5 text-lg font-semibold text-slate-800">{policy.lateAfter}</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <p className="text-sm text-slate-500">Late days per LOP</p>
            <p className="mt-0.5 text-lg font-semibold text-slate-800">{policy.lateEvery}</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <p className="text-sm text-slate-500">Paid leave limit (IT)</p>
            <p className="mt-0.5 text-lg font-semibold text-slate-800">{policy.itLeaveLimit} days / month</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <p className="text-sm text-slate-500">Paid leave limit (non-IT)</p>
            <p className="mt-0.5 text-lg font-semibold text-slate-800">{policy.nonItLeaveLimit} days / month</p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-slate-400">
          <span className="material-icons animate-spin text-4xl block mb-2">refresh</span>Loading rules...
        </div>
      ) : rules.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <span className="material-icons text-6xl block mb-3 opacity-30">rule</span>
          <p className="text-lg font-medium mb-2 text-slate-500">No rules configured</p>
          <p className="text-sm sm:text-base">No payroll rules exist yet. An administrator can create them in the Rules Engine.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {activeRules.length > 0 && (
            <section>
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                <span className="material-icons text-lg text-emerald-500">check_circle</span>
                Applied in payroll ({activeRules.length})
              </h2>
              <div className="flex flex-col gap-4">
                {activeRules.map((rule, index) => renderRuleCard(rule, index))}
              </div>
            </section>
          )}
          {inactiveRules.length > 0 && (
            <section>
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                <span className="material-icons text-lg text-slate-400">block</span>
                Not applied ({inactiveRules.length})
              </h2>
              <div className="flex flex-col gap-4">
                {inactiveRules.map((rule, index) => renderRuleCard(rule, index))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}