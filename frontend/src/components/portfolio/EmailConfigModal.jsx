import { useState, useEffect } from 'react'
import { X, Mail, Eye, EyeOff, CheckCircle, AlertCircle, Send } from 'lucide-react'

const API_BASE = 'http://localhost:8000'

export default function EmailConfigModal({ onClose }) {
  const [form, setForm] = useState({
    smtp_host: 'smtp.gmail.com',
    smtp_port: 587,
    smtp_user: '',
    smtp_password: '',
    from_name: 'Portfolio Guardian',
  })
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/api/monitoring/email-config`)
      .then(r => r.json())
      .then(d => {
        if (d.configured) {
          setForm(f => ({
            ...f,
            smtp_host: d.smtp_host ?? f.smtp_host,
            smtp_port: d.smtp_port ?? f.smtp_port,
            smtp_user: d.smtp_user ?? '',
            from_name: d.from_name ?? f.from_name,
          }))
          setTestEmail(d.smtp_user ?? '')
        }
      })
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.smtp_user) { setError('Gmail address is required'); return }
    if (!form.smtp_password || form.smtp_password === '••••••••') {
      setError('Enter your Gmail App Password'); return
    }
    setSaving(true); setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/monitoring/email-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error((await res.json()).detail || 'Save failed')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const handleTest = async () => {
    if (!testEmail) return
    setTesting(true); setTestResult(null)
    try {
      const res = await fetch(`${API_BASE}/api/monitoring/test-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_email: testEmail }),
      })
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed')
      setTestResult({ ok: true, msg: `Test email sent to ${testEmail}` })
    } catch (e) { setTestResult({ ok: false, msg: e.message }) }
    finally { setTesting(false) }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#0f0f1a] border border-[#2d2d45] rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e1e30]">
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-violet-400" />
            <h2 className="text-base font-semibold text-white">Email Configuration</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-[#1e1e30]">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="px-6 py-12 flex justify-center">
            <div className="w-6 h-6 border-2 border-[#1e1e30] border-t-violet-500 rounded-full animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
            {/* Gmail hint */}
            <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-3 text-xs text-slate-400 leading-relaxed">
              <span className="text-violet-300 font-medium">Gmail setup: </span>
              Enable 2FA on your Google account, then go to{' '}
              <span className="text-slate-300">Google Account → Security → App Passwords</span>
              {' '}and generate a password for "Mail". Paste it below.
            </div>

            <div>
              <label className="block text-xs text-slate-400 font-medium mb-1.5">Gmail Address</label>
              <input
                type="email"
                value={form.smtp_user}
                onChange={e => { set('smtp_user', e.target.value); setTestEmail(e.target.value) }}
                placeholder="you@gmail.com"
                className="w-full bg-[#13131f] border border-[#2d2d45] rounded-xl px-3 py-2.5
                  text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/60 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 font-medium mb-1.5">App Password</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={form.smtp_password}
                  onChange={e => set('smtp_password', e.target.value)}
                  placeholder="16-character app password"
                  className="w-full bg-[#13131f] border border-[#2d2d45] rounded-xl px-3 py-2.5 pr-10
                    text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/60 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 font-medium mb-1.5">Sender Name</label>
                <input
                  type="text"
                  value={form.from_name}
                  onChange={e => set('from_name', e.target.value)}
                  className="w-full bg-[#13131f] border border-[#2d2d45] rounded-xl px-3 py-2.5
                    text-sm text-white focus:outline-none focus:border-violet-500/60 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 font-medium mb-1.5">SMTP Port</label>
                <input
                  type="number"
                  value={form.smtp_port}
                  onChange={e => set('smtp_port', parseInt(e.target.value))}
                  className="w-full bg-[#13131f] border border-[#2d2d45] rounded-xl px-3 py-2.5
                    text-sm text-white focus:outline-none focus:border-violet-500/60 transition-colors"
                />
              </div>
            </div>

            {error && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            {saved && (
              <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 flex items-center gap-2">
                <CheckCircle size={12} /> Settings saved successfully
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[#2d2d45] text-slate-400
                  hover:text-slate-200 text-sm font-medium transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={saving}
                className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500
                  disabled:opacity-50 text-white text-sm font-semibold transition-colors">
                {saving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>

            {/* Test email */}
            <div className="pt-3 border-t border-[#1e1e30]">
              <p className="text-xs text-slate-500 mb-2 font-medium">Test your configuration</p>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={testEmail}
                  onChange={e => setTestEmail(e.target.value)}
                  placeholder="Send test to…"
                  className="flex-1 bg-[#13131f] border border-[#2d2d45] rounded-xl px-3 py-2
                    text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/60 transition-colors"
                />
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testing || !testEmail}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#13131f] border border-[#2d2d45]
                    text-slate-300 hover:text-white text-xs font-medium disabled:opacity-50 transition-colors"
                >
                  <Send size={12} />
                  {testing ? 'Sending…' : 'Send Test'}
                </button>
              </div>
              {testResult && (
                <p className={`text-xs mt-2 flex items-center gap-1.5 ${testResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {testResult.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                  {testResult.msg}
                </p>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
