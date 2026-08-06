import { useNavigate } from 'react-router-dom';

const features = [
  { icon: 'upload_file', title: 'GDHR SmartTime Integration', desc: 'Upload your SmartTime Excel export and HRPulse instantly parses all 15+ column variants — no config needed.' },
  { icon: 'mail', title: 'Template Email Drafting', desc: 'Generate consistent attendance emails from editable HR templates, with previews before dispatch.' },
  { icon: 'payments', title: 'Loss of Pay Calculator', desc: 'Configurable LOP formula: basic salary / working days × effective absent days with adjustable missed-swipe weights.' },
  { icon: 'send', title: 'Bulk SMTP Dispatch', desc: 'Preview, edit, and dispatch emails to 100+ employees in one click via your corporate SMTP server.' },
  { icon: 'bar_chart', title: 'Attendance Analytics', desc: 'Trend charts, top offenders, and monthly comparisons across all uploaded periods.' },
  { icon: 'rule', title: 'Rules & SOPs Engine', desc: 'Define HR policy rules and maintain standard operating procedures in a searchable knowledge base.' },
  { icon: 'cloud', title: 'Supabase + Vercel', desc: 'Secure hosted database and reliable web deployment with HR access from anywhere.' },
  { icon: 'history', title: 'Full Audit Trail', desc: 'Complete email dispatch history with per-employee records, reminder logic for repeat offenders.' },
];

const competitors = [
  { feature: 'Supabase + Vercel deployment', hrpulse: true, bayzat: false, keka: false, greythr: false, zoho: false },
  { feature: 'GDHR SmartTime Excel parser', hrpulse: true, bayzat: false, keka: false, greythr: false, zoho: false },
  { feature: 'Bulk attendance email dispatch', hrpulse: true, bayzat: true, keka: true, greythr: true, zoho: true },
  { feature: 'LOP calculation', hrpulse: true, bayzat: true, keka: true, greythr: true, zoho: true },
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
            Supabase database &middot; Vercel deployment
          </div>
          <h1 className="text-5xl font-extrabold mb-5 leading-tight">
            HR Attendance<br />Email Dispatcher
          </h1>
          <p className="text-indigo-100 text-lg mb-8 max-w-xl mx-auto">
            Upload your GDHR SmartTime Excel, review attendance issues, and dispatch consistent HR notifications from one secure web app.
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
            { value: '1', label: 'Supabase database' },
            { value: 'Vercel', label: 'Web deployment' },
            { value: '100+', label: 'Employees per dispatch' },
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
          <p className="text-slate-500 mb-8">Your GDHR SmartTime Excel + Supabase + Vercel = attendance emails done in minutes.</p>
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
        HRPulse &middot; Attendance email automation for UAE & GCC HR teams &middot; Powered by Supabase + Vercel
      </footer>
    </div>
  );
}
