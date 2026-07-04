import { useState, useEffect } from 'react'
import { ExternalLink, TrendingUp, X } from 'lucide-react'
import { EmaGroup, MomentumGroup } from './IndicatorGroups'
import AddToWatchlist from './AddToWatchlist'
import { SortHeader, FilterHeader } from './TableControls'

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

function openTradingView(symbol) {
  window.open(`https://www.tradingview.com/chart/?symbol=NSE:${symbol}`, '_blank')
}

const NO_FILTERS = { rsSignal: 'All', rsTrend: 'All', priceSignal: 'All', rec: 'All' }

export default function RSResultsTable({ results, scanned, hasPriceFilter, priceEmaPeriod, ratioEmaPeriod, onRowClick, watchlist }) {
  const [sort, setSort] = useState({ field: 'ratioDistance_abs', dir: 'asc' })
  const [filters, setFilters] = useState(NO_FILTERS)

  // Fresh scan → clear any column filters left over from the previous results
  useEffect(() => { setFilters(NO_FILTERS) }, [results])

  const onSort = (field) => {
    setSort(prev => ({
      field,
      dir: prev.field === field && prev.dir === 'asc' ? 'desc' : 'asc',
    }))
  }

  const setFilter = (key) => (v) => setFilters(f => ({ ...f, [key]: v }))
  const anyFilter = Object.values(filters).some(v => v !== 'All')

  // Dropdown options from the FULL result set (stable while narrowing down)
  const distinct = (fn) => [...new Set(results.map(fn).filter(Boolean))].sort()
  const opts = {
    rsSignal:    distinct(r => r.rsSignal),
    rsTrend:     distinct(r => r.rsTrend),
    priceSignal: distinct(r => r.priceSignal),
    rec:         distinct(r => r.signals?.signal),
  }

  const filtered = results.filter(r =>
    (filters.rsSignal === 'All'    || r.rsSignal === filters.rsSignal) &&
    (filters.rsTrend === 'All'     || r.rsTrend === filters.rsTrend) &&
    (filters.priceSignal === 'All' || r.priceSignal === filters.priceSignal) &&
    (filters.rec === 'All'         || r.signals?.signal === filters.rec)
  )

  const sorted = [...filtered].sort((a, b) => {
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
        <span className="text-sm text-slate-500 flex items-center gap-2 flex-wrap">
          <span>
            Showing <span className="text-slate-300 font-semibold">{sorted.length}</span>
            {anyFilter && <> of <span className="text-slate-400">{results.length}</span> matched</>}
            {scanned ? <> · <span className="text-slate-400">{scanned}</span> scanned</> : ''}
            <span className="ml-2 text-slate-600 text-xs">· click a row to open chart</span>
          </span>
          {anyFilter && (
            <button
              onClick={() => setFilters(NO_FILTERS)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/30
                text-violet-400 hover:bg-violet-500/20 text-xs font-medium transition-colors"
            >
              <X size={11} /> Clear filters
            </button>
          )}
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
              <FilterHeader label="RS Signal" options={opts.rsSignal} value={filters.rsSignal} onChange={setFilter('rsSignal')} />
              <SortHeader label="Ratio Dist" field="ratioDistance_abs"  sort={sort} onSort={onSort} />
              <FilterHeader label="RS Trend" options={opts.rsTrend} value={filters.rsTrend} onChange={setFilter('rsTrend')} />
              {hasPriceFilter && (
                <FilterHeader label="Price Signal" options={opts.priceSignal} value={filters.priceSignal} onChange={setFilter('priceSignal')} />
              )}
              <FilterHeader label="Rec." options={opts.rec} value={filters.rec} onChange={setFilter('rec')} />
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">EMA (20/50/150)</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Ratio vs EMA</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Momentum</th>
              <SortHeader label="Vol Ratio"  field="volume_ratio" sort={sort} onSort={onSort} />
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={13} className="px-3 py-12 text-center text-sm text-slate-500">
                  No rows match the column filters — <button onClick={() => setFilters(NO_FILTERS)} className="text-violet-400 hover:underline">clear filters</button>
                </td>
              </tr>
            )}
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
