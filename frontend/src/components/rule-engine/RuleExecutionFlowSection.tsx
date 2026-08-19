/**
 * Rule Execution Flow (by Priority) — business-process-automation workflow.
 *
 * Used in two places with the same clean design:
 *  - Rule Engine page (/rule-engine) — seeded demo rules, "Half Day Rule" preselected
 *  - Rules Engine → Rule Management (Administration) — real rules from the
 *    database passed via props; the selected card tracks the rule open in
 *    the Rule Builder, and clicking a card opens that rule for editing.
 *
 * Design (per spec):
 *  - White card, 16px rounded corners, subtle shadow (0px 2px 8px rgba(0,0,0,0.05))
 *  - Title: "Rule Execution Flow (by Priority)" — Inter SemiBold 18px #111827
 *  - ~160×90px rule cards: blue circular number badge (#2563EB), bold rule name,
 *    "Priority: N" gray text, Active badge (#DCFCE7/#16A34A) or Inactive
 *    (#FEE2E2/#DC2626)
 *  - Selected card: blue border + subtle blue tint + hover effect
 *  - Thin right-facing arrows between cards, ~24px spacing
 */

import { useState } from 'react';

export interface FlowRuleData {
  id: number;
  name: string;
  priority: number;
  active: boolean;
}

export interface RuleExecutionFlowSectionProps {
  /** Real rules (Administration). When omitted, seeded demo rules are shown (menu page). */
  rules?: FlowRuleData[];
  /** Rule currently open in the builder — gets the blue selection highlight. */
  selectedRuleId?: number | null;
  /** Called when a card is clicked (e.g. to open the rule in the builder). */
  onRuleClick?: (rule: FlowRuleData) => void;
}

const SEEDED_FLOW_RULES: FlowRuleData[] = [
  { id: 1, name: 'Holiday Rule', priority: 1, active: true },
  { id: 2, name: 'Leave Rule', priority: 2, active: true },
  { id: 3, name: 'Half Day Rule', priority: 3, active: true },
  { id: 4, name: 'Late Coming Rule', priority: 4, active: true },
  { id: 5, name: 'Overtime Rule', priority: 5, active: true },
];

/** Thin arrow connecting two rule cards — down on phones, right on ≥sm. */
function FlowArrow() {
  return (
    <div className="flex shrink-0 items-center justify-center max-sm:my-1 max-sm:h-6 sm:mx-0" aria-hidden="true">
      <span className="hidden h-[2px] w-2.5 rounded-full bg-[#D1D5DB] sm:block" />
      <span className="material-icons text-[18px] text-[#9CA3AF] max-sm:rotate-90">arrow_forward</span>
      <span className="hidden h-[2px] w-2.5 rounded-full bg-[#D1D5DB] sm:block" />
    </div>
  );
}

export default function RuleExecutionFlowSection({ rules, selectedRuleId, onRuleClick }: RuleExecutionFlowSectionProps) {
  // Real rules (when provided) sorted by priority; otherwise the seeded demo set.
  const flowRules = rules ? [...rules].sort((a, b) => a.priority - b.priority) : SEEDED_FLOW_RULES;

  // Selection: controlled via prop on the Administration tab (tracks the builder
  // draft); local state with "Half Day Rule" preselected on the menu page.
  const isControlled = selectedRuleId !== undefined;
  const [localSelectedId, setLocalSelectedId] = useState<number | null>(3);
  const effectiveSelectedId = isControlled ? selectedRuleId : localSelectedId;

  const handleCardClick = (rule: FlowRuleData) => {
    if (!isControlled) setLocalSelectedId((cur) => (cur === rule.id ? null : rule.id));
    onRuleClick?.(rule);
  };

  return (
    <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-6 shadow-[0px_2px_8px_rgba(0,0,0,0.05)]">
      {/* ─── Title ─── */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[18px] font-semibold leading-tight text-[#111827]">Rule Execution Flow (by Priority)</h2>
        <p className="text-[13px] text-[#6B7280]">
          {flowRules.length > 0
            ? `${flowRules.length} rule${flowRules.length > 1 ? 's' : ''} · executing left to right by priority`
            : 'Rules execute from left to right based on priority'}
        </p>
      </div>

      {/* ─── Workflow canvas ─── */}
      {flowRules.length === 0 ? (
        <div className="py-12 text-center">
          <span className="material-icons block text-[44px] leading-none text-[#E5E7EB]">account_tree</span>
          <p className="mt-3 text-[13px] font-medium text-[#6B7280]">No rules yet — create a rule to start the execution flow.</p>
        </div>
      ) : (
        <div className="overflow-x-auto pb-1 sm:block max-sm:overflow-visible">
          <div className="flex min-w-max flex-col items-stretch gap-4 sm:gap-6 sm:flex-row">
            {flowRules.map((rule, idx) => {
              const isSelected = rule.id === effectiveSelectedId;
              return (
                <div key={rule.id} className="flex flex-col items-stretch gap-4 sm:flex-row sm:gap-6">
                  <button
                    type="button"
                    onClick={() => handleCardClick(rule)}
                    title={`${rule.name} — Priority ${rule.priority}`}
                    className={`flex h-[90px] w-full shrink-0 cursor-pointer flex-col justify-between rounded-[12px] border bg-white p-3 text-left shadow-[0px_2px_8px_rgba(0,0,0,0.05)] transition-all duration-200 sm:w-[160px] ${
                      isSelected
                        ? 'border-[#2563EB] bg-[#F5F9FF] shadow-[0px_2px_10px_rgba(37,99,235,0.12)]'
                        : 'border-[#E5E7EB] hover:-translate-y-0.5 hover:border-[#93C5FD] hover:shadow-[0px_4px_12px_rgba(0,0,0,0.08)]'
                    }`}
                  >
                    {/* Top row: number badge + status */}
                    <div className="flex items-start justify-between">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#2563EB] text-[12px] font-semibold text-white">
                        {idx + 1}
                      </span>
                      {rule.active ? (
                        <span className="rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[10px] font-semibold text-[#16A34A]">Active</span>
                      ) : (
                        <span className="rounded-full bg-[#FEE2E2] px-2 py-0.5 text-[10px] font-semibold text-[#DC2626]">Inactive</span>
                      )}
                    </div>

                    {/* Rule name + priority */}
                    <div>
                      <p className="truncate text-[13px] font-semibold text-[#111827]">{rule.name}</p>
                      <p className="text-[11px] text-[#6B7280]">Priority: {rule.priority}</p>
                    </div>
                  </button>

                  {idx < flowRules.length - 1 && <FlowArrow />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}