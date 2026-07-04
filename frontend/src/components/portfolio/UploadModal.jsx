import { useState, useRef } from 'react'
import { X, Upload, ClipboardList, FileText, CheckCircle, AlertTriangle } from 'lucide-react'

import { API_BASE } from '../../apiBase'

const PASTE_PLACEHOLDER = `TCS,25,3650,2024-01-15
RELIANCE,40,2810
HDFCBANK
INFOSYS,20,1480`

export default function UploadModal({ portfolioId, defaultTab = 'file', onSave, onClose }) {
  const [tab, setTab] = useState(defaultTab)
  const [pasteText, setPasteText] = useState('')
  const [file, setFile] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) setFile(f)
  }

  const handleFileUpload = async () => {
    if (!file) { setError('Please select a file'); return }
    setSaving(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${API_BASE}/api/portfolios/${portfolioId}/upload`, {
        method: 'POST',
        body: form,
      })
      if (!res.ok) throw new Error((await res.json()).detail || 'Upload failed')
      setResult(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handlePaste = async () => {
    if (!pasteText.trim()) { setError('Paste at least one symbol'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/portfolios/${portfolioId}/paste`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pasteText }),
      })
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed')
      setResult(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (result) {
    const unresolved = result.unresolved || []
    const updatedCount = result.updated?.length || 0
    const total = (result.added || 0) + updatedCount
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-[#0f0f1a] border border-[#2d2d45] rounded-2xl w-full max-w-md shadow-2xl p-6">
          <div className="text-center mb-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center mx-auto mb-4">
              <CheckCircle size={24} className="text-emerald-400" />
            </div>
            <h3 className="text-base font-semibold text-white mb-1">
              {total} stock{total !== 1 ? 's' : ''} {updatedCount && !result.added ? 'updated' : 'imported'}
            </h3>
            <p className="text-sm text-slate-500">
              {result.symbols?.slice(0, 8).join(', ')}
              {result.symbols?.length > 8 ? ` +${result.symbols.length - 8} more` : ''}
            </p>
          </div>

          {unresolved.length > 0 && (
            <div className="mb-4 bg-amber-500/10 border border-amber-500/25 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
                <p className="text-xs font-semibold text-amber-300">
                  {unresolved.length} stock{unresolved.length !== 1 ? 's' : ''} could not be resolved
                </p>
              </div>
              <p className="text-xs text-slate-500 mb-1.5">
                These could not be mapped to an NSE symbol — add them manually if needed:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {unresolved.map((name, i) => (
                  <span key={i} className="text-xs bg-[#1e1e30] border border-[#2d2d45] rounded-lg px-2 py-0.5 text-slate-400">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => onSave(result)}
            className="w-full px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#0f0f1a] border border-[#2d2d45] rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e1e30]">
          <h2 className="text-base font-semibold text-white">Add Holdings</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-[#1e1e30] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-[#1e1e30]">
          {[
            { id: 'file',  label: 'Upload File', icon: Upload },
            { id: 'paste', label: 'Paste Symbols', icon: ClipboardList },
          ].map(t => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setError(null) }}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px
                  ${tab === t.id
                    ? 'text-violet-400 border-violet-500'
                    : 'text-slate-500 border-transparent hover:text-slate-300'
                  }`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            )
          })}
        </div>

        <div className="px-6 py-5">
          {tab === 'file' && (
            <div className="space-y-4">
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
                  ${dragOver
                    ? 'border-violet-500/60 bg-violet-500/5'
                    : file
                      ? 'border-emerald-500/40 bg-emerald-500/5'
                      : 'border-[#2d2d45] hover:border-[#3d3d55]'
                  }`}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.txt,.xlsx,.xls"
                  className="hidden"
                  onChange={e => setFile(e.target.files[0])}
                />
                {file ? (
                  <div className="flex items-center justify-center gap-3 text-emerald-400">
                    <FileText size={20} />
                    <span className="text-sm font-medium">{file.name}</span>
                  </div>
                ) : (
                  <>
                    <Upload size={24} className="text-slate-600 mx-auto mb-3" />
                    <p className="text-sm text-slate-400 font-medium mb-1">Drop file here or click to browse</p>
                    <p className="text-xs text-slate-600">Supports .xlsx, .xls, .csv and .txt</p>
                  </>
                )}
              </div>

              <div className="bg-[#13131f] rounded-xl p-3 text-xs text-slate-500 space-y-1">
                <p className="text-slate-400 font-medium mb-1">CSV / TXT format:</p>
                <p className="font-mono">SYMBOL</p>
                <p className="font-mono">SYMBOL,QTY,AVG_PRICE</p>
                <p className="font-mono">SYMBOL,QTY,AVG_PRICE,YYYY-MM-DD</p>
                <p className="font-mono">SYMBOL,QTY,AVG_PRICE,YYYY-MM-DD,Notes</p>
                <p className="text-slate-400 font-medium mt-2 mb-1">Excel (.xlsx / .xls):</p>
                <p>Columns: <span className="font-mono">Symbol, Qty, Price, Date, Notes</span></p>
                <p className="text-slate-600">Header row optional — positional columns work too.</p>
              </div>
            </div>
          )}

          {tab === 'paste' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                Paste symbols — one per line, or comma/semicolon separated. Add quantity and price optionally.
              </p>
              <textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                placeholder={PASTE_PLACEHOLDER}
                rows={8}
                className="w-full bg-[#13131f] border border-[#2d2d45] rounded-xl px-3 py-2.5
                  text-sm text-white placeholder-slate-700 focus:outline-none focus:border-violet-500/60
                  transition-colors resize-none font-mono"
              />
              {pasteText.trim() && (
                <p className="text-xs text-slate-500">
                  ~{pasteText.split(/[\n,;]+/).filter(s => s.trim()).length} symbols detected
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="mt-3 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 mt-5">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-[#2d2d45] text-slate-400
                hover:text-slate-200 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={tab === 'file' ? handleFileUpload : handlePaste}
              disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500
                disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {saving ? 'Resolving symbols…' : 'Add to Portfolio'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
