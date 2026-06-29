import { useState } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, TrendingUp } from 'lucide-react'
import { EmaGroup, MomentumGroup } from './IndicatorGroups'
import AddToWatchlist from './AddToWatchlist'

function SignalPill({ signals }) {
  if (!signals) return null
  const { signal, bullCount, total } = signals
  const cfg = {
    BUY:  'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    HOLD: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    SELL: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  }[signal]
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`text-xs font-bold px-2 py-0.5 rounded border w-fit ${cfg}`}>{signal}</span>
      <span className="text-[10px] text-slate-600 font-mono">{bullCount}/{total}</span>
    </div>
  )
}

function SignalBadge({ signal }) {
  const styles = {
    'Near EMA':    'bg-amber-500/15 text-amber-400 border border-amber-500/30',
    'Cross Above': 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    'Cross Below': 'bg-rose-500/15 text-rose-400 border border-rose-500/30',
    'Above EMA':   'bg-blue-500/15 text-blue-400 border border-blue-500/30',
    'Below EMA':   'bg-orange-500/15 text-orange-400 border border-orange-500/30',
    'N/A':         'bg-slate-700/50 text-slate-500 border border-slate-700',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[signal] || 'bg-slate-700 text-slate-400'}`}>
      {signal}
    </span>
  )
}

function TrendBadge({ trend }) {
  const styles = {
    Rising:   'text-emerald-400',
    Falling:  'text-rose-400',
    Sideways: 'text-amber-400',
    Unknown:  'text-slate-500',
  }
  const arrows = { Rising: '↑', Falling: '↓', Sideways: '→', Unknown: '—' }
  return (
    <span className={`text-sm font-medium ${styles[trend] || 'text-slate-500'}`}>
      {arrows[trend] || ''} {trend}
    </span>
  )
}

function DistanceBadge({ value }) {
  const abs = Math.abs(value)
  const color = abs <= 1 ? 'text-emerald-400' : abs <= 3 ? 'text-amber-400' : 'text-slate-400'
  return (
    <span className={`font-mono text-sm font-semibold ${color}`}>
      {value >= 0 ? '+' : ''}{value.toFixed(2)}%
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
          ? sort.dir === 'asc'
            ? <ArrowUp size={12} className="text-violet-400" />
            : <ArrowDown size={12} className="text-violet-400" />
          : <ArrowUpDown size={12} className="text-slate-700" />
        }
      </div>
    </th>
  )
}

function openTradingView(symbol) {
  window.open(`https://www.tradingview.com/chart/?symbol=NSE:${symbol}`, '_blank')
}

export default function RSResultsTable({ results, scanned, hasPriceFilter, priceEmaPeriod, ratioEmaPeriod, onRowClick, watchlist }) {
  const [sort, setSort] = useState({ field: 'ratioDistance_abs', dir: 'asc' })

  const onSort = (field) => {
    setSort(prev => ({
      field,
      dir: prev.field === field && prev.dir === 'asc' ? 'desc' : 'asc',
    }))
  }

  const sorted = [...results].sort((a, b) => {
    let va, vb
    switch (sort.field) {
      case 'symbol':             va = a.symbol; vb = b.symbol; break
      case 'ltp':                va = a.ltp; vb = b.ltp; break
      case 'ratioDistance':      va = a.ratioDistance; vb = b.ratioDistance; break
      case 'ratioDistance_abs':  va = Math.abs(a.ratioDistance); vb = Math.abs(b.ratioDistance); break
      case 'volume_ratio':       va = a.volRatio; vb = b.volRatio; break
      default: va = Math.abs(a.ratioDistance); vb = Math.abs(b.ratioDistance)
    }
    if (typeof va === 'string') return sort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
    return sort.dir === 'asc' ? va - vb : vb - va
  })

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <TrendingUp size={40} className="mb-4 text-slate-700" />
        <p className="text-lg font-medium">No stocks matched your filters</p>
        <p className="text-sm mt-1">Try adjusting the condition, distance, or trend filter</p>
      </div>
    )
  }

  // Count signals for summary bar
  const signalCounts = results.reduce((acc, r) => {
    acc[r.rsSignal] = (acc[r.rsSignal] || 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-3">
      {/* Stats bar */}
      <div className="flex items-center justify-between px-1 flex-wrap gap-2">
        <span className="text-sm text-slate-500">
          Showing <span className="text-slate-300 font-semibold">{results.length}</span>
          {scanned ? <> of <span className="text-slate-400">{scanned}</span> scanned</> : ''} stocks
          <span className="ml-2 text-slate-600 text-xs">· click a row to open chart</span>
        </span>
        <div className="flex gap-3 flex-wrap">
          {['BUY','HOLD','SELL'].map(s => {
            const count = results.filter(r => r.signals?.signal === s).length
            if (!count) return null
            const colors = { BUY:'text-emerald-400', HOLD:'text-amber-400', SELL:'text-rose-400' }
            return (
              <span key={s} className="text-xs text-slate-500">
                {s}: <span className={`font-semibold ${colors[s]}`}>{count}</span>
              </span>
            )
          })}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-[#1e1e30]">
        <table className="w-full min-w-[1000px]">
          <thead className="bg-[#0d0d18] border-b border-[#1e1e30]">
            <tr>
              <SortHeader label="Symbol"     field="symbol"            sort={sort} onSort={onSort} />
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Benchmark</th>
              <SortHeader label="LTP"        field="ltp"               sort={sort} onSort={onSort} />
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">RS Signal</th>
              <SortHeader label="Ratio Dist" field="ratioDistance_abs"  sort={sort} onSort={onSort} />
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">RS Trend</th>
              {hasPriceFilter && (
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Price Signal</th>
              )}
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Rec.</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">EMA (20/50/150)</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Ratio vs EMA</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Momentum</th>
              <SortHeader label="Vol Ratio"  field="volume_ratio" sort={sort} onSort={onSort} />
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr
                key={row.symbol}
                className={`border-b border-[#16162a] transition-colors cursor-pointer
                  ${i % 2 === 0 ? 'bg-[#0f0f1a]' : 'bg-[#111120]'}
                  hover:bg-[#1a1a2e]`}
                onClick={() => onRowClick?.(row, i)}
              >
                <td className="px-3 py-3">
                  <span className="font-semibold text-slate-100 text-sm tracking-wide">{row.symbol}</span>
                </td>
                <td className="px-3 py-3">
                  <span className="text-xs text-slate-500 bg-[#1a1a2e] px-2 py-0.5 rounded">{row.benchmark}</span>
                </td>
                <td className="px-3 py-3">
                  <span className="font-mono text-sm text-slate-300">{row.ltp.toLocaleString('en-IN')}</span>
                </td>
                <td className="px-3 py-3">
                  <SignalBadge signal={row.rsSignal} />
                </td>
                <td className="px-3 py-3">
                  <DistanceBadge value={row.ratioDistance} />
                </td>
                <td className="px-3 py-3">
                  <TrendBadge trend={row.rsTrend} />
                </td>
                {hasPriceFilter && (
                  <td className="px-3 py-3">
                    {row.priceSignal ? <SignalBadge signal={row.priceSignal} /> : <span className="text-slate-600">—</span>}
                  </td>
                )}
                <td className="px-3 py-3">
                  <SignalPill signals={row.signals} />
                </td>
                <td className="px-3 py-3">
                  <EmaGroup panel={row.priceEmas} />
                </td>
                <td className="px-3 py-3">
                  <EmaGroup panel={row.ratioEmas} />
                </td>
                <td className="px-3 py-3">
                  <MomentumGroup source={row.signals} />
                </td>
                <td className="px-3 py-3">
                  <VolumeBadge ratio={row.volRatio} />
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    {watchlist && (
                      <AddToWatchlist symbol={row.symbol} ltp={row.ltp} watchlist={watchlist} compact />
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); window.open(`https://www.tradingview.com/chart/?symbol=NSE:${row.symbol}`, '_blank') }}
                      className="p-1.5 rounded hover:bg-[#2a2a40] text-slate-600 hover:text-violet-400 transition-colors"
                      title="Open in TradingView"
                    >
                      <ExternalLink size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
