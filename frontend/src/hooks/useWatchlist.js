import { useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'nse_watchlists_v1'

const DEFAULT_COLORS = [
  '#7c3aed', '#059669', '#dc2626', '#d97706', '#2563eb',
  '#db2777', '#0891b2', '#65a30d',
]

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []
  } catch {
    return []
  }
}

export default function useWatchlist() {
  const [lists, setLists] = useState(load)

  // Persist whenever lists change. Doing this in an effect (rather than inside
  // each mutation) lets every mutation use a FUNCTIONAL state updater, which is
  // essential: creating a list and immediately adding a stock fires two updates
  // in the same tick — functional updaters guarantee the second sees the first,
  // so the new list isn't clobbered by a stale-closure write.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lists)) } catch { /* ignore */ }
  }, [lists])

  // ── List CRUD ──────────────────────────────────────────────────────────────
  const createList = useCallback((name) => {
    const id = `wl_${Date.now()}`
    setLists(prev => {
      const color = DEFAULT_COLORS[prev.length % DEFAULT_COLORS.length]
      return [...prev, { id, name, color, stocks: [] }]
    })
    return id
  }, [])

  const renameList = useCallback((id, name) => {
    setLists(prev => prev.map(l => l.id === id ? { ...l, name } : l))
  }, [])

  const deleteList = useCallback((id) => {
    setLists(prev => prev.filter(l => l.id !== id))
  }, [])

  // ── Stock CRUD ─────────────────────────────────────────────────────────────
  const addStock = useCallback((listId, symbol, meta = {}) => {
    setLists(prev => prev.map(l => {
      if (l.id !== listId) return l
      if (l.stocks.some(s => s.symbol === symbol)) return l   // already in list
      return {
        ...l,
        stocks: [...l.stocks, {
          symbol,
          addedAt: new Date().toISOString().slice(0, 10),
          ltp: meta.ltp,
          note: '',
        }],
      }
    }))
  }, [])

  const removeStock = useCallback((listId, symbol) => {
    setLists(prev => prev.map(l =>
      l.id === listId
        ? { ...l, stocks: l.stocks.filter(s => s.symbol !== symbol) }
        : l
    ))
  }, [])

  // ── Queries ────────────────────────────────────────────────────────────────
  const listsContaining = useCallback((symbol) =>
    lists.filter(l => l.stocks.some(s => s.symbol === symbol))
  , [lists])

  const isWatched = useCallback((symbol) =>
    lists.some(l => l.stocks.some(s => s.symbol === symbol))
  , [lists])

  return {
    lists,
    createList, renameList, deleteList,
    addStock, removeStock,
    listsContaining, isWatched,
  }
}
