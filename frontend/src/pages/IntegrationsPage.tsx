import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import * as api from '../api';

type Connector = {
  id: string;
  connectorKey: string;
  displayName: string;
  status: 'disabled' | 'shadow' | 'active' | 'error';
  baseUrl: string | null;
  pollIntervalSeconds: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  organization: { code: string; name: string; timezone: string };
  counts: { mappings: number; pending: number; deadLetters: number; failedInbound: number };
};

const statusTone: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  shadow: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
  disabled: 'bg-slate-100 text-slate-600 ring-slate-200',
  error: 'bg-rose-50 text-rose-700 ring-rose-100',
};

export default function IntegrationsPage() {
  const qc = useQueryClient();
  const [direction, setDirection] = useState<'inbound' | 'outbound'>('outbound');
  const [notice, setNotice] = useState('');
  const canManage = true;
  const overview = useQuery({
    queryKey: ['integration-overview'],
    queryFn: () => api.getIntegrationOverview().then(response => response.data as { connectors: Connector[] }),
    refetchInterval: 15_000,
  });
  const events = useQuery({
    queryKey: ['integration-events', direction],
    queryFn: () => api.getIntegrationEvents({ direction, limit: 50 }).then(response => response.data as any[]),
    refetchInterval: 15_000,
  });
  const update = useMutation({
    mutationFn: ({ key, status, baseUrl }: { key: string; status: Connector['status']; baseUrl: string | null }) =>
      api.updateConnector(key, { status, baseUrl }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integration-overview'] });
      setNotice('Connector settings saved');
    },
    onError: (error: any) => setNotice(error?.response?.data?.error?.message || error?.response?.data?.error || 'Update failed'),
  });
  const retry = useMutation({
    mutationFn: (id: number) => api.retryIntegrationEvent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integration-events'] });
      setNotice('Event queued for retry');
    },
  });
  const backfill = useMutation({
    mutationFn: (connectorKey: string) => api.backfillConnectorEmployees(connectorKey),
    onSuccess: response => {
      qc.invalidateQueries({ queryKey: ['integration-overview'] });
      setNotice(`${response.data.queued} employee synchronization events queued`);
    },
    onError: (error: any) => setNotice(error?.response?.data?.error || 'Employee backfill could not be queued'),
  });

  const connectors = overview.data?.connectors || [];
  const totals = useMemo(() => connectors.reduce((out, item) => ({
    pending: out.pending + item.counts.pending,
    dead: out.dead + item.counts.deadLetters,
    failures: out.failures + item.counts.failedInbound,
  }), { pending: 0, dead: 0, failures: 0 }), [connectors]);

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">Connector control plane</p>
              <h1 className="mt-2 text-2xl font-black text-slate-950">HIMS Integrations</h1>
              <p className="mt-1 text-sm text-slate-500">Hope is the pilot organization. Keep Adamrit in shadow mode until mappings and reconciliation pass.</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ['Pending', totals.pending, 'text-amber-700'],
                ['Dead letters', totals.dead, 'text-rose-700'],
                ['Inbound failures', totals.failures, 'text-rose-700'],
              ].map(([label, value, tone]) => (
                <div key={String(label)} className="rounded-2xl border border-slate-200 px-4 py-3">
                  <p className={clsx('text-xl font-black', tone)}>{value}</p>
                  <p className="text-[10px] font-bold uppercase text-slate-400">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </header>

        {notice && <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-700">{notice}</div>}

        <section className="grid gap-4">
          {connectors.map(connector => <ConnectorCard key={connector.id} connector={connector} canManage={canManage} saving={update.isPending} backfilling={backfill.isPending} onBackfill={() => backfill.mutate(connector.connectorKey)} onSave={(status, baseUrl) => update.mutate({ key: connector.connectorKey, status, baseUrl })} />)}
          {!overview.isLoading && !connectors.length && <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">Apply the HIMS connector migration to create the Hope connector.</div>}
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 p-5">
            <div>
              <h2 className="font-bold text-slate-950">Recent integration events</h2>
              <p className="text-xs text-slate-500">Payloads are retained for audit, replay, and reconciliation.</p>
            </div>
            <div className="rounded-xl bg-slate-100 p-1">
              {(['outbound', 'inbound'] as const).map(value => (
                <button key={value} onClick={() => setDirection(value)} className={clsx('rounded-lg px-3 py-1.5 text-xs font-bold capitalize', direction === value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500')}>{value}</button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-3">Event</th><th className="px-4 py-3">Connector</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Attempts</th><th className="px-4 py-3">Created</th><th className="px-4 py-3 text-right">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(events.data || []).map((event: any) => (
                  <tr key={event.id}>
                    <td className="px-4 py-3"><p className="font-semibold text-slate-800">{event.event_type}</p><p className="font-mono text-[10px] text-slate-400">{event.event_uuid}</p></td>
                    <td className="px-4 py-3 text-slate-600">{event.integration_connectors?.display_name || '—'}</td>
                    <td className="px-4 py-3"><span className={clsx('rounded-full px-2.5 py-1 text-xs font-bold ring-1', statusTone[event.status] || 'bg-slate-100 text-slate-600 ring-slate-200')}>{event.status}</span></td>
                    <td className="px-4 py-3 text-slate-600">{event.attempt_count ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{new Date(event.created_at || event.received_at).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">{direction === 'outbound' && event.status === 'dead_letter' && canManage ? <button onClick={() => retry.mutate(event.id)} className="rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700">Retry</button> : '—'}</td>
                  </tr>
                ))}
                {!events.isLoading && !(events.data || []).length && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No integration events yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function ConnectorCard({ connector, canManage, saving, backfilling, onBackfill, onSave }: {
  connector: Connector;
  canManage: boolean;
  saving: boolean;
  backfilling: boolean;
  onBackfill: () => void;
  onSave: (status: Connector['status'], baseUrl: string | null) => void;
}) {
  const [status, setStatus] = useState(connector.status);
  const [baseUrl, setBaseUrl] = useState(connector.baseUrl || '');
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-black text-slate-950">{connector.displayName}</h2>
            <span className={clsx('rounded-full px-2.5 py-1 text-xs font-bold capitalize ring-1', statusTone[connector.status])}>{connector.status}</span>
          </div>
          <p className="mt-1 font-mono text-xs text-slate-400">{connector.connectorKey}</p>
          <p className="mt-3 text-sm text-slate-500">{connector.organization.name} · {connector.organization.timezone}</p>
          {connector.lastError && <p className="mt-3 max-w-2xl rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{connector.lastError}</p>}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[
            ['Mappings', connector.counts.mappings],
            ['Pending', connector.counts.pending],
            ['Dead', connector.counts.deadLetters],
            ['Inbound', connector.counts.failedInbound],
          ].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-slate-50 px-3 py-2 text-center"><p className="font-black text-slate-900">{value}</p><p className="text-[9px] font-bold uppercase text-slate-400">{label}</p></div>)}
        </div>
      </div>
      <div className="mt-5 grid gap-3 border-t border-slate-100 pt-5 lg:grid-cols-[1fr_180px_auto_auto]">
        <input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} disabled={!canManage} placeholder="https://sandbox.example.com" className="h-10 rounded-xl border border-slate-200 px-3 text-sm disabled:bg-slate-50" />
        <select value={status} onChange={event => setStatus(event.target.value as Connector['status'])} disabled={!canManage} className="h-10 rounded-xl border border-slate-200 px-3 text-sm disabled:bg-slate-50">
          <option value="disabled">Disabled</option><option value="shadow">Shadow</option><option value="active">Active</option><option value="error">Error</option>
        </select>
        <button onClick={onBackfill} disabled={!canManage || backfilling || connector.status === 'disabled'} className="h-10 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-bold text-indigo-700 disabled:opacity-40">Backfill employees</button>
        <button onClick={() => onSave(status, baseUrl || null)} disabled={!canManage || saving} className="h-10 rounded-xl bg-indigo-600 px-5 text-sm font-bold text-white disabled:opacity-40">Save connector</button>
      </div>
    </article>
  );
}
