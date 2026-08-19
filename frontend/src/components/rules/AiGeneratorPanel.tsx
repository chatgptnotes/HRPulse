/**
 * AI Rule Generator panel (Gemini via the rules-engine-ai edge function).
 *
 * Flow: type a natural-language instruction → Generate. If the AI needs more
 * detail it returns clarifying questions which render as inputs; answering
 * them re-submits. A complete draft is previewed and applied into the Rule
 * Builder for review before saving.
 *
 * Visual system: white card with subtle blue border, highlighted AI badge,
 * modern textarea with blue focus ring, prominent gradient Generate button.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import clsx from 'clsx';
import { generateRuleWithAI, type AiGeneratedRule, type AiClarifyQuestion } from '../../api/rulesEngine';
import { operatorLabel, fieldDef, actionTypeMeta } from '../../lib/ruleFields';

const EXAMPLES = [
  'If employee works less than 4 hours mark attendance as half day',
  'If employee is late more than three times in a month deduct ₹500 from salary',
  'If day is Sunday then overtime multiplier should be 2',
  'If leave balance is 2 or less send a notification to the employee and HR',
];

export default function AiGeneratorPanel({ onApply }: { onApply: (rule: AiGeneratedRule) => void }) {
  const [instruction, setInstruction] = useState('');
  const [questions, setQuestions] = useState<AiClarifyQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<AiGeneratedRule | null>(null);
  const [error, setError] = useState('');

  const generate = useMutation({
    mutationFn: async () => {
      setError('');
      return generateRuleWithAI(instruction, questions ? answers : null);
    },
    onSuccess: (result) => {
      if (result.status === 'clarify') {
        setQuestions(result.questions);
        setAnswers({});
        setPreview(null);
      } else {
        setPreview(result.rule);
        setQuestions(null);
      }
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const reset = () => {
    setQuestions(null);
    setAnswers({});
    setPreview(null);
    setError('');
    setInstruction('');
  };

  const describeCondition = (c: AiGeneratedRule['conditions'][number]) =>
    `${fieldDef(c.field)?.label ?? c.field} ${operatorLabel(c.operator)} ${String(c.value)}`;

  const describeAction = (a: Record<string, any>) => {
    const type = a.actionType ?? a.action_type ?? 'set';
    const label = actionTypeMeta(type)?.label ?? type;
    const target = a.targetField ?? a.target_field;
    if (type === 'sendNotification') return `Notify ${a.notificationRecipients ?? a.notification_recipients ?? 'employee'} (${a.notificationTemplate ?? a.notification_template ?? 'template'})`;
    if (type === 'subtract' || type === 'add') { const qty = a.amount != null ? `₹${a.amount}` : (a.percent != null ? `${a.percent}%` : ''); return `${label} ${qty} ${target ? `on ${target}` : ''}`.trim(); }
    if (type === 'calculate') return `Set ${target} = ${a.formula}`;
    if (a.value !== undefined && a.value !== null) return `Set ${target ?? 'field'} = ${a.value}`;
    return `${label}${target ? ` → ${target}` : ''}`;
  };

  return (
    <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-4 shadow-[0px_2px_10px_rgba(0,0,0,0.05)] sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2.5 text-[16px] font-semibold text-[#111827]">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] text-[#2563EB]">
            <span className="material-icons text-[17px]">auto_awesome</span>
          </span>
          AI Rule Generator
        </h3>
        <span className="inline-flex items-center gap-1 rounded-full bg-[#EFF6FF] px-2.5 py-1 text-[11px] font-bold text-[#2563EB]">
          <span className="material-icons text-[12px]">auto_awesome</span>Gemini AI
        </span>
      </div>

      {!preview && !questions && (
        <>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            placeholder="Describe the rule in plain English…"
            className="w-full resize-none rounded-[10px] border border-[#E5E7EB] bg-[#F8FAFC] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#111827] placeholder:text-[#9CA3AF] transition focus:border-[#2563EB] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
          />
          <div className="mt-2.5 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => setInstruction(ex)} className="max-w-full truncate rounded-full border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-[11.5px] text-[#374151] transition-all hover:border-[#93C5FD] hover:bg-[#EFF6FF] hover:text-[#2563EB]" title={ex}>
                {ex.length > 42 ? ex.slice(0, 40) + '…' : ex}
              </button>
            ))}
          </div>
          <button
            onClick={() => generate.mutate()}
            disabled={instruction.trim().length < 8 || generate.isPending}
            className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-[10px] bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] py-2.5 text-[13px] font-semibold text-white shadow-[0px_2px_10px_rgba(37,99,235,0.3)] transition-all duration-200 hover:shadow-[0px_4px_16px_rgba(37,99,235,0.4)] hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            <span className="material-icons text-[17px]">{generate.isPending ? 'hourglass_top' : 'bolt'}</span>
            {generate.isPending ? 'Thinking…' : 'Generate Rule'}
          </button>
        </>
      )}

      {/* Clarifying questions */}
      {questions && (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-[13px] font-medium text-[#111827]">
            <span className="material-icons text-[16px] text-[#2563EB]">help</span>AI needs a bit more detail:
          </p>
          {questions.map((q) => (
            <div key={q.id}>
              <label className="mb-1.5 block text-[13px] font-medium text-[#374151]">{q.question}</label>
              {q.options ? (
                <select
                  value={answers[q.id] ?? ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                  className="h-10 w-full cursor-pointer rounded-[10px] border border-[#E5E7EB] bg-white px-3 text-[13px] text-[#111827] transition focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
                >
                  <option value="">Select…</option>
                  {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type={q.type === 'number' ? 'number' : 'text'}
                  value={answers[q.id] ?? ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                  className="h-10 w-full rounded-[10px] border border-[#E5E7EB] bg-white px-3 text-[13px] text-[#111827] transition focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
                  placeholder={q.type === 'number' ? '0' : 'Answer…'}
                />
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={reset} className="rounded-[10px] border border-[#E5E7EB] bg-white px-3.5 py-2 text-[13px] font-medium text-[#374151] transition-colors hover:bg-[#F8FAFC]">Start over</button>
            <button
              onClick={() => generate.mutate()}
              disabled={generate.isPending || questions.some((q) => !answers[q.id])}
              className="flex-1 rounded-[10px] bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] py-2 text-[13px] font-semibold text-white shadow-[0px_2px_10px_rgba(37,99,235,0.3)] transition-all hover:shadow-[0px_4px_16px_rgba(37,99,235,0.4)] disabled:opacity-50"
            >
              {generate.isPending ? 'Generating…' : 'Generate with answers'}
            </button>
          </div>
        </div>
      )}

      {/* Preview of generated rule */}
      {preview && (
        <div className="space-y-3">
          <div className="rounded-[12px] border border-[#E5E7EB] bg-[#F8FAFC] p-3.5">
            <p className="text-[13px] font-semibold text-[#111827]">{preview.name}</p>
            {preview.description && <p className="mt-1 text-[12.5px] leading-relaxed text-[#6B7280]">{preview.description}</p>}
            {preview.explanation && <p className="mt-1.5 text-[12.5px] italic leading-relaxed text-[#2563EB]">{preview.explanation}</p>}
            <div className="mt-3 space-y-1.5">
              {(preview.conditions || []).map((c, i) => (
                <p key={i} className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-[#374151]">
                  <span className={clsx('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold', i === 0 ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#DBEAFE] text-[#2563EB]')}>
                    {i === 0 ? 'IF' : c.logicalOperator ?? 'AND'}
                  </span>
                  {describeCondition(c)}
                </p>
              ))}
            </div>
            <div className="mt-2.5 space-y-1.5 border-t border-[#E5E7EB] pt-2.5">
              {(preview.actions || []).map((a, i) => (
                <p key={i} className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-[#374151]">
                  <span className="shrink-0 rounded bg-[#EFF6FF] px-1.5 py-0.5 text-[10px] font-bold text-[#2563EB]">THEN</span>
                  {describeAction(a)}
                </p>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={reset} className="rounded-[10px] border border-[#E5E7EB] bg-white px-3.5 py-2 text-[13px] font-medium text-[#374151] transition-colors hover:bg-[#F8FAFC]">Discard</button>
            <button
              onClick={() => { onApply(preview); setPreview(null); setInstruction(''); }}
              className="flex-1 rounded-[10px] bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] py-2 text-[13px] font-semibold text-white shadow-[0px_2px_10px_rgba(37,99,235,0.3)] transition-all hover:shadow-[0px_4px_16px_rgba(37,99,235,0.4)]"
            >
              Load into Builder →
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2.5 flex items-start gap-2 rounded-[10px] bg-[#FEE2E2] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#DC2626]">
          <span className="material-icons text-[16px] mt-0.5">error</span>
          {error}
        </div>
      )}
    </div>
  );
}