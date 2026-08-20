/**
 * Rule Categories — organize rules by department / business function.
 * Create unlimited custom categories with icon + color; mark inactive instead
 * of deleting when rules are attached.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { fetchCategories, createCategory, updateCategory, deleteCategory, fetchRules, type RuleCategoryRow } from '../../api/rulesEngine';

const ICONS = ['schedule', 'payments', 'event_busy', 'people', 'local_hospital', 'emoji_events', 'notifications', 'verified_user', 'security', 'tune', 'account_balance', 'attach_money', 'work', 'school', 'trending_up', 'category'];
const COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-pink-500', 'bg-red-500', 'bg-amber-500', 'bg-indigo-500', 'bg-teal-500', 'bg-slate-500', 'bg-cyan-500'];

export default function CategoriesTab({ onChanged }: { onChanged?: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<RuleCategoryRow | 'new' | null>(null);
  const [form, setForm] = useState({ name: '', description: '', icon: 'category', color: 'bg-blue-500' });
  const [error, setError] = useState('');

  const { data: categories = [], isLoading } = useQuery({ queryKey: ['rules-engine', 'categories'], queryFn: fetchCategories });
  const { data: rules = [] } = useQuery({ queryKey: ['rules-engine', 'rules', 'all'], queryFn: () => fetchRules() });

  const ruleCountByCat = new Map<number, number>();
  for (const r of rules) ruleCountByCat.set(r.category_id, (ruleCountByCat.get(r.category_id) || 0) + 1);

  const refresh = () => { qc.invalidateQueries({ queryKey: ['rules-engine'] }); onChanged?.(); };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Name is required');
      return editing === 'new'
        ? createCategory({ name: form.name.trim(), description: form.description || undefined, icon: form.icon, color: form.color })
        : updateCategory((editing as RuleCategoryRow).id, { name: form.name.trim(), description: form.description, icon: form.icon, color: form.color });
    },
    onSuccess: () => { refresh(); setEditing(null); setError(''); },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteCategory(id),
    onSuccess: () => { refresh(); setEditing(null); },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const openNew = () => { setForm({ name: '', description: '', icon: 'category', color: 'bg-blue-500' }); setEditing('new'); setError(''); };
  const openEdit = (c: RuleCategoryRow) => { setForm({ name: c.name, description: c.description ?? '', icon: c.icon ?? 'category', color: c.color ?? 'bg-blue-500' }); setEditing(c); setError(''); };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-base font-semibold text-slate-800">Rule Categories</h3>
          <p className="text-sm text-slate-500 mt-0.5">Organize rules by department and business function. {categories.length} categories.</p>
        </div>
        <button onClick={openNew} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-600 text-white text-sm font-medium hover:shadow-md transition-shadow shrink-0">
          <span className="material-icons text-base">add</span>New Category
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3.5 lg:grid-cols-3 xl:grid-cols-4">
        {isLoading
          ? [...Array(8)].map((_, i) => <div key={i} className="h-24 rounded-xl border border-slate-200 bg-white animate-pulse sm:h-32 sm:rounded-2xl" />)
          : categories.map((c) => (
            <div key={c.id} className="group rounded-xl border border-slate-200 bg-white p-3 transition-shadow hover:shadow-md sm:rounded-2xl sm:p-4">
              <div className="flex items-start justify-between">
                <div className={clsx('flex h-9 w-9 items-center justify-center rounded-lg sm:h-11 sm:w-11 sm:rounded-xl', c.color ?? 'bg-slate-400')}>
                  <span className="material-icons text-lg text-white sm:text-xl">{c.icon ?? 'category'}</span>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title="Edit"><span className="material-icons text-lg">edit</span></button>
                  <button onClick={() => deleteMutation.mutate(c.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500" title="Delete"><span className="material-icons text-lg">delete</span></button>
                </div>
              </div>
              <p className="mt-2 text-sm font-semibold text-slate-800 sm:mt-3 sm:text-base">{c.name}</p>
              <p className="mt-0.5 line-clamp-2 min-h-[2.25em] text-[11px] leading-relaxed text-slate-500 sm:mt-1 sm:min-h-[2.5em] sm:text-xs">{c.description ?? 'No description'}</p>
              <div className="mt-2 flex items-center justify-between sm:mt-3">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 sm:px-2.5 sm:py-1 sm:text-xs">
                  {ruleCountByCat.get(c.id) ?? 0} rule{(ruleCountByCat.get(c.id) ?? 0) === 1 ? '' : 's'}
                </span>
                <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-medium sm:px-2.5 sm:py-1 sm:text-xs', c.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400')}>
                  {c.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          ))}
      </div>

      {/* Create / edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-slate-800 mb-4">{editing === 'new' ? 'New Category' : `Edit "${(editing as RuleCategoryRow).name}"`}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Name *</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40" placeholder="e.g. Hospital Billing" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Description</label>
                <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} className="w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 resize-none" placeholder="What kind of rules belong here?" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Icon</label>
                <div className="flex flex-wrap gap-2">
                  {ICONS.map((icon) => (
                    <button key={icon} onClick={() => setForm((f) => ({ ...f, icon }))} className={clsx('w-10 h-10 rounded-lg flex items-center justify-center border transition-colors', form.icon === icon ? 'border-purple-500 bg-purple-50 text-purple-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50')}>
                      <span className="material-icons text-xl">{icon}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Color</label>
                <div className="flex flex-wrap gap-2.5">
                  {COLORS.map((color) => (
                    <button key={color} onClick={() => setForm((f) => ({ ...f, color }))} className={clsx('w-9 h-9 rounded-lg transition-transform', color, form.color === color && 'ring-2 ring-offset-2 ring-slate-700 scale-110')} />
                  ))}
                </div>
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3.5 py-2.5">{error}</p>}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setEditing(null)} className="flex-1 border border-slate-200 rounded-lg py-2.5 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="flex-1 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-lg py-2.5 text-sm font-medium hover:shadow-lg disabled:opacity-60">
                {saveMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
