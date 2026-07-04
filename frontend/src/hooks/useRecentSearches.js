import { useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'nse_recent_searches_v1'
const MAX_RECENT  = 12

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []
  } catch {
    return []
  }
}

// Persistent, most-recent-first list of stocks the user has opened from search.
// Deduped by symbol, capped at MAX_RECENT.
export default function useRecentSearches() {
  const [recents, setRecents] = useState(load)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(recents)) } catch { /* ignore */ }
  }, [recents])

  const addRecent = useCallback((stock) => {
    if (!stock?.symbol) return
    setRecents(prev => {
      const without = prev.filter(r => r.symbol !== stock.symbol)
      const entry = {
        symbol: stock.symbol,
        name:   stock.name || stock.symbol,
        ts:     new Date().toISOString(),
      }
      return [entry, ...without].slice(0, MAX_RECENT)
    })
  }, [])

  const removeRecent = useCallback((symbol) => {
    setRecents(prev => prev.filter(r => r.symbol !== symbol))
  }, [])

  const clearRecents = useCallback(() => setRecents([]), [])

  return { recents, addRecent, removeRecent, clearRecents }
}
