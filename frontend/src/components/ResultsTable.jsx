import { useState } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import Sparkline from './Sparkline'

const SORT_OPTIONS = [
  { value: 'distance_abs', label: 'Nearest EMA' },
  { value: 'volume_ratio', label: 'Volume Surge' },
  { value: 'distance_desc', label: '% Above EMA' },
  { value: 'distance_asc', label: '% Below EMA' },
  { value: 'symbol', label: 'Alphabetical' },
]

function SignalBadge({ signal }) {
  const styles = {
    'Near EMA': 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
    'Cross Above': 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    'Cross Below': 'bg-rose-500/15 text-rose-400 border border-rose-500/30',
    'Above EMA': 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
    'Below EMA': 'bg-orange-500/15 text-orange-400 border border-orange-500/30',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[signal] || 'bg-slate-700 text-slate-400'}`}>
      {signal}
    </span>
  )
}

function DistanceBadge({ value }) {
  const abs = Math.abs(value)
  const isPos = value >= 0
  const color = abs <= 1 ? 'text-emerald-400' : abs <= 3 ? 'text-amber-400' : 'text-slate-400'
  return (
    <span className={`font-mono text-sm font-semibold ${color}`}>
      {isPos ? '+' : ''}{value.toFixed(2)}%
    </span>
  )
}

function VolumeBadge({ ratio }) {
  if (!ratio) return <span className="text-slate-600 text-sm">—</span>
  const color = ratio >= 2 ? 'text-emerald-400' : ratio >= 1.5 ? 'text-amber-400' : 'text-slate-400'
  return <span className={`text-sm font-medium ${color}`}>{ratio.toFixed(1)}x</span>
}

function SortHeader({ label, field, sort, onSort }) {
  const active = sort.field === field
  return (
    <th
      className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer
        hover:text-slate-300 transition-colors whitespace-nowrap select-none"
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        {active
          ? sort.dir === 'asc' ? <ArrowUp size={12} className="text-violet-400" /> : <ArrowDown size={12} className="text-violet-400" />
          : <ArrowUpDown size={12} className="text-slate-700" />
        }
      </div>
    </th>
  )
}

function openTradingView(symbol) {
  window.open(`https://www.tradingview.com/chart/?symbol=NSE:${symbol}`, '_blank')
}

export default function ResultsTable({ results, scanned }) {
  const [sort, setSort] = useState({ field: 'distance_abs', dir: 'asc' })
  const [hoveredRow, setHoveredRow] = useState(null)

  const onSort = (field) => {
    setSort(prev => ({
      field,
      dir: prev.field === field && prev.dir === 'asc' ? 'desc' : 'asc'
    }))
  }

  const sorted = [...results].sort((a, b) => {
    let valA, valB
    switch (sort.field) {
      case 'symbol': valA = a.symbol; valB = b.symbol; break
      case 'ltp': valA = a.ltp; valB = b.ltp; break
      case 'ema': valA = a.ema; valB = b.ema; break
      case 'distance': valA = a.distance; valB = b.distance; break
      case 'distance_abs': valA = Math.abs(a.distance); valB = Math.abs(b.distance); break
      case 'volume_ratio': valA = a.volRatio; valB = b.volRatio; break
      default: valA = Math.abs(a.distance); valB = Math.abs(b.distance);
    }
    if (typeof valA === 'string') return sort.dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA)
    return sort.dir === 'asc' ? valA - valB : valB - valA
  })

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <TrendingUp size={40} className="mb-4 text-slate-700" />
        <p className="text-lg font-medium">No stocks matched your filters</p>
        <p className="text-sm mt-1">Try adjusting the distance or condition</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Stats bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex gap-4 text-sm text-slate-500">
          <span>
            Showing <span className="text-slate-300 font-semibold">{results.length}</span>
            {scanned ? <> of <span className="text-slate-400">{scanned}</span> scanned</> : ''} stocks
          </span>
        </div>
        <div className="flex gap-2">
          {['Cross Above', 'Cross Below', 'Near EMA', 'Above EMA', 'Below EMA'].map(sig => {
            const count = results.filter(r => r.signal === sig).length
            if (!count) return null
            return (
              <span key={sig} className="text-xs text-slate-500">
                {sig}: <span className="text-slate-300">{count}</span>
              </span>
            )
          })}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-[#1e1e30]">
        <table className="w-full min-w-[700px]">
          <thead className="bg-[#0d0d18] border-b border-[#1e1e30]">
            <tr>
              <SortHeader label="Symbol" field="symbol" sort={sort} onSort={onSort} />
              <SortHeader label="LTP" field="ltp" sort={sort} onSort={onSort} />
              <SortHeader label="EMA" field="ema" sort={sort} onSort={onSort} />
              <SortHeader label="Distance" field="distance_abs" sort={sort} onSort={onSort} />
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Signal</th>
              <SortHeader label="Vol Ratio" field="volume_ratio" sort={sort} onSort={onSort} />
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Chart</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr
                key={row.symbol}
                className={`border-b border-[#16162a] transition-colors cursor-pointer
                  ${i % 2 === 0 ? 'bg-[#0f0f1a]' : 'bg-[#111120]'}
                  hover:bg-[#1a1a2e]`}
                onMouseEnter={() => setHoveredRow(row.symbol)}
                onMouseLeave={() => setHoveredRow(null)}
                onClick={() => openTradingView(row.symbol)}
              >
                <td className="px-3 py-3">
                  <span className="font-semibold text-slate-100 text-sm tracking-wide">{row.symbol}</span>
                </td>
                <td className="px-3 py-3">
                  <span className="font-mono text-sm text-slate-300">{row.ltp.toLocaleString('en-IN')}</span>
                </td>
                <td className="px-3 py-3">
                  <span className="font-mono text-sm text-slate-400">{row.ema.toLocaleString('en-IN')}</span>
                </td>
                <td className="px-3 py-3">
                  <DistanceBadge value={row.distance} />
                </td>
                <td className="px-3 py-3">
                  <SignalBadge signal={row.signal} />
                </td>
                <td className="px-3 py-3">
                  <VolumeBadge ratio={row.volRatio} />
                </td>
                <td className="px-3 py-3">
                  <div className="sparkline-cell">
                    <Sparkline prices={row.sparkline} emaLine={row.emaLine} />
                  </div>
                </td>
                <td className="px-3 py-3">
                  <button
                    onClick={e => { e.stopPropagation(); openTradingView(row.symbol) }}
                    className="p-1.5 rounded hover:bg-[#2a2a40] text-slate-600 hover:text-violet-400 transition-colors"
                    title="Open in TradingView"
                  >
                    <ExternalLink size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
