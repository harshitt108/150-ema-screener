import { useState, useEffect } from 'react'
import { X, Star, Trash2, Edit2, Plus, TrendingUp, Loader } from 'lucide-react'
import ResultsTable from './ResultsTable'

const API_BASE = 'http://localhost:8000'

const TIMEFRAMES = [
  { value: '5min', label: '5m' }, { value: '15min', label: '15m' }, { value: '30min', label: '30m' },
  { value: '1h', label: '1H' },
  { value: 'daily', label: '1D' }, { value: 'weekly', label: '1W' }, { value: 'monthly', label: '1M' },
]

export default function WatchlistPanel({ watchlist, onClose, onScanWatchlist, onOpenStock }) {
  const { lists, createList, renameList, deleteList } = watchlist
  const [activeListId, setActiveListId] = useState(lists[0]?.id || null)
  const [creating, setCreating]   = useState(false)
  const [newName, setNewName]     = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName]   = useState('')
  const [timeframe, setTimeframe] = useState('daily')
  const [results, setResults]     = useState([])     // full scanner rows (same shape as EMA scanner)
  const [noData, setNoData]       = useState([])
  const [loading, setLoading]     = useState(false)

  const activeList = lists.find(l => l.id === activeListId)

  // Fetch full EMA-scanner data for the active list's symbols (no filtering)
  // whenever the list or timeframe changes — same data the EMA scanner shows.
  useEffect(() => {
    const symbols = (activeList?.stocks || []).map(s => s.symbol)
    if (!symbols.length) { setResults([]); setNoData([]); return }
    let cancelled = false
    setLoading(true)
    // Parallel: EMA scan (correct row shape for ResultsTable) +
    //           RS scan (just for ratioEmas). Merged by symbol.
    const emaFetch = fetch(`${API_BASE}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbols, timeframe, ema_period: 150, condition: 'all',
        distance_pct: 3.0, cross_lookback: 5,
      }),
    }).then(r => r.ok ? r.json() : Promise.reject(r.statusText))

    const ratioFetch = fetch(`${API_BASE}/api/rs-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbols, timeframe, ema_period: 150,
        benchmark: 'NIFTY 50', rs_condition: 'all',
        distance_pct: 3.0, cross_lookback: 5,
      }),
    }).then(r => r.ok ? r.json() : null).catch(() => null)

    Promise.all([emaFetch, ratioFetch])
      .then(([emaData, ratioData]) => {
        if (cancelled) return
        const ratioMap = {}
        ;(ratioData?.results || []).forEach(r => { ratioMap[r.symbol] = r.ratioEmas })
        const merged = (emaData?.results || []).map(r => ({
          ...r,
          ratioEmas: ratioMap[r.symbol] || null,
        }))
        setResults(merged)
        setNoData(emaData?.noData || [])
        setLoading(false)
      })
      .catch(() => { if (!cancelled) { setResults([]); setLoading(false) } })
    return () => { cancelled = true }
  }, [activeListId, timeframe, activeList?.stocks.length])

  const handleCreate = () => {
    const name = newName.trim()
    if (!name) return
    const id = createList(name)
    setActiveListId(id)
    setNewName('')
    setCreating(false)
  }

  const handleRename = (id) => {
    const name = editName.trim()
    if (name) renameList(id, name)
    setEditingId(null)
  }

  // Open the chart panel with the full row; prev/next walks the result set
  const handleRowClick = (row) => {
    const idx = results.findIndex(r => r.symbol === row.symbol)
    onOpenStock?.(results, idx < 0 ? 0 : idx, timeframe)
  }

  const totalStocks = lists.reduce((s, l) => s + l.stocks.length, 0)

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="fixed inset-4 z-50 flex rounded-2xl overflow-hidden shadow-2xl border border-[#1e1e30]
        bg-[#0d0d18] animate-[slideIn_0.2s_ease-out]">

        {/* ── Left: list sidebar ──────────────────────────────────────────── */}
        <div className="w-64 flex-shrink-0 border-r border-[#1e1e30] flex flex-col">
          <div className="p-4 border-b border-[#1e1e30] flex items-center gap-2">
            <Star size={16} className="text-amber-400 fill-amber-400" />
            <h2 className="text-sm font-bold text-white">Watchlists</h2>
            <span className="ml-auto text-xs text-slate-500">{totalStocks} stocks</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {lists.map(list => (
              <div
                key={list.id}
                className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors
                  ${activeListId === list.id ? 'bg-[#2a2a40]' : 'hover:bg-[#1a1a2e]'}`}
                onClick={() => setActiveListId(list.id)}
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: list.color }} />

                {editingId === list.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key==='Enter') handleRename(list.id); if (e.key==='Escape') setEditingId(null) }}
                    onBlur={() => handleRename(list.id)}
                    className="flex-1 bg-[#13131f] border border-violet-500 rounded px-1.5 py-0.5 text-xs text-slate-200 focus:outline-none"
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <span className="flex-1 text-sm text-slate-300 truncate">{list.name}</span>
                )}

                <span className="text-xs text-slate-600 mr-1">{list.stocks.length}</span>

                <div className="hidden group-hover:flex items-center gap-1">
                  <button
                    onClick={e => { e.stopPropagation(); setEditingId(list.id); setEditName(list.name) }}
                    className="p-0.5 text-slate-500 hover:text-violet-400"
                  ><Edit2 size={11} /></button>
                  <button
                    onClick={e => { e.stopPropagation(); deleteList(list.id); if (activeListId===list.id) setActiveListId(lists.find(l=>l.id!==list.id)?.id||null) }}
                    className="p-0.5 text-slate-500 hover:text-rose-400"
                  ><Trash2 size={11} /></button>
                </div>
              </div>
            ))}
          </div>

          {/* New list */}
          <div className="p-3 border-t border-[#1e1e30]">
            {creating ? (
              <div className="flex gap-1.5">
                <input
                  autoFocus
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key==='Enter') handleCreate(); if (e.key==='Escape') setCreating(false) }}
                  placeholder="List name..."
                  className="flex-1 bg-[#13131f] border border-[#3d3d55] rounded-lg px-2.5 py-1.5
                    text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500"
                />
                <button onClick={handleCreate} className="px-2.5 bg-violet-600 text-white rounded-lg text-xs font-semibold hover:bg-violet-500">
                  Add
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg
                  border border-dashed border-[#2d2d45] text-slate-500 hover:text-violet-400
                  hover:border-violet-500/50 text-sm transition-colors"
              >
                <Plus size={13} /> New list
              </button>
            )}
          </div>
        </div>

        {/* ── Right: full EMA-scanner table for selected list ────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="px-6 py-4 border-b border-[#1e1e30] flex items-center gap-3 flex-wrap">
            {activeList && (
              <>
                <span className="w-3 h-3 rounded-full" style={{ background: activeList.color }} />
                <h3 className="text-base font-bold text-white">{activeList.name}</h3>
                <span className="text-xs text-slate-500 bg-[#1a1a2e] px-2 py-0.5 rounded">
                  {activeList.stocks.length} stocks
                </span>

                {/* Timeframe selector — compare EMA position across timeframes */}
                {activeList.stocks.length > 0 && (
                  <div className="flex items-center gap-1 ml-2 bg-[#13131f] border border-[#1e1e30] rounded-lg p-0.5">
                    {TIMEFRAMES.map(tf => (
                      <button
                        key={tf.value}
                        onClick={() => setTimeframe(tf.value)}
                        className={`px-2 py-1 rounded-md text-xs font-medium transition-colors
                          ${timeframe === tf.value ? 'bg-violet-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        {tf.label}
                      </button>
                    ))}
                  </div>
                )}

                {activeList.stocks.length > 0 && onScanWatchlist && (
                  <button
                    onClick={() => { onScanWatchlist(activeList); onClose() }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1a1a2e] border border-[#2d2d45]
                      hover:border-violet-500/50 text-slate-300 text-xs font-semibold transition-colors"
                  >
                    <TrendingUp size={13} /> Scan with filters
                  </button>
                )}
              </>
            )}
            <button onClick={onClose} className="ml-auto p-2 rounded-lg hover:bg-[#1e1e30] text-slate-500 hover:text-slate-200">
              <X size={18} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {!activeList ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-500">
                <Star size={40} className="mb-3 text-slate-700" />
                <p className="text-sm">Create a watchlist to get started</p>
              </div>
            ) : activeList.stocks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-500">
                <Star size={40} className="mb-3 text-slate-700" />
                <p className="text-sm font-medium">No stocks yet</p>
                <p className="text-xs mt-1">Click ★ on any scan result to add stocks here</p>
              </div>
            ) : loading && results.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-500">
                <Loader size={28} className="animate-spin text-violet-500 mb-3" />
                <p className="text-sm">Loading {timeframe} data…</p>
              </div>
            ) : (
              <>
                {loading && (
                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                    <Loader size={12} className="animate-spin" /> Refreshing {timeframe}…
                  </div>
                )}
                <ResultsTable
                  results={results}
                  scanned={activeList.stocks.length}
                  onRowClick={handleRowClick}
                  watchlist={watchlist}
                />
                {noData.length > 0 && (
                  <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 text-xs">
                    <strong>{noData.length}</strong> could not be fetched on this timeframe:{' '}
                    <span className="font-mono text-amber-300">{noData.join(', ')}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
