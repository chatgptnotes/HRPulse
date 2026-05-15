import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api';

export default function SettingsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'smtp' | 'ollama' | 'templates' | 'company'>('smtp');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [templates, setTemplates] = useState<any[]>([]);
  const [editTemplate, setEditTemplate] = useState<Record<string, { subject: string; body: string }>>({});
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [testing, setTesting] = useState(false);

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data: rawSettings } = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings().then(r => r.data) });
  const { data: rawTemplates } = useQuery({ queryKey: ['templates'], queryFn: () => api.getTemplates().then(r => r.data as any[]) });

  useEffect(() => { if (rawSettings) setSettings(rawSettings as any); }, [rawSettings]);
  useEffect(() => {
    if (rawTemplates) {
      setTemplates(rawTemplates);
      const map: Record<string, { subject: string; body: string }> = {};
      (rawTemplates as any[]).forEach(t => { map[t.type] = { subject: t.subject, body: t.body }; });
      setEditTemplate(map);
    }
  }, [rawTemplates]);

  const set = (key: string, value: string) => setSettings(prev => ({ ...prev, [key]: value }));

  const saveSettings = async () => {
    await api.saveSettings(settings);
    qc.invalidateQueries({ queryKey: ['settings'] });
    showToast('Settings saved');
  };

  const saveTemplates = async () => {
    for (const [type, data] of Object.entries(editTemplate)) {
      await api.saveTemplate(type, data);
    }
    qc.invalidateQueries({ queryKey: ['templates'] });
    showToast('Templates saved');
  };

  const testSMTP = async () => {
    setTesting(true);
    await saveSettings();
    try {
      const { data } = await api.testSmtp();
      showToast((data as any).ok ? 'SMTP connection successful' : `SMTP error: ${(data as any).error}`, (data as any).ok ? 'ok' : 'err');
    } finally { setTesting(false); }
  };

  const testOllama = async () => {
    setTesting(true);
    await saveSettings();
    try {
      const { data } = await api.testOllama();
      const d = data as any;
      showToast(d.ok ? `Ollama OK — models: ${d.models?.join(', ') || 'none'}` : `Ollama error: ${d.error}`, d.ok ? 'ok' : 'err');
    } finally { setTesting(false); }
  };

  const TABS = [
    { key: 'smtp', label: 'SMTP Email' },
    { key: 'ollama', label: 'Ollama AI' },
    { key: 'templates', label: 'Email Templates' },
    { key: 'company', label: 'Company Info' },
  ];

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-bold text-slate-800 mb-1">Settings</h1>
      <p className="text-sm text-slate-500 mb-6">Configure SMTP, Ollama, email templates and company info</p>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-100 rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as any)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${tab === t.key ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        {tab === 'smtp' && (
          <div className="space-y-4">
            <h2 className="font-semibold text-slate-700">SMTP Configuration</h2>

            {/* Testing / Live mode toggle */}
            <div className="flex items-center gap-3 p-4 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50">
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-700">
                  {settings['smtp_host'] === 'localhost' ? '🧪 Testing Mode' : '🚀 Live Mode'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {settings['smtp_host'] === 'localhost'
                    ? 'Emails are captured locally — nothing goes to real inboxes. Safe to test.'
                    : 'Emails will be sent to real employee inboxes via Gmail.'}
                </p>
              </div>
              <button
                onClick={() => {
                  if (settings['smtp_host'] === 'localhost') {
                    set('smtp_host', 'smtp.gmail.com');
                    set('smtp_port', '587');
                    set('smtp_secure', 'false');
                  } else {
                    set('smtp_host', 'localhost');
                    set('smtp_port', '1025');
                    set('smtp_secure', 'false');
                    set('smtp_user', '');
                    set('smtp_pass', '');
                  }
                }}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                  settings['smtp_host'] === 'localhost'
                    ? 'bg-brand-600 text-white hover:bg-brand-700'
                    : 'bg-amber-500 text-white hover:bg-amber-600'
                }`}
              >
                {settings['smtp_host'] === 'localhost' ? 'Switch to Live (Gmail)' : 'Switch to Testing'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="SMTP Host" value={settings['smtp_host'] || ''} onChange={v => set('smtp_host', v)} placeholder="smtp.gmail.com" />
              <Field label="Port" value={settings['smtp_port'] || '587'} onChange={v => set('smtp_port', v)} placeholder="587" />
              <Field label="Username" value={settings['smtp_user'] || ''} onChange={v => set('smtp_user', v)} placeholder="hr@company.com" />
              <Field label="Password" value={settings['smtp_pass'] || ''} onChange={v => set('smtp_pass', v)} type="password" placeholder="App password" />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="secure" checked={settings['smtp_secure'] === 'true'} onChange={e => set('smtp_secure', e.target.checked ? 'true' : 'false')} />
              <label htmlFor="secure" className="text-sm text-slate-600">Use SSL/TLS (port 465)</label>
            </div>
            <p className="text-xs text-slate-400">For Gmail: use an App Password. Go to Google Account → Security → 2-Step Verification → App Passwords</p>
            <div className="flex gap-3 pt-2">
              <button onClick={saveSettings} className="bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-700">Save</button>
              <button onClick={testSMTP} disabled={testing} className="border border-slate-200 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50">
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
            </div>
          </div>
        )}

        {tab === 'ollama' && (
          <div className="space-y-4">
            <h2 className="font-semibold text-slate-700">Ollama AI Configuration</h2>
            <Field label="Ollama URL" value={settings['ollama_url'] || 'http://localhost:11434'} onChange={v => set('ollama_url', v)} />
            <Field label="Model Name" value={settings['ollama_model'] || 'llama3.1:8b'} onChange={v => set('ollama_model', v)} placeholder="llama3.1:8b" />
            <Field label="Working Days per Month" value={settings['working_days'] || '26'} onChange={v => set('working_days', v)} placeholder="26" />
            <div>
              <label className="text-sm text-slate-600 block mb-1">Missed Swipe counts as (fraction of a day)</label>
              <input
                type="number" step="0.1" min="0" max="1"
                value={settings['missed_swipe_weight'] || '0.5'}
                onChange={e => set('missed_swipe_weight', e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
              <span className="text-xs text-slate-400 ml-2">0.5 = half day, 1 = full day</span>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={saveSettings} className="bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-700">Save</button>
              <button onClick={testOllama} disabled={testing} className="border border-slate-200 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50">
                {testing ? 'Testing...' : 'Test Ollama'}
              </button>
            </div>
          </div>
        )}

        {tab === 'templates' && (
          <div className="space-y-6">
            <h2 className="font-semibold text-slate-700">Email Templates</h2>
            <p className="text-xs text-slate-400">Available tokens: {'{{employee_name}}, {{period_month}}, {{flagged_count}}, {{records_table}}, {{company_name}}, {{hr_name}}'}</p>
            {['initial', 'reminder', 'escalation'].map(type => (
              <div key={type} className="border border-slate-200 rounded-xl p-4 space-y-3">
                <h3 className="font-medium text-slate-700 capitalize">{type} Email</h3>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Subject</label>
                  <input
                    value={editTemplate[type]?.subject || ''}
                    onChange={e => setEditTemplate(prev => ({ ...prev, [type]: { ...prev[type], subject: e.target.value } }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Body</label>
                  <textarea
                    value={editTemplate[type]?.body || ''}
                    onChange={e => setEditTemplate(prev => ({ ...prev, [type]: { ...prev[type], body: e.target.value } }))}
                    rows={8}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  />
                </div>
              </div>
            ))}
            <button onClick={saveTemplates} className="bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-700">Save Templates</button>
          </div>
        )}

        {tab === 'company' && (
          <div className="space-y-4">
            <h2 className="font-semibold text-slate-700">Company Information</h2>
            <Field label="Company Name" value={settings['company_name'] || ''} onChange={v => set('company_name', v)} />
            <Field label="HR Department / Sender Name" value={settings['hr_name'] || ''} onChange={v => set('hr_name', v)} />
            <button onClick={saveSettings} className="bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-700 mt-2">Save</button>
          </div>
        )}
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-3 rounded-xl shadow-lg text-sm font-medium z-50 ${toast.type === 'ok' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-600 block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
      />
    </div>
  );
}
