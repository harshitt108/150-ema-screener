import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

import { API_BASE } from '../apiBase'

const TIMEFRAMES = [
  { value: '5min',    label: '5m'  },
  { value: '15min',   label: '15m' },
  { value: '30min',   label: '30m' },
  { value: '1h',      label: '1H'  },
  { value: 'daily',   label: '1D'  },
  { value: 'weekly',  label: '1W'  },
  { value: 'monthly', label: '1M'  },
]

function formatVolume(v) {
  if (v == null) return '—'
  if (v >= 1e7) return `${(v / 1e7).toFixed(2)}Cr`
  if (v >= 1e5) return `${(v / 1e5).toFixed(2)}L`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return String(v)
}

// Above/Below pill for the per-EMA rows: green when above, red when below,
// dim "—" when the indicator wasn't available (e.g. ratio with no benchmark).
function aboveBelow(v) {
  if (v == null) return <span className="text-slate-600">—</span>
  return (
    <span className={v ? 'text-emerald-400' : 'text-rose-400'}>
      {v ? 'Above' : 'Below'}
    </span>
  )
}

const ROWS = [
  { key: 'ltp',           label: 'Price',            render: v => v != null ? `₹${v.toLocaleString('en-IN')}` : '—' },
  { key: 'score',         label: 'Technical score',  render: v => v != null ? v : '—' },
  { key: 'ratioDistance', label: 'Relative strength', render: v => v != null ? `${v >= 0 ? '+' : ''}${v}%` : '—' },
  { key: 'emaStructure',  label: 'EMA structure',    render: v => v ?? '—' },
  { key: 'priceVs20',     label: 'vs 20 EMA',        render: aboveBelow, indent: true },
  { key: 'priceVs50',     label: 'vs 50 EMA',        render: aboveBelow, indent: true },
  { key: 'priceVs150',    label: 'vs 150 EMA',       render: aboveBelow, indent: true },
  { key: 'rsTrend',       label: 'RS trend',         render: v => v ?? '—' },
  { key: 'ratioVs20',     label: 'Ratio vs 20 EMA',  render: aboveBelow, indent: true },
  { key: 'ratioVs50',     label: 'Ratio vs 50 EMA',  render: aboveBelow, indent: true },
  { key: 'ratioVs150',    label: 'Ratio vs 150 EMA', render: aboveBelow, indent: true },
  { key: 'macdBullish',   label: 'MACD',             render: v => v == null ? '—' : (v ? 'Bullish' : 'Bearish') },
  { key: 'volume',        label: 'Volume',           render: v => formatVolume(v) },
  { key: 'rsi',           label: 'RSI',              render: v => v != null ? v : '—' },
]

function useSymbolSearch() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const debounceRef = useRef(null)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (q.trim().length < 1) { setResults([]); return }
    debounceRef.current = setTimeout(() => {
      fetch(`${API_BASE}/api/search-symbols?q=${encodeURIComponent(q.trim())}`)
        .then(r => r.ok ? r.json() : { results: [] })
        .then(d => setResults(d.results || []))
        .catch(() => setResults([]))
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [q])

  return { q, setQ, results }
}

export default function CompareStocks({ baseSymbol, benchmark }) {
  const [timeframe, setTimeframe] = useState('daily')
  const [compareSymbol, setCompareSymbol] = useState(null)
  const [baseSnap, setBaseSnap] = useState(null)
  const [compareSnap, setCompareSnap] = useState(null)
  const [loading, setLoading] = useState(false)
  const { q, setQ, results } = useSymbolSearch()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setBaseSnap(null)
    fetch(`${API_BASE}/api/compare-snapshot/${encodeURIComponent(baseSymbol)}?timeframe=${timeframe}&benchmark=${encodeURIComponent(benchmark)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) { setBaseSnap(d); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [baseSymbol, timeframe, benchmark])

  useEffect(() => {
    if (!compareSymbol) { setCompareSnap(null); return }
    let cancelled = false
    fetch(`${API_BASE}/api/compare-snapshot/${encodeURIComponent(compareSymbol)}?timeframe=${timeframe}&benchmark=${encodeURIComponent(benchmark)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setCompareSnap(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [compareSymbol, timeframe, benchmark])

  return (
    <div className="space-y-3">
      {/* Timeframe selector */}
      <div className="flex items-center gap-0.5 bg-[#13131f] border border-[#1e1e30] rounded-lg p-0.5 w-fit">
        {TIMEFRAMES.map(tf => (
          <button
            key={tf.value}
            onClick={() => setTimeframe(tf.value)}
            className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-colors
              ${timeframe === tf.value ? 'bg-violet-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
          >
            {tf.label}
          </button>
        ))}
      </div>

      {/* Symbol picker */}
      {!compareSymbol ? (
        <div className="relative">
          <div className="flex items-center gap-2 bg-[#111120] border border-[#1e1e30] rounded-lg px-2.5 py-1.5">
            <Search size={13} className="text-slate-500 flex-shrink-0" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search any NSE symbol to compare…"
              className="bg-transparent text-xs text-slate-200 placeholder:text-slate-600 outline-none w-full"
            />
          </div>
          {results.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-[#13131f] border border-[#1e1e30] rounded-lg overflow-hidden shadow-xl">
              {results.map(r => (
                <button
                  key={r.symbol}
                  onClick={() => { setCompareSymbol(r.symbol); setQ('') }}
                  className="w-full text-left px-3 py-2 hover:bg-[#1e1e30] transition-colors"
                >
                  <span className="text-xs font-semibold text-slate-200">{r.symbol}</span>
                  <span className="text-[10px] text-slate-500 ml-2">{r.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between bg-[#111120] border border-[#1e1e30] rounded-lg px-2.5 py-1.5">
          <span className="text-xs font-semibold text-violet-400">Comparing with {compareSymbol}</span>
          <button onClick={() => setCompareSymbol(null)} className="text-slate-500 hover:text-slate-300">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Comparison table */}
      {loading ? (
        <div className="h-24 flex items-center justify-center text-xs text-slate-600">Loading…</div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#1e1e30]">
              <th className="text-left text-[10px] font-semibold text-slate-500 uppercase py-1.5">Metric</th>
              <th className="text-right text-[10px] font-semibold text-violet-400 uppercase py-1.5">{baseSymbol}</th>
              {compareSymbol && (
                <th className="text-right text-[10px] font-semibold text-slate-400 uppercase py-1.5">{compareSymbol}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(({ key, label, render, indent }) => (
              <tr key={key} className="border-b border-[#1e1e30]/50">
                <td className={`py-1.5 text-xs text-slate-500 ${indent ? 'pl-3' : ''}`}>{label}</td>
                <td className="py-1.5 text-xs font-mono text-slate-200 text-right">{render(baseSnap?.[key])}</td>
                {compareSymbol && (
                  <td className="py-1.5 text-xs font-mono text-slate-200 text-right">
                    {compareSnap ? render(compareSnap[key]) : '…'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
