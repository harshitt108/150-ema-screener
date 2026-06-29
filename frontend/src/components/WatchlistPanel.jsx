import { useState } from 'react'
import { X, Star, Trash2, Edit2, Check, Plus, ExternalLink, TrendingUp } from 'lucide-react'

export default function WatchlistPanel({ watchlist, onClose, onScanWatchlist }) {
  const { lists, createList, renameList, deleteList, removeStock } = watchlist
  const [activeListId, setActiveListId] = useState(lists[0]?.id || null)
  const [creating, setCreating]   = useState(false)
  const [newName, setNewName]     = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName]   = useState('')

  const activeList = lists.find(l => l.id === activeListId)

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

        {/* ── Right: stocks in selected list ─────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="px-6 py-4 border-b border-[#1e1e30] flex items-center gap-3">
            {activeList && (
              <>
                <span className="w-3 h-3 rounded-full" style={{ background: activeList.color }} />
                <h3 className="text-base font-bold text-white">{activeList.name}</h3>
                <span className="text-xs text-slate-500 bg-[#1a1a2e] px-2 py-0.5 rounded">
                  {activeList.stocks.length} stocks
                </span>
                {activeList.stocks.length > 0 && onScanWatchlist && (
                  <button
                    onClick={() => { onScanWatchlist(activeList); onClose() }}
                    className="ml-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600
                      hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
                  >
                    <TrendingUp size={13} /> Scan this list
                  </button>
                )}
              </>
            )}
            <button onClick={onClose} className="ml-auto p-2 rounded-lg hover:bg-[#1e1e30] text-slate-500 hover:text-slate-200">
              <X size={18} />
            </button>
          </div>

          {/* Stock list */}
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
            ) : (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
                {activeList.stocks.map(stock => (
                  <div
                    key={stock.symbol}
                    className="bg-[#111120] border border-[#1e1e30] rounded-xl p-3 flex flex-col gap-2
                      hover:border-[#2d2d45] transition-colors group"
                  >
                    <div className="flex items-start justify-between">
                      <span className="font-bold text-slate-100 text-sm">{stock.symbol}</span>
                      <button
                        onClick={() => removeStock(activeList.id, stock.symbol)}
                        className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-rose-400 transition-all"
                      ><X size={13} /></button>
                    </div>
                    <div className="flex items-center justify-between">
                      {stock.ltp && (
                        <span className="font-mono text-xs text-slate-400">₹{stock.ltp.toLocaleString('en-IN')}</span>
                      )}
                      <span className="text-[10px] text-slate-600">{stock.addedAt}</span>
                    </div>
                    <button
                      onClick={() => window.open(`https://www.tradingview.com/chart/?symbol=NSE:${stock.symbol}`, '_blank')}
                      className="flex items-center gap-1 text-[10px] text-slate-600 hover:text-violet-400 transition-colors"
                    >
                      <ExternalLink size={10} /> TradingView
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
