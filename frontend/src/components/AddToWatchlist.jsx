import { useState, useRef, useEffect } from 'react'
import { Star, Plus, Check, ChevronDown } from 'lucide-react'
import { toast } from './Toast'

export default function AddToWatchlist({ symbol, ltp, watchlist, compact = false }) {
  const { lists, createList, addStock, removeStock, listsContaining, isWatched } = watchlist
  const [open, setOpen]       = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName]  = useState('')
  const ref = useRef(null)

  const inLists  = listsContaining(symbol)
  const watched  = isWatched(symbol)

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleCreate = () => {
    const name = newName.trim()
    if (!name) return
    const id = createList(name)
    addStock(id, symbol, { ltp })
    toast(`${symbol} added to ${name}`)
    setNewName('')
    setCreating(false)
    setOpen(false)
  }

  const toggle = (listId) => {
    const list = lists.find(l => l.id === listId)
    const already = inLists.some(l => l.id === listId)
    if (already) {
      removeStock(listId, symbol)
      toast(`${symbol} removed from ${list?.name ?? 'watchlist'}`, 'info')
    } else {
      addStock(listId, symbol, { ltp })
      toast(`${symbol} added to ${list?.name ?? 'watchlist'}`)
    }
  }

  return (
    <div ref={ref} className="relative" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Add to watchlist"
        className={`flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors text-xs font-medium
          ${watched
            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
            : compact
              ? 'text-slate-600 hover:text-amber-400 hover:bg-[#1a1a2e]'
              : 'bg-[#1a1a2e] text-slate-400 hover:text-amber-400 border border-[#2d2d45] hover:border-amber-500/30'
          }`}
      >
        <Star size={13} className={watched ? 'fill-amber-400' : ''} />
        {!compact && (watched ? 'Watching' : 'Watch')}
        {!compact && <ChevronDown size={11} />}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-[100] w-52
          bg-[#1e1e32] border border-[#2d2d45] rounded-xl shadow-2xl overflow-hidden">

          {/* Existing lists */}
          {lists.length > 0 && (
            <div className="p-1">
              {lists.map(list => {
                const inThis = inLists.some(l => l.id === list.id)
                return (
                  <button
                    key={list.id}
                    onClick={() => toggle(list.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg
                      hover:bg-[#2a2a40] text-sm text-slate-300 transition-colors"
                  >
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: list.color }} />
                    <span className="flex-1 text-left truncate">{list.name}</span>
                    <span className="text-[10px] text-slate-500">{list.stocks.length}</span>
                    {inThis && <Check size={12} className="text-emerald-400 flex-shrink-0" />}
                  </button>
                )
              })}
            </div>
          )}

          {lists.length > 0 && <div className="border-t border-[#2d2d45] mx-3" />}

          {/* Create new list */}
          <div className="p-2">
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
                <button onClick={handleCreate} className="px-2.5 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-semibold hover:bg-violet-500">
                  Add
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg
                  hover:bg-[#2a2a40] text-slate-500 hover:text-violet-400 text-sm transition-colors"
              >
                <Plus size={13} />
                New list
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
