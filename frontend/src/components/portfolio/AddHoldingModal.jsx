import { useState, useEffect } from 'react'
import { X } from 'lucide-react'

import { API_BASE } from '../../apiBase'

export default function AddHoldingModal({ portfolioId, holding, onSave, onClose }) {
  const isEdit = Boolean(holding)
  const [symbol, setSymbol] = useState(holding?.symbol ?? '')
  const [quantity, setQuantity] = useState(holding?.quantity?.toString() ?? '')
  const [avgPrice, setAvgPrice] = useState(holding?.avgBuyPrice?.toString() ?? '')
  const [buyDate, setBuyDate] = useState(holding?.buyDate ?? '')
  const [notes, setNotes] = useState(holding?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const sym = symbol.trim().toUpperCase()
    if (!sym) { setError('Symbol is required'); return }
    setSaving(true)
    setError(null)
    try {
      const body = {
        symbol: sym,
        quantity: quantity ? parseFloat(quantity) : null,
        avg_buy_price: avgPrice ? parseFloat(avgPrice) : null,
        buy_date: buyDate || null,
        notes: notes.trim() || null,
      }
      const url = isEdit
        ? `${API_BASE}/api/portfolios/${portfolioId}/holdings/${holding.id}`
        : `${API_BASE}/api/portfolios/${portfolioId}/holdings`
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
      <div className="bg-[#0f0f1a] border border-[#2d2d45] rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e1e30]">
          <h2 className="text-base font-semibold text-white">
            {isEdit ? `Edit ${holding.symbol}` : 'Add Stock'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-[#1e1e30] transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs text-slate-400 font-medium mb-1.5">Symbol *</label>
            <input
              type="text"
              value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              placeholder="e.g. TCS, RELIANCE, HDFCBANK"
              disabled={isEdit}
              className="w-full bg-[#13131f] border border-[#2d2d45] rounded-xl px-3 py-2.5
                text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/60
                disabled:opacity-50 transition-colors font-mono"
            />
            <p className="text-xs text-slate-600 mt-1">NSE symbol without .NS suffix</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 font-medium mb-1.5">
                Quantity <span className="text-slate-600">(optional)</span>
              </label>
              <input
                type="number"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder="e.g. 25"
                min="0"
                step="any"
                className="w-full bg-[#13131f] border border-[#2d2d45] rounded-xl px-3 py-2.5
                  text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/60 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 font-medium mb-1.5">
                Avg Buy Price <span className="text-slate-600">(₹)</span>
              </label>
              <input
                type="number"
                value={avgPrice}
                onChange={e => setAvgPrice(e.target.value)}
                placeholder="e.g. 3650"
                min="0"
                step="any"
                className="w-full bg-[#13131f] border border-[#2d2d45] rounded-xl px-3 py-2.5
                  text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/60 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 font-medium mb-1.5">
              Buy Date <span className="text-slate-600">(optional)</span>
            </label>
            <input
              type="date"
              value={buyDate}
              onChange={e => setBuyDate(e.target.value)}
              className="w-full bg-[#13131f] border border-[#2d2d45] rounded-xl px-3 py-2.5
                text-sm text-white focus:outline-none focus:border-violet-500/60 transition-colors
                [color-scheme:dark]"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 font-medium mb-1.5">
              Notes <span className="text-slate-600">(optional)</span>
            </label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Core holding, SIP position…"
              className="w-full bg-[#13131f] border border-[#2d2d45] rounded-xl px-3 py-2.5
                text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/60 transition-colors"
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
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Stock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
