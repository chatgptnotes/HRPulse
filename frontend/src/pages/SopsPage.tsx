import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { getSops, getSopCategories, createSop, updateSop, deleteSop } from '../api';
import clsx from 'clsx';

interface Sop {
  id: number;
  title: string;
  category: string;
  content: string;
  tags: string[];
  version: number;
  isActive: boolean;
  updatedAt: string;
}

const DEFAULT_FORM = { title: '', category: '', content: '', tags: '' };

export default function SopsPage() {
  const qc = useQueryClient();
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [search, setSearch] = useState('');
  const [viewing, setViewing] = useState<Sop | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingSop, setEditingSop] = useState<Sop | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const { data: categories = [] } = useQuery<string[]>({
    queryKey: ['sop-categories'],
    queryFn: () => getSopCategories().then(r => r.data),
  });

  const { data: sops = [], isLoading } = useQuery<Sop[]>({
    queryKey: ['sops', selectedCategory, search],
    queryFn: () => getSops({ category: selectedCategory || undefined, search: search || undefined }).then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: { title: string; category: string; content: string; tags: string[] }) => createSop(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sops'] }); qc.invalidateQueries({ queryKey: ['sop-categories'] }); closeModal(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { title: string; category: string; content: string; tags: string[] } }) => updateSop(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sops'] }); closeModal(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteSop(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sops'] }); setDeleteConfirm(null); if (viewing) setViewing(null); },
  });

  function openCreate() {
    setEditingSop(null);
    setForm(DEFAULT_FORM);
    setShowModal(true);
  }

  function openEdit(sop: Sop) {
    setEditingSop(sop);
    setForm({ title: sop.title, category: sop.category, content: sop.content, tags: sop.tags?.join(', ') || '' });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingSop(null);
  }

  function handleSubmit() {
    const tags = form.tags.split(',').map(t => t.trim()).filter(Boolean);
    const payload = { title: form.title, category: form.category, content: form.content, tags };
    if (editingSop) {
      updateMutation.mutate({ id: editingSop.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Standard Operating Procedures</h1>
          <p className="text-slate-500 text-sm mt-1">HR policies, processes, and guidelines in a searchable knowledge base.</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700"
        >
          <span className="material-icons text-lg">add</span>
          New SOP
        </button>
      </div>

      {/* Search + Category filter */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative">
          <span className="material-icons absolute left-3 top-2.5 text-slate-400 text-xl">search</span>
          <input
            type="text"
            placeholder="Search SOPs..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-56"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSelectedCategory('')}
            className={clsx('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors', !selectedCategory ? 'bg-brand-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50')}
          >
            All
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat === selectedCategory ? '' : cat)}
              className={clsx('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors', selectedCategory === cat ? 'bg-brand-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50')}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-slate-400">
          <span className="material-icons animate-spin text-4xl block mb-2">refresh</span>Loading SOPs...
        </div>
      ) : sops.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <span className="material-icons text-6xl block mb-3 opacity-30">description</span>
          <p className="text-lg font-medium mb-2">No SOPs found</p>
          <p className="text-sm">{search ? 'Try a different search term.' : 'Create your first SOP to build your HR knowledge base.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sops.map(sop => (
            <div key={sop.id} className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 flex flex-col gap-3 hover:shadow-md transition-shadow cursor-pointer" onClick={() => setViewing(sop)}>
              <div>
                <span className="text-xs font-semibold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full">{sop.category}</span>
                <h3 className="font-semibold text-slate-800 mt-2 text-sm">{sop.title}</h3>
                <p className="text-xs text-slate-500 mt-1 line-clamp-2">{sop.content.replace(/#/g, '').substring(0, 120)}...</p>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>v{sop.version} &middot; {new Date(sop.updatedAt).toLocaleDateString()}</span>
                <div className="flex gap-1">
                  {sop.tags?.slice(0, 2).map(t => (
                    <span key={t} className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{t}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* View Modal */}
      {viewing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <div>
                <span className="text-xs font-semibold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full">{viewing.category}</span>
                <h2 className="text-xl font-bold text-slate-800 mt-1">{viewing.title}</h2>
                <p className="text-xs text-slate-400 mt-0.5">Version {viewing.version} &middot; Updated {new Date(viewing.updatedAt).toLocaleDateString()}</p>
              </div>
              <div className="flex items-center gap-1 ml-4">
                <button
                  onClick={(e) => { e.stopPropagation(); openEdit(viewing); setViewing(null); }}
                  className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"
                  title="Edit"
                >
                  <span className="material-icons text-lg">edit</span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteConfirm(viewing.id); }}
                  className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-600"
                  title="Delete"
                >
                  <span className="material-icons text-lg">delete</span>
                </button>
                <button onClick={() => setViewing(null)} className="p-1.5 rounded hover:bg-slate-100">
                  <span className="material-icons text-xl text-slate-400">close</span>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 prose prose-sm max-w-none">
              <ReactMarkdown>{viewing.content}</ReactMarkdown>
            </div>
            {viewing.tags?.length > 0 && (
              <div className="px-6 py-3 border-t border-slate-100 flex gap-2">
                {viewing.tags.map(t => (
                  <span key={t} className="bg-slate-100 text-slate-500 text-xs px-2 py-0.5 rounded">{t}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-slate-800">{editingSop ? 'Edit SOP' : 'New SOP'}</h3>
              <button onClick={closeModal} className="p-1.5 rounded hover:bg-slate-100">
                <span className="material-icons text-xl text-slate-400">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="e.g. Absent Employee Policy"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Category *</label>
                  <input
                    type="text"
                    value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="e.g. Attendance, Payroll"
                    list="sop-categories-list"
                  />
                  <datalist id="sop-categories-list">
                    {categories.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tags (comma-separated)</label>
                <input
                  type="text"
                  value={form.tags}
                  onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="absence, lop, policy"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Content (Markdown) *</label>
                <textarea
                  value={form.content}
                  onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                  rows={12}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono resize-none"
                  placeholder="# SOP Title&#10;&#10;## Purpose&#10;...&#10;&#10;## Process&#10;1. Step one&#10;2. Step two"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={closeModal} className="flex-1 border border-slate-200 rounded-lg py-2 text-sm text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!form.title || !form.category || !form.content || isPending}
                className="flex-1 bg-brand-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-60"
              >
                {isPending ? 'Saving...' : editingSop ? 'Update SOP' : 'Create SOP'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteConfirm !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-bold text-slate-800 mb-2">Archive SOP</h3>
            <p className="text-slate-500 text-sm mb-5">This SOP will be archived and no longer visible. You can restore it from the database if needed.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 border border-slate-200 rounded-lg py-2 text-sm text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm)}
                disabled={deleteMutation.isPending}
                className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-60"
              >
                {deleteMutation.isPending ? 'Archiving...' : 'Archive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
