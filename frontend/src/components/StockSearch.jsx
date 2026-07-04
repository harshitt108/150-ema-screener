import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, X, Clock, TrendingUp, Loader, LineChart } from 'lucide-react'

import { API_BASE } from '../apiBase'

// A few well-known large caps to seed the page before the user has any history.
const POPULAR = [
  { symbol: 'RELIANCE', name: 'Reliance Industries' },
  { symbol: 'TCS',      name: 'Tata Consultancy Services' },
  { symbol: 'INFY',     name: 'Infosys' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank' },
  { symbol: 'ICICIBANK',name: 'ICICI Bank' },
  { symbol: 'SBIN',     name: 'State Bank of India' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel' },
  { symbol: 'ITC',      name: 'ITC' },
]

function timeAgo(iso) {
  const then = new Date(iso).getTime()
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 60)   return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60)   return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)    return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export default function StockSearch({ recentSearches, onSelect }) {
  const { recents, removeRecent, clearRecents } = recentSearches

  const [query,    setQuery]    = useState('')
  const [results,  setResults]  = useState([])
  const [loading,  setLoading]  = useState(false)
  const [open,     setOpen]     = useState(false)
  const [active,   setActive]   = useState(-1)   // highlighted dropdown row

  const inputRef = useRef(null)
  const boxRef   = useRef(null)

  // Autofocus the search box when the module mounts
  useEffect(() => { inputRef.current?.focus() }, [])

  // Debounced free-text search against the backend symbol search
  useEffect(() => {
    const q = query.trim()
    if (q.length < 1) { setResults([]); setLoading(false); return }

    let cancelled = false
    setLoading(true)
    const t = setTimeout(() => {
      fetch(`${API_BASE}/api/search-symbols?q=${encodeURIComponent(q)}`)
        .then(r => r.ok ? r.json() : { results: [] })
        .then(d => {
          if (cancelled) return
          setResults(d.results || [])
          setActive(-1)
          setLoading(false)
        })
        .catch(() => { if (!cancelled) { setResults([]); setLoading(false) } })
    }, 250)

    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  // Close dropdown on outside click
  useEffect(() => {
    const onDoc = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = useCallback((stock) => {
    setOpen(false)
    setQuery('')
    setResults([])
    onSelect(stock)
  }, [onSelect])

  const onKeyDown = (e) => {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(a => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(a => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = active >= 0 ? results[active] : results[0]
      if (chosen) pick(chosen)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showDropdown = open && query.trim().length > 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      {/* Hero */}
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-violet-600/15 border border-violet-500/30 flex items-center justify-center mx-auto mb-4">
          <LineChart size={26} className="text-violet-400" />
        </div>
        <h2 className="text-2xl font-bold text-white">Search any NSE stock</h2>
        <p className="text-sm text-slate-500 mt-1">
          Type a name or symbol to open its chart. Toggle timeframes inside the panel.
        </p>
      </div>

      {/* Search box + dropdown */}
      <div ref={boxRef} className="relative">
        <div className="flex items-center gap-3 px-4 h-14 rounded-2xl bg-[#13131f] border border-[#2d2d45]
          focus-within:border-violet-500/60 transition-colors">
          <Search size={20} className="text-slate-500 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="e.g. TCS, Infosys, Reliance…"
            className="flex-1 bg-transparent outline-none text-white placeholder-slate-600 text-base"
          />
          {loading && <Loader size={18} className="animate-spin text-violet-500 flex-shrink-0" />}
          {query && !loading && (
            <button
              onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus() }}
              className="text-slate-500 hover:text-slate-300 flex-shrink-0"
            ><X size={18} /></button>
          )}
        </div>

        {showDropdown && (
          <div className="absolute z-30 mt-2 w-full rounded-xl bg-[#13131f] border border-[#2d2d45]
            shadow-2xl overflow-hidden max-h-[360px] overflow-y-auto">
            {results.length === 0 && !loading && (
              <div className="px-4 py-6 text-center text-sm text-slate-500">
                No matches for “{query.trim()}”
              </div>
            )}
            {results.map((r, i) => (
              <button
                key={r.symbol}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(r)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors
                  ${i === active ? 'bg-violet-600/20' : 'hover:bg-[#1a1a2e]'}`}
              >
                <div className="w-8 h-8 rounded-lg bg-[#0d0d18] border border-[#2d2d45] flex items-center justify-center flex-shrink-0">
                  <TrendingUp size={14} className="text-violet-400" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">{r.symbol}</div>
                  <div className="text-xs text-slate-500 truncate">{r.name}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Recent searches */}
      <div className="mt-10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
            <Clock size={15} className="text-slate-500" />
            {recents.length > 0 ? 'Recent searches' : 'Popular stocks'}
          </div>
          {recents.length > 0 && (
            <button
              onClick={clearRecents}
              className="text-xs text-slate-500 hover:text-rose-400 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {(recents.length > 0 ? recents : POPULAR).map(item => (
            <div
              key={item.symbol}
              className="group relative"
            >
              <button
                onClick={() => pick({ symbol: item.symbol, name: item.name })}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-[#13131f] border border-[#1e1e30]
                  hover:border-violet-500/50 hover:bg-[#1a1a2e] text-left transition-colors"
              >
                <div className="w-9 h-9 rounded-lg bg-violet-600/15 border border-violet-500/25 flex items-center justify-center flex-shrink-0">
                  <TrendingUp size={16} className="text-violet-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-white truncate">{item.symbol}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {recents.length > 0 && item.ts ? timeAgo(item.ts) : item.name}
                  </div>
                </div>
              </button>
              {recents.length > 0 && (
                <button
                  onClick={() => removeRecent(item.symbol)}
                  className="absolute top-2 right-2 p-1 rounded-md text-slate-600 hover:text-rose-400
                    hover:bg-[#0d0d18] opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove"
                ><X size={13} /></button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
