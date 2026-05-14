import { useNavigate } from 'react-router-dom';

const features = [
  { icon: 'upload_file', title: 'GDHR SmartTime Integration', desc: 'Upload your SmartTime Excel export and HRPulse instantly parses all 15+ column variants — no config needed.' },
  { icon: 'psychology', title: 'Local AI Email Drafting', desc: 'Ollama + llama3.1:8b generates personalized, empathetic attendance notification emails offline. Zero cloud dependency.' },
  { icon: 'payments', title: 'Loss of Pay Calculator', desc: 'Configurable LOP formula: basic salary / working days × effective absent days with adjustable missed-swipe weights.' },
  { icon: 'send', title: 'Bulk SMTP Dispatch', desc: 'Preview, edit, and dispatch emails to 100+ employees in one click via your corporate SMTP server.' },
  { icon: 'bar_chart', title: 'Attendance Analytics', desc: 'Trend charts, top offenders, monthly comparisons, and AI-powered anomaly detection across all periods.' },
  { icon: 'rule', title: 'Rules & SOPs Engine', desc: 'Define HR policy rules and maintain standard operating procedures in a searchable knowledge base.' },
  { icon: 'security', title: '100% On-Premises', desc: 'All data stays on your server. No SaaS subscription, no data leaving your premises, no internet required.' },
  { icon: 'history', title: 'Full Audit Trail', desc: 'Complete email dispatch history with per-employee records, reminder logic for repeat offenders.' },
];

const competitors = [
  { feature: 'Local AI (no cloud)', hrpulse: true, bayzat: false, keka: false, greythr: false, zoho: false },
  { feature: 'On-premises deployment', hrpulse: true, bayzat: false, keka: false, greythr: false, zoho: false },
  { feature: 'GDHR SmartTime Excel parser', hrpulse: true, bayzat: false, keka: false, greythr: false, zoho: false },
  { feature: 'Bulk attendance email dispatch', hrpulse: true, bayzat: true, keka: true, greythr: true, zoho: true },
  { feature: 'LOP calculation', hrpulse: true, bayzat: true, keka: true, greythr: true, zoho: true },
  { feature: 'AI email personalization', hrpulse: true, bayzat: false, keka: false, greythr: false, zoho: false },
  { feature: 'Anomaly detection', hrpulse: true, bayzat: false, keka: false, greythr: false, zoho: false },
  { feature: 'Zero data cost', hrpulse: true, bayzat: false, keka: false, greythr: false, zoho: false },
];

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-slate-100 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-icons text-brand-600 text-2xl">corporate_fare</span>
          <span className="font-bold text-slate-800 text-xl">HRPulse</span>
        </div>
        <button
          onClick={() => navigate('/')}
          className="bg-brand-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          Launch App
        </button>
      </nav>

      {/* Hero */}
      <section className="bg-gradient-to-br from-brand-600 to-indigo-800 text-white px-8 py-20 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-white/10 rounded-full px-4 py-1.5 text-sm mb-6">
            <span className="material-icons text-base">lock</span>
            100% On-Premises &middot; No data leaves your server
          </div>
          <h1 className="text-5xl font-extrabold mb-5 leading-tight">
            AI-Powered HR Attendance<br />Email Dispatcher
          </h1>
          <p className="text-indigo-100 text-lg mb-8 max-w-xl mx-auto">
            Upload your GDHR SmartTime Excel, let local AI draft personalized absence notifications, and dispatch to your entire team — all without an internet connection.
          </p>
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="bg-white text-brand-700 font-semibold px-8 py-3 rounded-xl hover:bg-indigo-50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <span className="material-icons text-xl">rocket_launch</span>
                Launch Dispatcher
              </span>
            </button>
            <a
              href="#features"
              className="border border-white/40 text-white px-6 py-3 rounded-xl hover:bg-white/10 transition-colors text-sm"
            >
              See Features
            </a>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-b border-slate-100 py-8">
        <div className="max-w-4xl mx-auto px-8 grid grid-cols-4 gap-6">
          {[
            { value: '100+', label: 'Employees per dispatch' },
            { value: '0 AED', label: 'Cloud subscription cost' },
            { value: '100%', label: 'Data stays on your server' },
            { value: 'Offline', label: 'AI works without internet' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="text-3xl font-bold text-brand-600">{s.value}</div>
              <div className="text-sm text-slate-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-16 px-8">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-slate-800 text-center mb-2">Everything HR teams need</h2>
          <p className="text-slate-500 text-center mb-10">Built for UAE & GCC organizations using GDHR SmartTime attendance systems.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {features.map(f => (
              <div key={f.title} className="bg-slate-50 rounded-xl p-5 hover:shadow-md transition-shadow">
                <span className="material-icons text-brand-600 text-3xl mb-3 block">{f.icon}</span>
                <h3 className="font-semibold text-slate-800 text-sm mb-2">{f.title}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="py-16 px-8 bg-slate-50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-slate-800 text-center mb-2">vs. the competition</h2>
          <p className="text-slate-500 text-center mb-10">Why HRPulse wins for on-premises UAE deployments.</p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-4 py-3 text-slate-600 font-medium">Feature</th>
                  {['HRPulse', 'Bayzat', 'Keka', 'greytHR', 'Zoho People'].map(c => (
                    <th key={c} className={`px-4 py-3 text-center font-medium ${c === 'HRPulse' ? 'text-brand-700' : 'text-slate-500'}`}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {competitors.map((row, i) => (
                  <tr key={row.feature} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                    <td className="px-4 py-2.5 text-slate-700">{row.feature}</td>
                    {([row.hrpulse, row.bayzat, row.keka, row.greythr, row.zoho] as boolean[]).map((v, j) => (
                      <td key={j} className="px-4 py-2.5 text-center">
                        <span className={`material-icons text-base ${v ? 'text-green-500' : 'text-slate-300'}`}>
                          {v ? 'check_circle' : 'cancel'}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-8 text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold text-slate-800 mb-4">Ready to automate your HR emails?</h2>
          <p className="text-slate-500 mb-8">Your GDHR SmartTime Excel + Ollama + HRPulse = attendance emails done in minutes.</p>
          <button
            onClick={() => navigate('/')}
            className="bg-brand-600 text-white font-semibold px-10 py-3.5 rounded-xl hover:bg-brand-700 transition-colors inline-flex items-center gap-2"
          >
            <span className="material-icons text-xl">rocket_launch</span>
            Open HRPulse
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 py-6 px-8 text-center text-xs text-slate-400">
        HRPulse &middot; On-premises AI for UAE & GCC HR teams &middot; Powered by Ollama + llama3.1:8b
      </footer>
    </div>
  );
}
