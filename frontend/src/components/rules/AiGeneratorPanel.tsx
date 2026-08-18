/**
 * AI Rule Generator panel (Gemini via the rules-engine-ai edge function).
 *
 * Flow: type a natural-language instruction → Generate. If the AI needs more
 * detail it returns clarifying questions which render as inputs; answering
 * them re-submits. A complete draft is previewed and applied into the Visual
 * Rule Builder for review before saving.
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
    <div className="rounded-2xl border border-indigo-200 bg-gradient-to-b from-indigo-50/70 to-white p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3.5">
        <h3 className="flex items-center gap-2 text-base font-semibold text-indigo-900">
          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0">
            <span className="material-icons text-white text-lg">auto_awesome</span>
          </span>
          AI Rule Generator
        </h3>
        <span className="text-xs px-2 py-0.5 rounded bg-indigo-100 text-indigo-600 font-semibold">Gemini</span>
      </div>

      {!preview && !questions && (
        <>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            placeholder="Describe the rule in plain English…"
            className="w-full border border-indigo-200 rounded-lg px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400/50 resize-none"
          />
          <div className="flex flex-wrap gap-2 mt-2.5">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => setInstruction(ex)} className="text-xs px-2.5 py-1.5 rounded-full bg-white border border-indigo-200 text-indigo-600 hover:bg-indigo-100 truncate max-w-full" title={ex}>
                {ex.length > 42 ? ex.slice(0, 40) + '…' : ex}
              </button>
            ))}
          </div>
          <button
            onClick={() => generate.mutate()}
            disabled={instruction.trim().length < 8 || generate.isPending}
            className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-semibold hover:shadow-lg transition-shadow disabled:opacity-50"
          >
            <span className="material-icons text-lg">{generate.isPending ? 'hourglass_top' : 'bolt'}</span>
            {generate.isPending ? 'Thinking…' : 'Generate Rule'}
          </button>
        </>
      )}

      {/* Clarifying questions */}
      {questions && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-indigo-900 flex items-center gap-2">
            <span className="material-icons text-base">help</span>AI needs a bit more detail:
          </p>
          {questions.map((q) => (
            <div key={q.id}>
              <label className="block text-sm text-slate-600 mb-1.5">{q.question}</label>
              {q.options ? (
                <select
                  value={answers[q.id] ?? ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                  className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  <option value="">Select…</option>
                  {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type={q.type === 'number' ? 'number' : 'text'}
                  value={answers[q.id] ?? ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                  className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-sm bg-white"
                  placeholder={q.type === 'number' ? '0' : 'Answer…'}
                />
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={reset} className="px-3.5 py-2 rounded-lg border border-indigo-200 text-sm text-slate-600 hover:bg-white">Start over</button>
            <button
              onClick={() => generate.mutate()}
              disabled={generate.isPending || questions.some((q) => !answers[q.id])}
              className="flex-1 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-semibold hover:shadow-md disabled:opacity-50"
            >
              {generate.isPending ? 'Generating…' : 'Generate with answers'}
            </button>
          </div>
        </div>
      )}

      {/* Preview of generated rule */}
      {preview && (
        <div className="space-y-3">
          <div className="rounded-xl bg-white border border-indigo-100 p-3.5">
            <p className="text-sm font-semibold text-slate-800">{preview.name}</p>
            {preview.description && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{preview.description}</p>}
            {preview.explanation && <p className="text-xs text-indigo-600 mt-1.5 italic leading-relaxed">{preview.explanation}</p>}
            <div className="mt-3 space-y-1.5">
              {(preview.conditions || []).map((c, i) => (
                <p key={i} className="text-xs text-slate-700 flex items-start gap-1.5 leading-relaxed">
                  <span className={clsx('px-1.5 rounded text-[10px] font-bold shrink-0', i === 0 ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700')}>
                    {i === 0 ? 'IF' : c.logicalOperator ?? 'AND'}
                  </span>
                  {describeCondition(c)}
                </p>
              ))}
            </div>
            <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-1.5">
              {(preview.actions || []).map((a, i) => (
                <p key={i} className="text-xs text-slate-700 flex items-start gap-1.5 leading-relaxed">
                  <span className="px-1.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold shrink-0">THEN</span>
                  {describeAction(a)}
                </p>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={reset} className="px-3.5 py-2 rounded-lg border border-indigo-200 text-sm text-slate-600 hover:bg-white">Discard</button>
            <button
              onClick={() => { onApply(preview); setPreview(null); setInstruction(''); }}
              className="flex-1 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-semibold hover:shadow-lg transition-shadow"
            >
              Load into Builder for review →
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2.5 text-sm text-red-700 bg-red-50 rounded-lg px-3.5 py-2.5 leading-relaxed">
          {error}
        </div>
      )}
    </div>
  );
}