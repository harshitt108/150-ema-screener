import { useState, useEffect } from 'react'
import { X, Bell, CheckCircle } from 'lucide-react'

const API_BASE = 'http://localhost:8000'

const ALERT_OPTIONS = [
  { key: 'alertCrossBelow150', label: 'Cross below 150 EMA', desc: 'Primary long-term trend signal', recommended: true },
  { key: 'alertCrossBelow50',  label: 'Cross below 50 EMA',  desc: 'Medium-term trend deterioration' },
  { key: 'alertCrossBelow20',  label: 'Cross below 20 EMA',  desc: 'Short-term weakness' },
  { key: 'alertCrossBelow200', label: 'Cross below 200 EMA', desc: 'Major long-term trend break' },
  { key: 'alertCrossAbove150', label: 'Cross above 150 EMA', desc: 'Recovery / bullish reversal signal' },
]

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-violet-600' : 'bg-[#2d2d45]'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </button>
  )
}

export default function AlertSettingsModal({ portfolioId, portfolioName, onClose }) {
  const [settings, setSettings] = useState({
    recipientEmail: '',
    emailEnabled: false,
    alertCrossBelow20: false,
    alertCrossBelow50: false,
    alertCrossBelow150: true,
    alertCrossBelow200: false,
    alertCrossAbove150: false,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(`${API_BASE}/api/monitoring/portfolio-settings/${portfolioId}`)
      .then(r => r.json())
      .then(d => setSettings({
        recipientEmail:     d.recipientEmail     ?? '',
        emailEnabled:       d.emailEnabled       ?? false,
        alertCrossBelow20:  d.alertCrossBelow20  ?? false,
        alertCrossBelow50:  d.alertCrossBelow50  ?? false,
        alertCrossBelow150: d.alertCrossBelow150 ?? true,
        alertCrossBelow200: d.alertCrossBelow200 ?? false,
        alertCrossAbove150: d.alertCrossAbove150 ?? false,
      }))
      .finally(() => setLoading(false))
  }, [portfolioId])

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/monitoring/portfolio-settings/${portfolioId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_email:       settings.recipientEmail || null,
          email_enabled:         settings.emailEnabled,
          alert_cross_below_20:  settings.alertCrossBelow20,
          alert_cross_below_50:  settings.alertCrossBelow50,
          alert_cross_below_150: settings.alertCrossBelow150,
          alert_cross_below_200: settings.alertCrossBelow200,
          alert_cross_above_150: settings.alertCrossAbove150,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).detail || 'Save failed')
      setSaved(true)
      setTimeout(() => { setSaved(false); onClose() }, 1200)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const set = (k, v) => setSettings(s => ({ ...s, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#0f0f1a] border border-[#2d2d45] rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e1e30]">
          <div className="flex items-center gap-2">
            <Bell size={15} className="text-violet-400" />
            <div>
              <h2 className="text-base font-semibold text-white">Alert Settings</h2>
              <p className="text-xs text-slate-500">{portfolioName}</p>
            </div>
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
          <form onSubmit={handleSave} className="px-6 py-5 space-y-5">
            {/* Email toggle + address */}
            <div className="bg-[#13131f] border border-[#2d2d45] rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">Email Alerts</p>
                  <p className="text-xs text-slate-500 mt-0.5">Send alerts to your inbox</p>
                </div>
                <Toggle checked={settings.emailEnabled} onChange={v => set('emailEnabled', v)} />
              </div>
              {settings.emailEnabled && (
                <input
                  type="email"
                  value={settings.recipientEmail}
                  onChange={e => set('recipientEmail', e.target.value)}
                  placeholder="Recipient email address"
                  className="w-full bg-[#0f0f1a] border border-[#2d2d45] rounded-xl px-3 py-2.5
                    text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/60 transition-colors"
                />
              )}
            </div>

            {/* Alert triggers */}
            <div>
              <p className="text-xs text-slate-400 font-medium mb-3">Trigger alerts when:</p>
              <div className="space-y-2">
                {ALERT_OPTIONS.map(opt => (
                  <div key={opt.key}
                    className="flex items-center justify-between p-3 rounded-xl bg-[#13131f] border border-[#1e1e30]">
                    <div className="flex-1 min-w-0 mr-3">
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-slate-200">{opt.label}</p>
                        {opt.recommended && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 font-medium border border-violet-500/20">
                            Recommended
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{opt.desc}</p>
                    </div>
                    <Toggle checked={settings[opt.key]} onChange={v => set(opt.key, v)} />
                  </div>
                ))}
              </div>
            </div>

            {error && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            {saved && (
              <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 flex items-center gap-2">
                <CheckCircle size={12} /> Settings saved
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
          </form>
        )}
      </div>
    </div>
  )
}
