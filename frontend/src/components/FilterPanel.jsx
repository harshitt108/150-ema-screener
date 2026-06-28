import { useState } from 'react'
import { Search, ChevronDown } from 'lucide-react'

const INDEX_LIST = [
  "NIFTY 50", "NIFTY NEXT 50", "NIFTY 100", "NIFTY 200", "NIFTY 500",
  "NIFTY BANK", "NIFTY IT", "NIFTY AUTO", "NIFTY PHARMA", "NIFTY FMCG",
  "NIFTY METAL", "NIFTY ENERGY", "NIFTY REALTY", "NIFTY MIDCAP 50",
  "NIFTY SMALLCAP 50", "All NSE Stocks"
]

const TIMEFRAMES = [
  { value: "5min", label: "5 min" },
  { value: "15min", label: "15 min" },
  { value: "30min", label: "30 min" },
  { value: "1h", label: "1 Hour" },
  { value: "2h", label: "2 Hour" },
  { value: "4h", label: "4 Hour" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
]

const EMA_OPTIONS = [
  { value: 20, label: "20 EMA" },
  { value: 50, label: "50 EMA" },
  { value: 150, label: "150 EMA" },
  { value: 200, label: "200 EMA" },
]

const CONDITIONS = [
  { value: "crossed_above", label: "Just Crossed Above EMA" },
  { value: "crossed_below", label: "Just Crossed Below EMA" },
  { value: "near_ema", label: "Trading Near EMA" },
  { value: "above_ema", label: "Above EMA" },
  { value: "below_ema", label: "Below EMA" },
]

const DISTANCE_OPTIONS = [1, 2, 3, 5, 10]
const LOOKBACK_OPTIONS = [
  { value: 1, label: "Last Candle" },
  { value: 2, label: "Last 2 Candles" },
  { value: 3, label: "Last 3 Candles" },
  { value: 5, label: "Last 5 Candles" },
  { value: 10, label: "Last Week" },
  { value: 20, label: "Last Month" },
]

function Select({ value, onChange, options, label }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full appearance-none bg-[#1a1a2e] border border-[#2d2d45] text-slate-200
          rounded-lg px-3 py-2.5 pr-8 text-sm cursor-pointer
          focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500
          hover:border-[#4a4a6a] transition-colors"
      >
        {options.map(opt => (
          <option key={opt.value ?? opt} value={opt.value ?? opt}>
            {opt.label ?? opt}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="absolute right-2.5 top-3.5 text-slate-500 pointer-events-none" />
    </div>
  )
}

function MultiSelect({ selected, onChange }) {
  const [open, setOpen] = useState(false)

  const toggle = (idx) => {
    if (selected.includes(idx)) {
      if (selected.length === 1) return
      onChange(selected.filter(s => s !== idx))
    } else {
      onChange([...selected, idx])
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between bg-[#1a1a2e] border border-[#2d2d45]
          text-slate-200 rounded-lg px-3 py-2.5 text-sm
          hover:border-[#4a4a6a] focus:outline-none focus:border-violet-500 transition-colors"
      >
        <span className="truncate text-left">
          {selected.length === 1 ? selected[0] : `${selected.length} indices selected`}
        </span>
        <ChevronDown size={14} className="text-slate-500 ml-2 flex-shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-[#1e1e32] border border-[#2d2d45]
            rounded-lg shadow-xl overflow-hidden max-h-60 overflow-y-auto">
            {INDEX_LIST.map(idx => (
              <label
                key={idx}
                className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#2a2a40] cursor-pointer text-sm"
                onClick={e => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(idx)}
                  onChange={() => toggle(idx)}
                  className="accent-violet-500 w-3.5 h-3.5"
                />
                <span className="text-slate-300">{idx}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default function FilterPanel({ filters, onChange, onScan, scanning, resultCount }) {
  const showLookback = filters.condition === 'crossed_above' || filters.condition === 'crossed_below'
  const showDistance = filters.condition === 'near_ema'

  return (
    <div className="bg-[#13131f] border border-[#1e1e30] rounded-xl p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-violet-500" />
        <h2 className="text-sm font-semibold text-slate-300 tracking-wide uppercase">Scanner Filters</h2>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/* Index */}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5 uppercase tracking-wider">Index</label>
          <MultiSelect
            selected={filters.indices}
            onChange={v => onChange({ ...filters, indices: v })}
          />
        </div>

        {/* Timeframe */}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5 uppercase tracking-wider">Timeframe</label>
          <Select
            value={filters.timeframe}
            onChange={v => onChange({ ...filters, timeframe: v })}
            options={TIMEFRAMES}
          />
        </div>

        {/* Moving Average */}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5 uppercase tracking-wider">Moving Average</label>
          <Select
            value={filters.emaPeriod}
            onChange={v => onChange({ ...filters, emaPeriod: parseInt(v) })}
            options={EMA_OPTIONS}
          />
        </div>

        {/* Condition */}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5 uppercase tracking-wider">Condition</label>
          <div className="space-y-2">
            {CONDITIONS.map(c => (
              <label key={c.value} className="flex items-center gap-2.5 cursor-pointer group">
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors
                  ${filters.condition === c.value ? 'border-violet-500' : 'border-[#3a3a55] group-hover:border-[#5a5a75]'}`}>
                  {filters.condition === c.value && (
                    <div className="w-2 h-2 rounded-full bg-violet-500" />
                  )}
                </div>
                <input
                  type="radio"
                  name="condition"
                  value={c.value}
                  checked={filters.condition === c.value}
                  onChange={() => onChange({ ...filters, condition: c.value })}
                  className="sr-only"
                />
                <span className={`text-sm transition-colors ${filters.condition === c.value ? 'text-slate-200' : 'text-slate-500 group-hover:text-slate-400'}`}>
                  {c.label}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Distance slider — only for Near EMA */}
        {showDistance && (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5 uppercase tracking-wider">
              Distance &nbsp;
              <span className="text-violet-400 normal-case font-semibold">±{filters.distancePct}%</span>
            </label>
            <input
              type="range"
              min={1} max={10} step={1}
              value={filters.distancePct}
              onChange={e => onChange({ ...filters, distancePct: parseInt(e.target.value) })}
              className="w-full accent-violet-500"
            />
            <div className="flex justify-between text-xs text-slate-600 mt-1">
              {DISTANCE_OPTIONS.map(d => <span key={d}>±{d}%</span>)}
            </div>
          </div>
        )}

        {/* Cross lookback — only for cross conditions */}
        {showLookback && (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5 uppercase tracking-wider">Cross Lookback</label>
            <Select
              value={filters.crossLookback}
              onChange={v => onChange({ ...filters, crossLookback: parseInt(v) })}
              options={LOOKBACK_OPTIONS}
            />
          </div>
        )}
      </div>

      {/* Scan button */}
      <button
        onClick={onScan}
        disabled={scanning}
        className="w-full py-3 rounded-lg font-semibold text-sm text-white transition-all
          bg-violet-600 hover:bg-violet-500 active:bg-violet-700
          disabled:opacity-60 disabled:cursor-not-allowed
          flex items-center justify-center gap-2"
      >
        {scanning ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Scanning...
          </>
        ) : (
          <>
            <Search size={15} />
            Scan Stocks
          </>
        )}
      </button>

      {resultCount !== null && (
        <p className="text-center text-xs text-slate-500">
          Found <span className="text-violet-400 font-semibold">{resultCount}</span> stocks
        </p>
      )}
    </div>
  )
}
