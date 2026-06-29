import { useState, useCallback } from 'react'

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

function save(lists) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lists))
}

export default function useWatchlist() {
  const [lists, setLists] = useState(load)

  const persist = useCallback((updated) => {
    setLists(updated)
    save(updated)
  }, [])

  // ── List CRUD ──────────────────────────────────────────────────────────────
  const createList = useCallback((name) => {
    const color = DEFAULT_COLORS[lists.length % DEFAULT_COLORS.length]
    const newList = {
      id:     `wl_${Date.now()}`,
      name,
      color,
      stocks: [],
    }
    persist([...lists, newList])
    return newList.id
  }, [lists, persist])

  const renameList = useCallback((id, name) => {
    persist(lists.map(l => l.id === id ? { ...l, name } : l))
  }, [lists, persist])

  const deleteList = useCallback((id) => {
    persist(lists.filter(l => l.id !== id))
  }, [lists, persist])

  // ── Stock CRUD ─────────────────────────────────────────────────────────────
  const addStock = useCallback((listId, symbol, meta = {}) => {
    persist(lists.map(l => {
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
  }, [lists, persist])

  const removeStock = useCallback((listId, symbol) => {
    persist(lists.map(l =>
      l.id === listId
        ? { ...l, stocks: l.stocks.filter(s => s.symbol !== symbol) }
        : l
    ))
  }, [lists, persist])

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
