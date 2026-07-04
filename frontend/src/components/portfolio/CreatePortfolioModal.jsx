import { useState, useEffect } from 'react'
import { X, TrendingUp, Zap, Settings2 } from 'lucide-react'

import { API_BASE } from '../../apiBase'

const PORTFOLIO_TYPES = [
  {
    id: 'investment',
    label: 'Investment Portfolio',
    desc: 'Long-term investing. Monitors weekly/monthly trend and major EMA deterioration.',
    icon: TrendingUp,
    color: '#10b981',
  },
  {
    id: 'swing',
    label: 'Swing Trading',
    desc: 'Active swing trades. Daily/intraday monitoring with breakout and EMA cross alerts.',
    icon: Zap,
    color: '#7c3aed',
  },
  {
    id: 'custom',
    label: 'Custom',
    desc: 'Define your own monitoring rules and timeframes from scratch.',
    icon: Settings2,
    color: '#64748b',
  },
]

const COLORS = [
  '#7c3aed', '#2563eb', '#0891b2', '#059669',
  '#d97706', '#e11d48', '#db2777', '#7c3aed',
]

export default function CreatePortfolioModal({ portfolio, onSave, onClose }) {
  const isEdit = Boolean(portfolio)
  const [name, setName] = useState(portfolio?.name ?? '')
  const [type, setType] = useState(portfolio?.type ?? 'investment')
  const [description, setDescription] = useState(portfolio?.description ?? '')
  const [color, setColor] = useState(portfolio?.color ?? '#7c3aed')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isEdit) {
      const selected = PORTFOLIO_TYPES.find(t => t.id === type)
      if (selected) setColor(selected.color)
    }
  }, [type, isEdit])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim()) { setError('Portfolio name is required'); return }
    setSaving(true)
    setError(null)
    try {
      const url = isEdit
        ? `${API_BASE}/api/portfolios/${portfolio.id}`
        : `${API_BASE}/api/portfolios`
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type, description: description.trim() || null, color }),
      })
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed to save')
      onSave(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#0f0f1a] border border-[#2d2d45] rounded-2xl w-full max-w-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e1e30]">
          <h2 className="text-base font-semibold text-white">
            {isEdit ? 'Edit Portfolio' : 'Create Portfolio'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-[#1e1e30] transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-xs text-slate-400 font-medium mb-1.5">Portfolio Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. My Investments, Swing Trades…"
              className="w-full bg-[#13131f] border border-[#2d2d45] rounded-xl px-3 py-2.5
                text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/60 transition-colors"
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs text-slate-400 font-medium mb-2">Portfolio Type</label>
            <div className="grid grid-cols-3 gap-2">
              {PORTFOLIO_TYPES.map(t => {
                const Icon = t.icon
                const active = type === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setType(t.id)}
                    className={`flex flex-col items-center gap-2 p-3 rounded-xl border text-center transition-all
                      ${active
                        ? 'border-violet-500/60 bg-violet-500/10'
                        : 'border-[#2d2d45] bg-[#13131f] hover:border-[#3d3d55]'
                      }`}
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: t.color + '22' }}
                    >
                      <Icon size={15} style={{ color: t.color }} />
                    </div>
                    <span className={`text-xs font-medium leading-tight ${active ? 'text-white' : 'text-slate-400'}`}>
                      {t.id === 'investment' ? 'Investment' : t.id === 'swing' ? 'Swing' : 'Custom'}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              {PORTFOLIO_TYPES.find(t => t.id === type)?.desc}
            </p>
          </div>

          {/* Color */}
          <div>
            <label className="block text-xs text-slate-400 font-medium mb-2">Accent Color</label>
            <div className="flex items-center gap-2">
              {COLORS.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-lg transition-all ${color === c ? 'ring-2 ring-white/50 scale-110' : 'hover:scale-105'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                className="w-7 h-7 rounded-lg cursor-pointer bg-transparent border border-[#2d2d45] p-0"
                title="Custom color"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-slate-400 font-medium mb-1.5">Description <span className="text-slate-600">(optional)</span></label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Long-term investments in quality businesses…"
              rows={2}
              className="w-full bg-[#13131f] border border-[#2d2d45] rounded-xl px-3 py-2.5
                text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/60
                transition-colors resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-[#2d2d45] text-slate-400
                hover:text-slate-200 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500
                disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Portfolio'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
