import { useState, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getUploads, askAi, analyzeUpload, getAiInsights, predictRisk, generateReport } from '../api';
import clsx from 'clsx';

type Tab = 'ask' | 'analyze' | 'risk' | 'report';

interface Insight {
  id: number;
  insightType: string;
  title: string;
  content: string;
  severity: string;
  createdAt: string;
}

interface RiskEmployee {
  id: number;
  name: string;
  email: string;
  riskScore: number;
  flaggedCount: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'border-red-200 bg-red-50',
  warning: 'border-amber-200 bg-amber-50',
  info: 'border-blue-200 bg-blue-50',
};

const SEVERITY_ICON: Record<string, string> = {
  critical: 'error',
  warning: 'warning',
  info: 'info',
};

const SEVERITY_ICON_COLOR: Record<string, string> = {
  critical: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-blue-500',
};

export default function AiInsightsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('ask');
  const [selectedUploadId, setSelectedUploadId] = useState<number | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [reportText, setReportText] = useState('');
  const [reportStats, setReportStats] = useState<Record<string, number> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: uploads } = useQuery({ queryKey: ['uploads'], queryFn: () => getUploads().then(r => r.data) });

  const { data: insights, refetch: refetchInsights } = useQuery<Insight[]>({
    queryKey: ['ai-insights', selectedUploadId],
    queryFn: () => getAiInsights(selectedUploadId!).then(r => r.data),
    enabled: !!selectedUploadId && activeTab === 'analyze',
  });

  const askMutation = useMutation({
    mutationFn: ({ question, uploadId }: { question: string; uploadId?: number }) => askAi(question, uploadId).then(r => r.data),
    onSuccess: (data) => {
      setChatMessages(msgs => [...msgs, { role: 'assistant', content: data.answer }]);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: (uploadId: number) => analyzeUpload(uploadId).then(r => r.data),
    onSuccess: () => refetchInsights(),
  });

  const riskMutation = useMutation({
    mutationFn: () => predictRisk().then(r => r.data),
  });

  const reportMutation = useMutation({
    mutationFn: (uploadId: number) => generateReport(uploadId).then(r => r.data),
    onSuccess: (data) => {
      setReportText(data.report);
      setReportStats(data.stats);
    },
  });

  function handleAsk() {
    if (!chatInput.trim()) return;
    const question = chatInput.trim();
    setChatMessages(msgs => [...msgs, { role: 'user', content: question }]);
    setChatInput('');
    askMutation.mutate({ question, uploadId: selectedUploadId ?? undefined });
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }

  const tabs: Array<{ id: Tab; label: string; icon: string }> = [
    { id: 'ask', label: 'Ask AI', icon: 'chat' },
    { id: 'analyze', label: 'Anomaly Detection', icon: 'radar' },
    { id: 'risk', label: 'Risk Scoring', icon: 'assessment' },
    { id: 'report', label: 'Report Generator', icon: 'summarize' },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">AI Insights</h1>
        <p className="text-slate-500 text-sm mt-1">Local AI-powered analysis — all processing happens on your machine via Ollama.</p>
      </div>

      {/* Upload selector */}
      <div className="flex items-center gap-3 mb-5">
        <label className="text-sm font-medium text-slate-700 flex-shrink-0">Context upload:</label>
        <select
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          value={selectedUploadId ?? ''}
          onChange={e => setSelectedUploadId(e.target.value ? parseInt(e.target.value) : null)}
        >
          <option value="">— No upload selected —</option>
          {uploads?.map((u: { id: number; filename: string; periodMonth: string }) => (
            <option key={u.id} value={u.id}>{u.periodMonth} — {u.filename}</option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-slate-100 p-1 rounded-xl w-fit">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              activeTab === tab.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            <span className="material-icons text-base">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Ask AI Tab */}
      {activeTab === 'ask' && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm flex flex-col" style={{ height: '520px' }}>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {chatMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <span className="material-icons text-5xl mb-3 opacity-40">smart_toy</span>
                <p className="text-sm font-medium">Ask anything about your attendance data</p>
                <p className="text-xs mt-1">Powered by local Ollama &middot; No internet required</p>
                <div className="mt-4 space-y-2">
                  {['Who had the most absences this month?', 'What is the overall attendance rate?', 'Which department has the most missed swipes?'].map(q => (
                    <button key={q} onClick={() => { setChatInput(q); }} className="block text-xs text-brand-600 hover:text-brand-700 hover:underline">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {chatMessages.map((msg, i) => (
              <div key={i} className={clsx('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={clsx(
                  'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm',
                  msg.role === 'user'
                    ? 'bg-brand-600 text-white rounded-br-sm'
                    : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                )}>
                  {msg.content}
                </div>
              </div>
            ))}
            {askMutation.isPending && (
              <div className="flex justify-start">
                <div className="bg-slate-100 rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm text-slate-500 flex items-center gap-2">
                  <span className="material-icons animate-spin text-base">refresh</span>
                  Thinking...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <div className="p-4 border-t border-slate-100 flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleAsk()}
              placeholder="Ask about attendance patterns, trends, specific employees..."
              className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              disabled={askMutation.isPending}
            />
            <button
              onClick={handleAsk}
              disabled={!chatInput.trim() || askMutation.isPending}
              className="bg-brand-600 text-white px-4 py-2.5 rounded-xl hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              <span className="material-icons text-xl">send</span>
            </button>
          </div>
        </div>
      )}

      {/* Anomaly Detection Tab */}
      {activeTab === 'analyze' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => selectedUploadId && analyzeMutation.mutate(selectedUploadId)}
              disabled={!selectedUploadId || analyzeMutation.isPending}
              className="flex items-center gap-2 bg-brand-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              <span className={clsx('material-icons text-xl', analyzeMutation.isPending && 'animate-spin')}>
                {analyzeMutation.isPending ? 'refresh' : 'radar'}
              </span>
              {analyzeMutation.isPending ? 'Analyzing with AI...' : 'Run Anomaly Detection'}
            </button>
            {!selectedUploadId && <p className="text-sm text-slate-400">Select an upload above to analyze.</p>}
          </div>

          {insights && insights.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">{insights.length} insight{insights.length !== 1 ? 's' : ''} generated</h3>
              {insights.map(insight => (
                <div key={insight.id} className={clsx('border rounded-xl p-4', SEVERITY_COLORS[insight.severity] || 'border-slate-200 bg-white')}>
                  <div className="flex items-start gap-3">
                    <span className={clsx('material-icons mt-0.5', SEVERITY_ICON_COLOR[insight.severity] || 'text-slate-400')}>
                      {SEVERITY_ICON[insight.severity] || 'info'}
                    </span>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-sm text-slate-800">{insight.title}</span>
                        <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', insight.severity === 'critical' ? 'bg-red-100 text-red-700' : insight.severity === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700')}>
                          {insight.severity}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600">{insight.content}</p>
                      <p className="text-xs text-slate-400 mt-1">{new Date(insight.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {insights && insights.length === 0 && !analyzeMutation.isPending && (
            <div className="text-center py-12 text-slate-400">
              <span className="material-icons text-5xl block mb-2 opacity-30">radar</span>
              <p>No insights yet. Click "Run Anomaly Detection" to analyze.</p>
            </div>
          )}
        </div>
      )}

      {/* Risk Scoring Tab */}
      {activeTab === 'risk' && (
        <div className="space-y-4">
          <button
            onClick={() => riskMutation.mutate()}
            disabled={riskMutation.isPending}
            className="flex items-center gap-2 bg-brand-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            <span className={clsx('material-icons text-xl', riskMutation.isPending && 'animate-spin')}>
              {riskMutation.isPending ? 'refresh' : 'assessment'}
            </span>
            {riskMutation.isPending ? 'Calculating risk scores...' : 'Calculate Risk Scores'}
          </button>

          {riskMutation.data?.predictions && (
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-700">High-Risk Employees (Last 90 Days)</h3>
              </div>
              {riskMutation.data.predictions.length === 0 ? (
                <div className="p-8 text-center text-slate-400">No high-risk employees detected. Good attendance!</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-50 text-left">
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase">Employee</th>
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase">Flagged Records</th>
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase">Risk Score</th>
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase">Risk Level</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {(riskMutation.data.predictions as RiskEmployee[]).map(emp => (
                      <tr key={emp.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800">{emp.name}</div>
                          <div className="text-xs text-slate-400">{emp.email}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{emp.flaggedCount}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-slate-100 rounded-full h-2 max-w-[80px]">
                              <div
                                className={clsx('h-2 rounded-full', emp.riskScore >= 70 ? 'bg-red-500' : emp.riskScore >= 40 ? 'bg-amber-500' : 'bg-green-500')}
                                style={{ width: `${emp.riskScore}%` }}
                              />
                            </div>
                            <span className="font-semibold text-xs w-8">{emp.riskScore}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', emp.riskScore >= 70 ? 'bg-red-100 text-red-700' : emp.riskScore >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700')}>
                            {emp.riskScore >= 70 ? 'High' : emp.riskScore >= 40 ? 'Medium' : 'Low'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {!riskMutation.data && !riskMutation.isPending && (
            <div className="text-center py-12 text-slate-400">
              <span className="material-icons text-5xl block mb-2 opacity-30">assessment</span>
              <p>Click the button above to identify at-risk employees based on their attendance history.</p>
            </div>
          )}
        </div>
      )}

      {/* Report Generator Tab */}
      {activeTab === 'report' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => selectedUploadId && reportMutation.mutate(selectedUploadId)}
              disabled={!selectedUploadId || reportMutation.isPending}
              className="flex items-center gap-2 bg-brand-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              <span className={clsx('material-icons text-xl', reportMutation.isPending && 'animate-spin')}>
                {reportMutation.isPending ? 'refresh' : 'summarize'}
              </span>
              {reportMutation.isPending ? 'Generating report...' : 'Generate Monthly Report'}
            </button>
            {!selectedUploadId && <p className="text-sm text-slate-400">Select an upload above to generate a report.</p>}
          </div>

          {reportStats && (
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              {[
                { label: 'Employees', value: reportStats.totalEmployees, icon: 'people' },
                { label: 'Flagged', value: reportStats.flaggedCount, icon: 'flag' },
                { label: 'Absences', value: reportStats.absentCount, icon: 'event_busy' },
                { label: 'Missed Swipes', value: reportStats.missedCount, icon: 'fingerprint' },
                { label: 'Late Arrivals', value: reportStats.lateCount, icon: 'schedule' },
                { label: 'Emails Sent', value: reportStats.sentEmails, icon: 'mark_email_read' },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-lg border border-slate-100 p-3 text-center">
                  <span className="material-icons text-slate-400 text-xl block mb-1">{s.icon}</span>
                  <div className="text-xl font-bold text-slate-800">{s.value}</div>
                  <div className="text-xs text-slate-500">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {reportText && (
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-700">Executive Summary Report</h3>
                <button
                  onClick={() => navigator.clipboard.writeText(reportText)}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50"
                >
                  <span className="material-icons text-base">content_copy</span>
                  Copy
                </button>
              </div>
              <div className="bg-slate-50 rounded-lg p-4 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                {reportText}
              </div>
            </div>
          )}

          {!reportText && !reportMutation.isPending && (
            <div className="text-center py-12 text-slate-400">
              <span className="material-icons text-5xl block mb-2 opacity-30">summarize</span>
              <p>Select an upload and click "Generate Monthly Report" to create an AI-written executive summary.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
